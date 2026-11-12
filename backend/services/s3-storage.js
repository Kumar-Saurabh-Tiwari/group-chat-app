const { randomUUID } = require("node:crypto");
const { GetObjectCommand, HeadObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const { createPresignedPost } = require("@aws-sdk/s3-presigned-post");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const UPLOAD_URL_EXPIRES_SECONDS = 300;
const DOWNLOAD_URL_EXPIRES_SECONDS = 3600;
const MAX_ATTACHMENTS_PER_MESSAGE = 5;
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
  bucket = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET_NAME,
  region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
  client,
  presign = createPresignedPost
} = {}) {
  let s3Client = client;

  function getClient() {
    if (!bucket) throw new Error("S3_BUCKET must be configured before creating an upload form.");
    if (!region) throw new Error("AWS_REGION must be configured before creating an upload form.");
    if (!s3Client) {
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
        throw new Error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together.");
      }

      const clientOptions = { region };
      if (accessKeyId && secretAccessKey) {
        clientOptions.credentials = { accessKeyId, secretAccessKey };
      }
      s3Client = new S3Client(clientOptions);
    }
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
    },

    async verifyUploadedObject({ userId, key, contentType, size } = {}) {
      if (typeof userId !== "string" || !/^[1-9][0-9]{0,19}$/.test(userId)) {
        throw new TypeError("A valid authenticated user ID is required.");
      }
      if (typeof key !== "string" || !new RegExp(`^chat-uploads/${userId}/[0-9a-f-]{36}$`).test(key)) {
        throw new TypeError("The uploaded file key is invalid.");
      }
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        throw new TypeError("This file type is not supported.");
      }
      if (!Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) {
        throw new TypeError("The uploaded file size is invalid.");
      }

      const { ContentLength, ContentType } = await getClient().send(new HeadObjectCommand({
        Bucket: bucket,
        Key: key
      }));
      if (ContentLength !== size || ContentType !== contentType) {
        throw new TypeError("The uploaded file does not match its declared type or size.");
      }
    },

    async createDownloadUrl({ key, contentType, fileName } = {}) {
      const safeFileName = encodeURIComponent(fileName).replace(/['()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      );
      return getSignedUrl(
        getClient(),
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: `inline; filename*=UTF-8''${safeFileName}`,
          ResponseContentType: contentType
        }),
        { expiresIn: DOWNLOAD_URL_EXPIRES_SECONDS }
      );
    }
  };
}

module.exports = {
  ALLOWED_CONTENT_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_UPLOAD_BYTES,
  UPLOAD_URL_EXPIRES_SECONDS,
  createS3Storage
};
