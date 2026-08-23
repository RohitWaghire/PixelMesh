/**
 * PixelMesh Phase 3 - Direct Object Storage Transport Type Definitions
 */

import { Readable } from "stream";

export type StorageDriver = "memory" | "local" | "s3" | "r2" | "auto";

export interface PreSignedUploadResult {
  uploadUrl: string;
  imageKey: string;
  publicUrl: string;
  expiresAt: string;
  method: "PUT";
  headers: Record<string, string>;
  maxSizeBytes?: number;
}

export interface StorageObjectMetadata {
  contentType: string;
  contentLength: number;
  lastModified: Date;
  eTag?: string;
  metadata?: Record<string, string>;
}

export interface StorageUploadParams {
  key?: string;
  filename?: string;
  prefix?: string;
  contentType?: string;
  expiresInSeconds?: number;
  maxSizeBytes?: number;
}

export interface StoragePutParams {
  key: string;
  body: Buffer | Uint8Array | NodeJS.ReadableStream | ReadableStream | string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StoragePutResult {
  key: string;
  publicUrl: string;
  imageUrl?: string;
  sizeBytes: number;
}

export interface StorageConfig {
  driver?: StorageDriver;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  cdnBaseUrl?: string;
  localStorageDir?: string;
  maxFileSizeBytes?: number;
  defaultExpiresInSeconds?: number;
}

export interface StorageAdapter {
  getUploadUrl(
    paramsOrKey: StorageUploadParams | string,
    contentType?: string,
    expiresInSeconds?: number
  ): Promise<PreSignedUploadResult>;

  getObjectStream(key: string): Promise<NodeJS.ReadableStream>;
  getObjectBuffer(key: string): Promise<Buffer>;

  putObject(params: StoragePutParams): Promise<StoragePutResult>;
  deleteObject(key: string): Promise<boolean>;
  getPublicUrl(key: string): string;
  exists(key: string): Promise<boolean>;
  getMetadata?(key: string): Promise<StorageObjectMetadata | null>;
  reset?(): Promise<void>;
}

export interface ImageInputParams {
  image_base64?: string;
  image_key?: string;
  image_url?: string;
  imageBase64?: string;
  imageKey?: string;
  imageUrl?: string;
  return_type?: "base64" | "storage" | "url";
  returnType?: "base64" | "storage" | "url";
}

export interface ResolvedImageInput {
  buffer: Buffer;
  mimeType: string;
  format?: string;
  sourceType: "base64" | "storage" | "url";
  sourceKey?: string;
  sourceUrl?: string;
}
