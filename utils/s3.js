import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_BUCKET_NAME'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.warn('⚠️  Missing AWS environment variables:', missingEnvVars);
  console.warn('S3 functionality will not work until these are configured.');
}

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Generate presigned URL for uploading
export const putobject = async (key, contentType) => {
  try {
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 604800 });
    return signedUrl;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    throw error;
  }
};

// Generate presigned URL for getting/reading an object
export const getobject = async (key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      ResponseContentDisposition: 'inline',
      ResponseContentType: key.endsWith('.txt') ? 'text/plain; charset=utf-8' : undefined,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 604800 });
    return signedUrl;
  } catch (error) {
    console.error('Error generating get presigned URL:', error);
    throw error;
  }
};

// Generate presigned URL for a specific bucket and key
export const getobjectFor = async (bucket, key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: 'inline',
      ResponseContentType: key.endsWith('.txt') ? 'text/plain; charset=utf-8' : undefined,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 604800 });
    return signedUrl;
  } catch (error) {
    console.error('Error generating get presigned URL for bucket:', error);
    throw error;
  }
};

// Generate presigned URL for a specific bucket and region
export const getobjectForWithRegion = async (bucket, key, region) => {
  try {
    const regionalClient = new S3Client({
      region: region || process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: 'inline',
      ResponseContentType: key.endsWith('.txt') ? 'text/plain; charset=utf-8' : undefined,
    });
    const signedUrl = await getSignedUrl(regionalClient, command, { expiresIn: 604800 });
    return signedUrl;
  } catch (error) {
    console.error('Error generating regional presigned URL:', error);
    throw error;
  }
};

export const deleteObject = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error('Error deleting object:', error);
    throw error;
  }
};

export { s3Client };

