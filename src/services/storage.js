import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';
import path from 'path';

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'auto',
  endpoint: process.env.AWS_ENDPOINT,
  forcePathStyle: process.env.AWS_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_BUCKET;
const PUBLIC_URL = `${process.env.AWS_ENDPOINT?.replace(/\/$/, '')}/${BUCKET}`;

/**
 * Upload a buffer to S3-compatible storage.
 * @returns {Promise<{key: string, url: string}>}
 */
export const upload = async (buffer, originalName, mimeType = 'application/octet-stream') => {
  const ext = path.extname(originalName);
  const key = `upload/public/${randomBytes(16).toString('hex')}${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }));

  const url = `${PUBLIC_URL}/${key}`;
  return { key, url };
};

/**
 * List all files under the upload/public/ prefix.
 * @returns {Promise<Array<{key, url, size, lastModified}>>}
 */
export const list = async () => {
  const data = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: 'upload/public',
  }));

  return (data.Contents ?? []).map((obj) => ({
    key: obj.Key,
    url: `${PUBLIC_URL}/${obj.Key}`,
    size: obj.Size,
    lastModified: obj.LastModified,
  }));
};

export default s3;