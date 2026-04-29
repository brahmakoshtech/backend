/**
 * S3 → R2 Migration Script (streaming — low memory)
 * Run: node scripts/migrate-s3-to-r2.js
 * Dry run: node scripts/migrate-s3-to-r2.js --dry-run
 */

import dotenv from 'dotenv';
dotenv.config();

import { S3Client, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';

const DRY_RUN = process.argv.includes('--dry-run');

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  requestHandler: { requestTimeout: 60000 },
});

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
  requestHandler: { requestTimeout: 120000 },
});

const S3_BUCKET = process.env.AWS_BUCKET_NAME;
const R2_BUCKET = process.env.R2_BUCKET;
const stats = { total: 0, copied: 0, skipped: 0, failed: 0, dbUpdated: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Check if file already exists in R2 ──────────────────────────────────────
const existsInR2 = async (key) => {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
};

// ─── Copy one file S3 → R2 via stream (no buffer) ────────────────────────────
const copyFile = async (key, attempt = 1) => {
  try {
    if (!DRY_RUN && await existsInR2(key)) {
      stats.skipped++;
      return true;
    }

    const s3Obj = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    const contentType = s3Obj.ContentType || 'application/octet-stream';

    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would copy: ${key} (${contentType})`);
      stats.copied++;
      return true;
    }

    // Stream directly S3 → R2, no memory buffer
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: s3Obj.Body,
      ContentType: contentType,
      ContentLength: s3Obj.ContentLength,
    }));

    console.log(`✅ Copied: ${key}`);
    stats.copied++;
    return true;
  } catch (err) {
    if (attempt < 4) {
      console.warn(`⚠️  Retry ${attempt}/3: ${key} — ${err.message}`);
      await sleep(3000 * attempt);
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
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, ContinuationToken: token }));
    (res.Contents || []).forEach((o) => keys.push(o.Key));
    token = res.IsTruncated ? res.NextContinuationToken : null;
  } while (token);
  return keys;
};

// ─── Update MongoDB documents ─────────────────────────────────────────────────
const updateMongoDB = async () => {
  console.log('\n📦 Updating MongoDB documents...');

  const keyFieldMap = {
    'SpiritualClip.videoUrl':    'videoKey',
    'SpiritualClip.audioUrl':    'audioKey',
    'Meditation.videoUrl':       'videoKey',
    'Meditation.audioUrl':       'audioKey',
    'Meditation.thumbnailUrl':   'thumbnailKey',
    'BrahmAvatar.videoUrl':      'videoKey',
    'BrahmAvatar.thumbnailUrl':  'thumbnailKey',
    'LiveAvatar.videoUrl':       'videoKey',
    'LiveAvatar.thumbnailUrl':   'thumbnailKey',
    'PujaPadhati.videoUrl':      'videoKey',
    'PujaPadhati.audioUrl':      'audioKey',
    'PujaPadhati.thumbnailUrl':  'thumbnailKey',
    'SwapnaDecoder.thumbnailUrl':'thumbnailKey',
    'SpiritualActivity.image':   'imageKey',
    'Chanting.audioUrl':         'audioKey',
    'Chanting.thumbnailUrl':     'thumbnailKey',
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
      const orQuery = fields.map((f) => ({ [f]: { $regex: 'amazonaws\\.com', $options: 'i' } }));
      const docs = await Model.find({ $or: orQuery });

      if (docs.length === 0) { console.log(`  ${name}: no S3 URLs found`); continue; }
      console.log(`  ${name}: found ${docs.length} docs with S3 URLs`);

      for (const doc of docs) {
        let changed = false;
        for (const field of fields) {
          if (doc[field]?.includes('amazonaws.com')) {
            try {
              const key = decodeURIComponent(new URL(doc[field]).pathname.substring(1));
              const keyField = keyFieldMap[`${name}.${field}`];
              if (keyField && doc.schema.path(keyField)) {
                doc[keyField] = key;
                console.log(`    ${name}.${keyField} = ${key}`);
              }
              doc[field] = null;
              changed = true;
            } catch {
              console.warn(`    Could not parse URL for ${name}.${field}`);
            }
          }
        }
        if (changed) {
          if (!DRY_RUN) { await doc.save(); stats.dbUpdated++; }
          else { console.log(`  [DRY-RUN] Would update ${name} doc ${doc._id}`); stats.dbUpdated++; }
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

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB connected\n');

  console.log('📋 Listing S3 objects...');
  const keys = await listAllS3Objects();
  stats.total = keys.length;
  console.log(`   Found ${keys.length} objects in S3\n`);

  for (let i = 0; i < keys.length; i++) {
    await copyFile(keys[i]);
    if ((i + 1) % 10 === 0) console.log(`   Progress: ${i + 1}/${keys.length}`);
  }

  await updateMongoDB();

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
