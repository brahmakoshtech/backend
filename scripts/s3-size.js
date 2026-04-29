import dotenv from 'dotenv';
dotenv.config();
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
});

let total = 0, count = 0, token;
do {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: process.env.AWS_BUCKET_NAME, ContinuationToken: token }));
  (res.Contents || []).forEach(o => { total += o.Size; count++; });
  token = res.IsTruncated ? res.NextContinuationToken : null;
} while (token);

console.log(`Files : ${count}`);
console.log(`Total : ${(total/1024/1024).toFixed(2)} MB`);
console.log(`Total : ${(total/1024/1024/1024).toFixed(3)} GB`);
