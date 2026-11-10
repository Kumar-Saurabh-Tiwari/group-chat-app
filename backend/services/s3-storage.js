const { randomUUID } = require("node:crypto");
const { S3Client } = require("@aws-sdk/client-s3");
const { createPresignedPost } = require("@aws-sdk/s3-presigned-post");

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const UPLOAD_URL_EXPIRES_SECONDS = 300;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain"
]);

function createS3Storage({
  bucket = process.env.S3_BUCKET,
  region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
  client,
  presign = createPresignedPost
} = {}) {
  let s3Client = client;

  function getClient() {
    if (!bucket) throw new Error("S3_BUCKET must be configured before creating an upload form.");
    if (!region) throw new Error("AWS_REGION must be configured before creating an upload form.");
    if (!s3Client) s3Client = new S3Client({ region });
    return s3Client;
  }

  return {
    async createUploadForm({ userId, contentType } = {}) {
      if (typeof userId !== "string" || !/^[1-9][0-9]{0,19}$/.test(userId)) {
        throw new TypeError("A valid authenticated user ID is required.");
      }
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        throw new TypeError("This file type is not supported.");
      }

      const key = `chat-uploads/${userId}/${randomUUID()}`;
      const result = await presign(getClient(), {
        Bucket: bucket,
        Key: key,
        Expires: UPLOAD_URL_EXPIRES_SECONDS,
        Fields: { "Content-Type": contentType },
        Conditions: [
          ["content-length-range", 1, MAX_UPLOAD_BYTES],
          ["eq", "$Content-Type", contentType]
        ]
      });

      return {
        url: result.url,
        fields: result.fields,
        key,
        maxFileBytes: MAX_UPLOAD_BYTES,
        expiresIn: UPLOAD_URL_EXPIRES_SECONDS
      };
    }
  };
}

module.exports = {
  ALLOWED_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOAD_URL_EXPIRES_SECONDS,
  createS3Storage
};
