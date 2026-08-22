/**
 * PixelMesh Phase 3 - Local Filesystem Storage Adapter
 * 
 * Persists image assets to a local directory (default: `.storage/`) with strict
 * path-traversal sanitization and streaming read/write capabilities.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Readable, pipeline } from "stream";
import { promisify } from "util";
import {
  StorageAdapter,
  StorageUploadParams,
  StoragePutParams,
  StoragePutResult,
  PreSignedUploadResult,
  StorageObjectMetadata,
  StorageConfig
} from "./types";

const streamPipeline = promisify(pipeline);

export class LocalStorageAdapter implements StorageAdapter {
  private baseDir: string;
  private cdnBaseUrl: string;
  private defaultExpiresInSeconds: number;

  constructor(config?: StorageConfig) {
    this.baseDir = path.resolve(process.cwd(), config?.localStorageDir || ".storage");
    this.cdnBaseUrl = config?.cdnBaseUrl?.replace(/\/$/, "") || "http://localhost:3000/api/mcp/storage";
    this.defaultExpiresInSeconds = config?.defaultExpiresInSeconds || 900;
  }

  /**
   * Sanitizes object key and prevents directory traversal attacks
   */
  private resolveSafePath(key: string): string {
    if (!key || typeof key !== "string" || key.trim() === "") {
      throw new Error("Invalid object key: must be a non-empty string.");
    }

    // Reject absolute paths and directory traversal sequences
    if (
      key.startsWith("/") ||
      key.startsWith("\\") ||
      /^[a-zA-Z]:/.test(key) ||
      key.includes("..")
    ) {
      throw new Error(`Security Violation: Path traversal detected for key '${key}'. Access denied.`);
    }

    // Resolve absolute path
    const resolvedPath = path.resolve(this.baseDir, key);
    const resolvedBase = path.resolve(this.baseDir);

    // Strict path containment check
    if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
      throw new Error(`Security Violation: Path traversal detected for key '${key}'. Access denied.`);
    }

    return resolvedPath;
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
   * Generates a pre-signed upload URL for local storage
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
    const uploadUrl = `${this.cdnBaseUrl}/upload/${encodeURIComponent(key)}?token=${mockToken}&expires=${encodeURIComponent(expiresAt)}`;
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
   * Retrieves a readable Node.js stream for the stored object from disk
   */
  public async getObjectStream(key: string): Promise<NodeJS.ReadableStream> {
    const filePath = this.resolveSafePath(key);
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      throw new Error(`Object key '${key}' not found in storage bucket. Please re-upload.`);
    }

    return fs.createReadStream(filePath);
  }

  /**
   * Retrieves the raw Buffer for the stored object from disk
   */
  public async getObjectBuffer(key: string): Promise<Buffer> {
    const filePath = this.resolveSafePath(key);
    try {
      return await fs.promises.readFile(filePath);
    } catch {
      throw new Error(`Object key '${key}' not found in storage bucket. Please re-upload.`);
    }
  }

  /**
   * Stores an object on the local filesystem
   */
  public async putObject(params: StoragePutParams): Promise<StoragePutResult> {
    const { key, body, contentType = "image/png", metadata } = params;
    if (!key) {
      throw new Error("Object key is required for putObject.");
    }

    const filePath = this.resolveSafePath(key);
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    let writtenBytes = 0;

    if (Buffer.isBuffer(body)) {
      await fs.promises.writeFile(filePath, body);
      writtenBytes = body.length;
    } else if (body instanceof Uint8Array) {
      const buffer = Buffer.from(body);
      await fs.promises.writeFile(filePath, buffer);
      writtenBytes = buffer.length;
    } else if (typeof body === "string") {
      const buffer = Buffer.from(body, "utf-8");
      await fs.promises.writeFile(filePath, buffer);
      writtenBytes = buffer.length;
    } else if (typeof (body as any).getReader === "function") {
      // Web ReadableStream
      const reader = (body as ReadableStream).getReader();
      const writeStream = fs.createWriteStream(filePath);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            writeStream.write(Buffer.from(value));
            writtenBytes += value.length;
          }
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          writeStream.end((err: any) => (err ? reject(err) : resolve()));
        });
      }
    } else {
      // Node.js Readable stream
      const writeStream = fs.createWriteStream(filePath);
      await streamPipeline(body as NodeJS.ReadableStream, writeStream);
      const stat = await fs.promises.stat(filePath);
      writtenBytes = stat.size;
    }

    // Optionally save sidecar metadata if provided
    if (metadata && Object.keys(metadata).length > 0) {
      try {
        await fs.promises.writeFile(
          `${filePath}.meta.json`,
          JSON.stringify({ contentType, metadata, createdAt: new Date() }),
          "utf-8"
        );
      } catch {
        // Non-critical metadata persistence
      }
    }

    const publicUrl = this.getPublicUrl(key);
    return {
      key,
      publicUrl,
      imageUrl: publicUrl,
      sizeBytes: writtenBytes
    };
  }

  /**
   * Checks if an object exists on disk
   */
  public async exists(key: string): Promise<boolean> {
    try {
      const filePath = this.resolveSafePath(key);
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deletes an object and its sidecar metadata from disk
   */
  public async deleteObject(key: string): Promise<boolean> {
    try {
      const filePath = this.resolveSafePath(key);
      await fs.promises.unlink(filePath);
      try {
        await fs.promises.unlink(`${filePath}.meta.json`);
      } catch {
        // Ignored
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the public access URL for a given object key
   */
  public getPublicUrl(key: string): string {
    const cleanKey = key.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    return `${this.cdnBaseUrl}/${cleanKey}`;
  }

  /**
   * Returns metadata for stored file
   */
  public async getMetadata(key: string): Promise<StorageObjectMetadata | null> {
    try {
      const filePath = this.resolveSafePath(key);
      const stat = await fs.promises.stat(filePath);

      let contentType = "application/octet-stream";
      let metaRecord: Record<string, string> | undefined;

      try {
        const metaContent = await fs.promises.readFile(`${filePath}.meta.json`, "utf-8");
        const parsed = JSON.parse(metaContent);
        contentType = parsed.contentType || contentType;
        metaRecord = parsed.metadata;
      } catch {
        const ext = path.extname(key).toLowerCase();
        if (ext === ".png") contentType = "image/png";
        else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
        else if (ext === ".webp") contentType = "image/webp";
      }

      return {
        contentType,
        contentLength: stat.size,
        lastModified: stat.mtime,
        eTag: `"${stat.size}-${stat.mtimeMs}"`,
        metadata: metaRecord
      };
    } catch {
      return null;
    }
  }

  /**
   * Resets and clears the local storage directory (for test isolation)
   */
  public async reset(): Promise<void> {
    try {
      await fs.promises.rm(this.baseDir, { recursive: true, force: true });
    } catch {
      // Ignored if directory does not exist
    }
  }
}
