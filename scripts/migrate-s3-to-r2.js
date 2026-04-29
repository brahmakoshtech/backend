/**
 * S3 → R2 Migration Script
 * Copies all files from AWS S3 to Cloudflare R2
 * Updates MongoDB keys/urls accordingly
 * 
 * Run: node scripts/migrate-s3-to-r2.js
 * Dry run: node scripts/migrate-s3-to-r2.js --dry-run
 */

import dotenv from 'dotenv';
dotenv.config();

import { S3Client, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';

const DRY_RUN = process.argv.includes('--dry-run');

// ─── S3 Client ───────────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// ─── R2 Client ───────────────────────────────────────────────────────────────
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
});

const S3_BUCKET = process.env.AWS_BUCKET_NAME;
const R2_BUCKET = process.env.R2_BUCKET;

// ─── Stats ───────────────────────────────────────────────────────────────────
const stats = { total: 0, copied: 0, skipped: 0, failed: 0, dbUpdated: 0 };

// ─── Helper: stream to buffer ─────────────────────────────────────────────────
const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });

// ─── Copy one file S3 → R2 (with retry) ─────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const existsInR2 = async (key) => {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
};

const copyFile = async (key, attempt = 1) => {
  try {
    if (!DRY_RUN && await existsInR2(key)) {
      stats.skipped++;
      return true;
    }
  } catch {}
  try {
    const getCmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    const s3Obj = await s3.send(getCmd);
    const buffer = await streamToBuffer(s3Obj.Body);
    const contentType = s3Obj.ContentType || 'application/octet-stream';

    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would copy: ${key} (${buffer.length} bytes, ${contentType})`);
      stats.copied++;
      return true;
    }

    const putCmd = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });
    await r2.send(putCmd);
    console.log(`✅ Copied: ${key}`);
    stats.copied++;
    return true;
  } catch (err) {
    if (attempt < 3) {
      console.warn(`⚠️  Retry ${attempt}/3: ${key} — ${err.message}`);
      await sleep(2000 * attempt);
      return copyFile(key, attempt + 1);
    }
    console.error(`❌ Failed: ${key} — ${err.message}`);
    stats.failed++;
    return false;
  }
};

// ─── List all S3 objects ──────────────────────────────────────────────────────
const listAllS3Objects = async () => {
  const keys = [];
  let continuationToken;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      ContinuationToken: continuationToken,
    });
    const res = await s3.send(cmd);
    (res.Contents || []).forEach((obj) => keys.push(obj.Key));
    continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
  } while (continuationToken);

  return keys;
};

// ─── Update MongoDB documents ─────────────────────────────────────────────────
const updateMongoDB = async () => {
  console.log('\n📦 Updating MongoDB documents...');

  // Models that have S3 URLs stored
  // urlField -> keyField mapping (where a separate key field exists in the schema)
  const keyFieldMap = {
    'SpiritualClip.videoUrl':  'videoKey',
    'SpiritualClip.audioUrl':  'audioKey',
    'Meditation.videoUrl':     'videoKey',
    'Meditation.audioUrl':     'audioKey',
    'Meditation.thumbnailUrl': 'thumbnailKey',
    'BrahmAvatar.videoUrl':    'videoKey',
    'BrahmAvatar.thumbnailUrl':'thumbnailKey',
    'LiveAvatar.videoUrl':     'videoKey',
    'LiveAvatar.thumbnailUrl': 'thumbnailKey',
    'PujaPadhati.videoUrl':    'videoKey',
    'PujaPadhati.audioUrl':    'audioKey',
    'PujaPadhati.thumbnailUrl':'thumbnailKey',
    'SwapnaDecoder.thumbnailUrl': 'thumbnailKey',
    'SpiritualActivity.image': 'imageKey',
    'Chanting.audioUrl':       'audioKey',
    'Chanting.thumbnailUrl':   'thumbnailKey',
  };

  const modelConfigs = [
    { name: 'SpiritualClip',          fields: ['videoUrl', 'audioUrl'] },
    { name: 'SpiritualActivity',      fields: ['image'] },
    { name: 'SpiritualConfiguration', fields: ['thumbnailUrl', 'audioUrl', 'videoUrl'] },
    { name: 'Meditation',             fields: ['thumbnailUrl', 'audioUrl', 'videoUrl'] },
    { name: 'Chanting',               fields: ['thumbnailUrl', 'audioUrl'] },
    { name: 'Prathana',               fields: ['thumbnailUrl', 'audioUrl'] },
    { name: 'Shloka',                 fields: ['thumbnailUrl', 'audioUrl'] },
    { name: 'BrahmAvatar',            fields: ['videoUrl', 'thumbnailUrl'] },
    { name: 'LiveAvatar',             fields: ['videoUrl', 'thumbnailUrl'] },
    { name: 'Expert',                 fields: ['profileImage'] },
    { name: 'Sponsor',                fields: ['logoUrl', 'bannerUrl'] },
    { name: 'Testimonial',            fields: ['mediaUrl'] },
    { name: 'BrandAsset',             fields: ['assetUrl'] },
    { name: 'PujaPadhati',            fields: ['thumbnailUrl', 'audioUrl', 'videoUrl'] },
    { name: 'SwapnaDecoder',          fields: ['thumbnailUrl'] },
  ];

  for (const { name, fields } of modelConfigs) {
    try {
      const Model = (await import(`../models/${name}.js`)).default;

      const orQuery = fields.map((f) => ({
        [f]: { $regex: 'amazonaws\\.com', $options: 'i' },
      }));

      const docs = await Model.find({ $or: orQuery });
      if (docs.length === 0) {
        console.log(`  ${name}: no S3 URLs found`);
        continue;
      }

      console.log(`  ${name}: found ${docs.length} docs with S3 URLs`);

      for (const doc of docs) {
        let changed = false;
        for (const field of fields) {
          if (doc[field] && typeof doc[field] === 'string' && doc[field].includes('amazonaws.com')) {
            try {
              const urlObj = new URL(doc[field]);
              const key = decodeURIComponent(urlObj.pathname.substring(1));

              // Save key into dedicated key field if schema has one
              const keyField = keyFieldMap[`${name}.${field}`];
              if (keyField && doc.schema.path(keyField)) {
                doc[keyField] = key;
                console.log(`    ${name}.${keyField} = ${key}`);
              } else {
                console.log(`    ${name}.${field} key=${key} (no separate key field, url cleared)`);
              }

              doc[field] = null; // clear old S3 URL
              changed = true;
            } catch (e) {
              console.warn(`    Could not parse URL for ${name}.${field}: ${doc[field]}`);
            }
          }
        }
        if (changed && !DRY_RUN) {
          await doc.save();
          stats.dbUpdated++;
        } else if (changed && DRY_RUN) {
          console.log(`  [DRY-RUN] Would update ${name} doc ${doc._id}`);
          stats.dbUpdated++;
        }
      }
    } catch (err) {
      console.warn(`  ⚠️  Could not process model ${name}: ${err.message}`);
    }
  }
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log(`\n🚀 S3 → R2 Migration ${DRY_RUN ? '[DRY RUN]' : ''}`);
  console.log(`   S3 Bucket : ${S3_BUCKET}`);
  console.log(`   R2 Bucket : ${R2_BUCKET}`);
  console.log(`   R2 Endpoint: ${process.env.R2_ENDPOINT}\n`);

  // Connect MongoDB
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB connected\n');

  // List all S3 files
  console.log('📋 Listing S3 objects...');
  const keys = await listAllS3Objects();
  stats.total = keys.length;
  console.log(`   Found ${keys.length} objects in S3\n`);

  if (keys.length === 0) {
    console.log('No files to migrate.');
  } else {
    // Copy files one by one — avoids ECONNRESET from S3 rate limiting
    for (let i = 0; i < keys.length; i++) {
      await copyFile(keys[i]);
      if ((i + 1) % 10 === 0) console.log(`   Progress: ${i + 1}/${keys.length}`);
    }
  }

  // Update MongoDB
  await updateMongoDB();

  // Summary
  console.log('\n─────────────────────────────────');
  console.log('📊 Migration Summary');
  console.log(`   Total S3 files : ${stats.total}`);
  console.log(`   Copied to R2   : ${stats.copied}`);
  console.log(`   Skipped (exist): ${stats.skipped}`);
  console.log(`   Failed         : ${stats.failed}`);
  console.log(`   DB docs updated: ${stats.dbUpdated}`);
  if (DRY_RUN) console.log('\n   ⚠️  DRY RUN — no actual changes made');
  console.log('─────────────────────────────────\n');

  await mongoose.disconnect();
  process.exit(stats.failed > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
