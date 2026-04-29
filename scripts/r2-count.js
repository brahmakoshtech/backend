import dotenv from 'dotenv';
dotenv.config();
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});

let total = 0, token;
do {
  const res = await r2.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, ContinuationToken: token }));
  total += (res.Contents || []).length;
  token = res.IsTruncated ? res.NextContinuationToken : null;
} while (token);

console.log('R2 total files:', total);
