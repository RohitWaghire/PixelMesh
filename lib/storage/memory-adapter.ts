/**
 * PixelMesh Phase 3 - In-Memory Storage Adapter
 * 
 * Provides an isolated, zero-dependency in-memory object storage implementation
 * for unit tests, local development, and offline environments.
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

interface MemoryObjectRecord {
  buffer: Buffer;
  contentType: string;
  createdAt: Date;
  metadata?: Record<string, string>;
}

async function streamToBuffer(
  stream: NodeJS.ReadableStream | ReadableStream | Buffer | Uint8Array | string
): Promise<Buffer> {
  if (Buffer.isBuffer(stream)) {
    return stream;
  }
  if (stream instanceof Uint8Array) {
    return Buffer.from(stream);
  }
  if (typeof stream === "string") {
    return Buffer.from(stream, "utf-8");
  }

  // Handle Web ReadableStream
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

  // Handle Node.js Readable stream
  const chunks: Buffer[] = [];
  for await (const chunk of stream as NodeJS.ReadableStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class InMemoryStorageAdapter implements StorageAdapter {
  private storage: Map<string, MemoryObjectRecord> = new Map();
  private cdnBaseUrl: string;
  private defaultExpiresInSeconds: number;

  constructor(config?: StorageConfig) {
    this.cdnBaseUrl = config?.cdnBaseUrl?.replace(/\/$/, "") || "https://cdn.pixelmesh.local";
    this.defaultExpiresInSeconds = config?.defaultExpiresInSeconds || 900;
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
   * Generates a mock pre-signed upload URL for direct binary upload simulation
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
    const mockToken = crypto.randomBytes(16).toString("hex");
    const uploadUrl = `https://storage.pixelmesh.local/upload/${encodeURIComponent(key)}?token=${mockToken}&expires=${encodeURIComponent(expiresAt)}`;
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

  /**
   * Retrieves a readable Node.js stream for the stored object
   */
  public async getObjectStream(key: string): Promise<NodeJS.ReadableStream> {
    const record = this.storage.get(key);
    if (!record) {
      throw new Error(`Object key '${key}' not found in storage bucket. Please re-upload.`);
    }
    return Readable.from(record.buffer);
  }

  /**
   * Retrieves the raw Buffer for the stored object
   */
  public async getObjectBuffer(key: string): Promise<Buffer> {
    const record = this.storage.get(key);
    if (!record) {
      throw new Error(`Object key '${key}' not found in storage bucket. Please re-upload.`);
    }
    return Buffer.from(record.buffer);
  }

  /**
   * Stores an object in memory
   */
  public async putObject(params: StoragePutParams): Promise<StoragePutResult> {
    const { key, body, contentType = "image/png", metadata } = params;
    if (!key) {
      throw new Error("Object key is required for putObject.");
    }

    const buffer = await streamToBuffer(body);
    this.storage.set(key, {
      buffer,
      contentType,
      createdAt: new Date(),
      metadata
    });

    const publicUrl = this.getPublicUrl(key);
    return {
      key,
      publicUrl,
      imageUrl: publicUrl,
      sizeBytes: buffer.length
    };
  }

  /**
   * Checks if an object exists in storage
   */
  public async exists(key: string): Promise<boolean> {
    return this.storage.has(key);
  }

  /**
   * Deletes an object from storage
   */
  public async deleteObject(key: string): Promise<boolean> {
    return this.storage.delete(key);
  }

  /**
   * Returns the public CDN / access URL for a given object key
   */
  public getPublicUrl(key: string): string {
    const cleanKey = key.replace(/^\/+/, "");
    return `${this.cdnBaseUrl}/${cleanKey}`;
  }

  /**
   * Returns object metadata
   */
  public async getMetadata(key: string): Promise<StorageObjectMetadata | null> {
    const record = this.storage.get(key);
    if (!record) return null;

    const hash = crypto.createHash("md5").update(record.buffer).digest("hex");
    return {
      contentType: record.contentType,
      contentLength: record.buffer.length,
      lastModified: record.createdAt,
      eTag: `"${hash}"`,
      metadata: record.metadata
    };
  }

  /**
   * Resets all stored objects in memory (for test isolation)
   */
  public async reset(): Promise<void> {
    this.storage.clear();
  }

  /**
   * Helper: returns total count of stored items
   */
  public size(): number {
    return this.storage.size;
  }

  /**
   * Helper: returns all stored keys
   */
  public keys(): string[] {
    return Array.from(this.storage.keys());
  }
}
