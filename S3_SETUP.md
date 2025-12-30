# AWS S3 Setup Guide

## Required NPM Packages

Install the following packages:

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner uuid
```

## Environment Variables

Add the following environment variables to your `.env` file:

```env
# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=your_aws_region
AWS_BUCKET_NAME=your_bucket_name
```

## S3 Bucket Setup

1. Create an S3 bucket in AWS Console
2. Configure bucket permissions (make sure your IAM user has PutObject, GetObject, DeleteObject permissions)
3. Set up CORS configuration if needed for direct browser uploads

## Usage

### Upload Image Flow

1. Frontend requests presigned URL from `/api/upload/presigned-url`
2. Backend generates presigned URL with unique key (format: `images/{role}/{userId}/{uuid}.{extension}`)
3. Frontend uploads file directly to S3 using presigned URL
4. Backend stores the S3 key in database
5. To retrieve image, use `/api/upload/presigned-url/:key` to get a presigned URL for viewing

### Example Frontend Usage

```javascript
// Get presigned URL
const response = await api.getPresignedUrl(file.name, file.type);
const { presignedUrl, key } = response.data;

// Upload to S3
await api.uploadToS3(presignedUrl, file);

// Store key in database (e.g., businessLogo: key)
```

## API Endpoints

### POST /api/upload/presigned-url
Generate presigned URL for uploading
- Body: `{ fileName: string, contentType: string }`
- Response: `{ success: true, data: { presignedUrl: string, key: string } }`

### GET /api/upload/presigned-url/:key
Get presigned URL for viewing an image
- Response: `{ success: true, data: { presignedUrl: string } }`

### DELETE /api/upload/:key
Delete an image from S3
- Response: `{ success: true, message: string }`

