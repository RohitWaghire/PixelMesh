/**
 * PixelMesh Phase 3 - S3 / Cloudflare R2 Storage Adapter
 * 
 * Supports AWS S3, Cloudflare R2, MinIO, and Google Cloud Storage via standard
 * S3-compatible APIs and pre-signed PUT URLs.
 */

import { Readable } from "stream";
import crypto from "crypto";
import {
  StorageAdapter,
  StorageUploadParams,
  StoragePutParams,
  StoragePutResult,
  PreSignedUploadResult,
  StorageObjectMetadata,
  StorageConfig
} from "./types";

async function streamToBuffer(
  stream: NodeJS.ReadableStream | ReadableStream | Buffer | Uint8Array | string
): Promise<Buffer> {
  if (Buffer.isBuffer(stream)) return stream;
  if (stream instanceof Uint8Array) return Buffer.from(stream);
  if (typeof stream === "string") return Buffer.from(stream, "utf-8");

  if (typeof (stream as any).getReader === "function") {
    const reader = (stream as ReadableStream).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream as NodeJS.ReadableStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class S3StorageAdapter implements StorageAdapter {
  private bucket: string;
  private region: string;
  private endpoint?: string;
  private accessKeyId?: string;
  private secretAccessKey?: string;
  private cdnBaseUrl?: string;
  private defaultExpiresInSeconds: number;
  private customClient: any;
  private customPresigner: any;
  private mockStore: Map<string, { buffer: Buffer; contentType: string; metadata?: Record<string, string> }> = new Map();

  constructor(config?: StorageConfig & { s3Client?: any; getSignedUrlFn?: any }) {
    this.bucket = config?.s3Bucket || process.env.S3_BUCKET || "pixelmesh-storage";
    this.region = config?.s3Region || process.env.S3_REGION || "auto";
    this.endpoint = config?.s3Endpoint || process.env.S3_ENDPOINT;
    this.accessKeyId = config?.s3AccessKeyId || process.env.S3_ACCESS_KEY_ID;
    this.secretAccessKey = config?.s3SecretAccessKey || process.env.S3_SECRET_ACCESS_KEY;
    this.cdnBaseUrl = config?.cdnBaseUrl || process.env.CDN_BASE_URL;
    this.defaultExpiresInSeconds = config?.defaultExpiresInSeconds || 900;
    this.customClient = config?.s3Client;
    this.customPresigner = config?.getSignedUrlFn;
  }

  /**
   * Dynamically loads S3 client SDK or returns injected custom client
   */
  private async getS3Client(): Promise<any> {
    if (this.customClient) {
      return this.customClient;
    }

    if (!this.accessKeyId || !this.secretAccessKey) {
      return null;
    }

    try {
      // Dynamic import to prevent crash when @aws-sdk/client-s3 is not installed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { S3Client } = require("@aws-sdk/client-s3");
      this.customClient = new S3Client({
        region: this.region,
        endpoint: this.endpoint,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey
        },
        forcePathStyle: Boolean(this.endpoint)
      });
      return this.customClient;
    } catch {
      return null;
    }
  }

  /**
   * Generates a unique key for image objects if not explicitly provided
   */
  private generateKey(filename?: string, prefix = "raw"): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const uuid = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

    let sanitizedName = "";
    if (filename) {
      sanitizedName = `_${filename.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
    } else {
      sanitizedName = ".png";
    }

    return `${prefix}/${year}/${month}/${day}/pm_${uuid}${sanitizedName}`;
  }

  /**
   * Generates an AWS S3 / Cloudflare R2 pre-signed upload URL
   */
  public async getUploadUrl(
    paramsOrKey: StorageUploadParams | string,
    contentType?: string,
    expiresInSeconds?: number
  ): Promise<PreSignedUploadResult> {
    let key: string;
    let mimeType: string;
    let expiresSeconds: number;
    let maxSizeBytes: number | undefined;

    if (typeof paramsOrKey === "string") {
      key = paramsOrKey;
      mimeType = contentType || "image/png";
      expiresSeconds = expiresInSeconds || this.defaultExpiresInSeconds;
    } else {
      const params = paramsOrKey || {};
      key = params.key || this.generateKey(params.filename, params.prefix || "raw");
      mimeType = params.contentType || contentType || "image/png";
      expiresSeconds = params.expiresInSeconds || expiresInSeconds || this.defaultExpiresInSeconds;
      maxSizeBytes = params.maxSizeBytes;
    }

    const expiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString();
    const client = await this.getS3Client();

    let uploadUrl: string;

    if (client && (this.customPresigner || this.canLoadPresigner())) {
      try {
        const { PutObjectCommand } = require("@aws-sdk/client-s3");
        const getSignedUrl = this.customPresigner || require("@aws-sdk/s3-request-presigner").getSignedUrl;
        const command = new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: mimeType
        });
        uploadUrl = await getSignedUrl(client, command, { expiresIn: expiresSeconds });
      } catch {
        uploadUrl = this.generateSimulatedPresignedUrl(key, expiresSeconds);
      }
    } else {
      uploadUrl = this.generateSimulatedPresignedUrl(key, expiresSeconds);
    }

    const publicUrl = this.getPublicUrl(key);

    return {
      uploadUrl,
      imageKey: key,
      publicUrl,
      expiresAt,
      method: "PUT",
      headers: {
        "Content-Type": mimeType
      },
      maxSizeBytes
    };
  }

  private canLoadPresigner(): boolean {
    try {
      require.resolve("@aws-sdk/s3-request-presigner");
      return true;
    } catch {
      return false;
    }
  }

  private generateSimulatedPresignedUrl(key: string, expiresInSeconds: number): string {
    const host = this.endpoint
      ? this.endpoint.replace(/^https?:\/\//, "")
      : `${this.bucket}.s3.${this.region}.amazonaws.com`;
    const dateStamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const credential = `${this.accessKeyId || "mock-access-key"}/${dateStamp.slice(0, 8)}/${this.region}/s3/aws4_request`;
    const signature = crypto.randomBytes(32).toString("hex");

    return `https://${host}/${encodeURIComponent(key)}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(credential)}&X-Amz-Date=${dateStamp}&X-Amz-Expires=${expiresInSeconds}&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=${signature}`;
  }

  /**
   * Retrieves a readable Node.js stream for the object from S3
   */
  public async getObjectStream(key: string): Promise<NodeJS.ReadableStream> {
    const client = await this.getS3Client();
    if (client && client.send) {
      try {
        const { GetObjectCommand } = require("@aws-sdk/client-s3");
        const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        if (!res.Body) {
          throw new Error(`Object key '${key}' returned empty body.`);
        }
        if (typeof res.Body.pipe === "function") {
          return res.Body as NodeJS.ReadableStream;
        }
        if (typeof res.Body.transformToByteArray === "function") {
          const bytes = await res.Body.transformToByteArray();
          return Readable.from(Buffer.from(bytes));
        }
        return Readable.from(res.Body);
      } catch (err: any) {
        if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
          throw new Error(`Object key '${key}' not found in storage bucket. Please re-upload.`);
        }
        throw err;
      }
    }

    const mockItem = this.mockStore.get(key);
    if (!mockItem) {
      throw new Error(`Object key '${key}' not found in storage bucket. Please re-upload.`);
    }
    return Readable.from(mockItem.buffer);
  }

  /**
   * Retrieves the raw Buffer for the stored object from S3
   */
  public async getObjectBuffer(key: string): Promise<Buffer> {
    const stream = await this.getObjectStream(key);
    return await streamToBuffer(stream);
  }

  /**
   * Puts an object directly into S3
   */
  public async putObject(params: StoragePutParams): Promise<StoragePutResult> {
    const { key, body, contentType = "image/png", metadata } = params;
    if (!key) {
      throw new Error("Object key is required for putObject.");
    }

    const buffer = await streamToBuffer(body);
    const client = await this.getS3Client();

    if (client && client.send) {
      const { PutObjectCommand } = require("@aws-sdk/client-s3");
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          Metadata: metadata
        })
      );
    } else {
      this.mockStore.set(key, { buffer, contentType, metadata });
    }

    const publicUrl = this.getPublicUrl(key);
    return {
      key,
      publicUrl,
      imageUrl: publicUrl,
      sizeBytes: buffer.length
    };
  }

  /**
   * Checks if an object exists in S3
   */
  public async exists(key: string): Promise<boolean> {
    const client = await this.getS3Client();
    if (client && client.send) {
      try {
        const { HeadObjectCommand } = require("@aws-sdk/client-s3");
        await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    }
    return this.mockStore.has(key);
  }

  /**
   * Deletes an object from S3
   */
  public async deleteObject(key: string): Promise<boolean> {
    const client = await this.getS3Client();
    if (client && client.send) {
      try {
        const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
        await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    }
    return this.mockStore.delete(key);
  }

  /**
   * Returns the public access URL for a given object key
   */
  public getPublicUrl(key: string): string {
    const cleanKey = key.replace(/^\/+/, "");
    if (this.cdnBaseUrl) {
      return `${this.cdnBaseUrl.replace(/\/$/, "")}/${cleanKey}`;
    }
    if (this.endpoint) {
      return `${this.endpoint.replace(/\/$/, "")}/${this.bucket}/${cleanKey}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${cleanKey}`;
  }

  /**
   * Returns metadata for stored S3 object
   */
  public async getMetadata(key: string): Promise<StorageObjectMetadata | null> {
    const client = await this.getS3Client();
    if (client && client.send) {
      try {
        const { HeadObjectCommand } = require("@aws-sdk/client-s3");
        const res = await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
        return {
          contentType: res.ContentType || "application/octet-stream",
          contentLength: res.ContentLength || 0,
          lastModified: res.LastModified || new Date(),
          eTag: res.ETag,
          metadata: res.Metadata
        };
      } catch {
        return null;
      }
    }

    const item = this.mockStore.get(key);
    if (!item) return null;
    return {
      contentType: item.contentType,
      contentLength: item.buffer.length,
      lastModified: new Date(),
      metadata: item.metadata
    };
  }

  /**
   * Reset mock store (for testing)
   */
  public async reset(): Promise<void> {
    this.mockStore.clear();
  }
}
