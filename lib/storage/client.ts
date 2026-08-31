/**
 * PixelMesh Phase 3 - Unified Storage Client Singleton & Factory
 * 
 * Dynamically resolves and caches the active StorageAdapter based on environment
 * configuration (memory, local filesystem, AWS S3, or Cloudflare R2).
 */

import { StorageAdapter, StorageConfig, StorageDriver } from "./types";
import { InMemoryStorageAdapter } from "./memory-adapter";
import { LocalStorageAdapter } from "./local-adapter";
import { S3StorageAdapter } from "./s3-adapter";

declare global {
  var __pixelmesh_storage__: StorageAdapter | undefined;
}

/**
 * Determines the appropriate storage driver from environment variables
 */
export function resolveStorageDriver(explicitDriver?: StorageDriver): StorageDriver {
  if (explicitDriver && explicitDriver !== "auto") {
    return explicitDriver;
  }

  const envDriver = process.env.STORAGE_DRIVER?.toLowerCase();
  if (envDriver === "memory" || envDriver === "local" || envDriver === "s3" || envDriver === "r2") {
    return envDriver as StorageDriver;
  }

  if (process.env.USE_IN_MEMORY_STORAGE === "true") {
    return "memory";
  }

  if (process.env.S3_BUCKET && (process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID)) {
    return "s3";
  }

  if (process.env.LOCAL_STORAGE_DIR) {
    return "local";
  }

  if (process.env.NODE_ENV === "test") {
    return "memory";
  }

  if (process.env.NODE_ENV === "development") {
    return "local";
  }

  return "memory";
}

/**
 * Creates a new StorageAdapter instance with the provided configuration
 */
export function createStorageAdapter(config?: StorageConfig): StorageAdapter {
  const driver = resolveStorageDriver(config?.driver);
  const isProduction = process.env.NODE_ENV === "production";
  const allowMock = process.env.ALLOW_MOCK_IN_PRODUCTION === "true";
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build" || process.env.BUILD_PHASE === "true";

  if (driver === "memory") {
    if (isProduction && !allowMock && !isBuildPhase) {
      throw new Error("[Storage] FATAL: Production requires a persistent storage backend (S3/R2 or LOCAL_STORAGE_DIR). Refusing to boot with in-memory adapter.");
    }
    return new InMemoryStorageAdapter(config);
  }

  switch (driver) {
    case "local":
      return new LocalStorageAdapter(config);
    case "s3":
    case "r2":
      return new S3StorageAdapter(config);
    default:
      return new InMemoryStorageAdapter(config);
  }
}

/**
 * Retrieves or initializes the global StorageClient singleton
 */
export function getStorageClient(config?: StorageConfig): StorageAdapter {
  if (config) {
    return createStorageAdapter(config);
  }

  if (!globalThis.__pixelmesh_storage__) {
    globalThis.__pixelmesh_storage__ = createStorageAdapter();
  }

  return globalThis.__pixelmesh_storage__;
}

/**
 * Overrides or sets the global storage client instance (useful for unit testing)
 */
export function setStorageClient(adapter: StorageAdapter | null): void {
  if (adapter === null) {
    delete globalThis.__pixelmesh_storage__;
  } else {
    globalThis.__pixelmesh_storage__ = adapter;
  }
}

/**
 * Clears and resets the active mock storage adapter
 */
export async function resetMockStorage(): Promise<void> {
  const client = getStorageClient();
  if (client && typeof client.reset === "function") {
    await client.reset();
  }
}

/**
 * Storage client proxy that delegates to the active singleton
 */
export const storageClient: StorageAdapter = new Proxy({} as StorageAdapter, {
  get(_target, prop: string | symbol) {
    const client = getStorageClient();
    const value = (client as any)[prop];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  }
});
