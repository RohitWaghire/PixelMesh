/**
 * PixelMesh Phase 1 - Multi-Backend Redis Client Architecture
 * 
 * Supports:
 * 1. TCP Redis via `ioredis` (REDIS_URL)
 * 2. REST Redis via `@upstash/redis` (UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN)
 * 3. In-Memory Mock Adapter (`InMemoryRedisClient`) for unit testing, offline development, and CI
 */

export interface RedisClientInterface {
  set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
    flag?: "NX"
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  flushall?(): Promise<void>;
  reset?(): void;
  disconnect?(): Promise<void>;
  advanceTime?(seconds: number): void;
  getNow?(): number;
  getNowSeconds?(): number;
}

export type RedisBackendType = "ioredis" | "upstash" | "memory";

interface StoredEntry {
  value: string;
  expiresAtMs: number | null;
  createdAtMs: number;
}

// ============================================================================
// 1. In-Memory Mock Implementation
// ============================================================================

export class InMemoryRedisClient implements RedisClientInterface {
  private store = new Map<string, StoredEntry>();
  private simulatedTimeOffsetMs = 0;

  public getNow(): number {
    return Date.now() + this.simulatedTimeOffsetMs;
  }

  public getNowSeconds(): number {
    return Math.floor(this.getNow() / 1000);
  }

  private pruneKeyIfExpired(key: string, entry: StoredEntry): boolean {
    if (entry.expiresAtMs !== null && this.getNow() >= entry.expiresAtMs) {
      this.store.delete(key);
      return true;
    }
    return false;
  }

  public async set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
    flag?: "NX"
  ): Promise<string | null> {
    const now = this.getNow();
    const existing = this.store.get(key);

    if (existing && !this.pruneKeyIfExpired(key, existing)) {
      if (flag === "NX") {
        return null;
      }
    }

    const expiresAtMs = ttlSeconds > 0 ? now + ttlSeconds * 1000 : null;
    this.store.set(key, {
      value: String(value),
      expiresAtMs,
      createdAtMs: now
    });

    return "OK";
  }

  public async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (this.pruneKeyIfExpired(key, entry)) {
      return null;
    }

    return entry.value;
  }

  public async del(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;

    if (this.pruneKeyIfExpired(key, entry)) {
      return 0;
    }

    this.store.delete(key);
    return 1;
  }

  public async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;

    if (this.pruneKeyIfExpired(key, entry)) {
      return -2;
    }

    if (entry.expiresAtMs === null) return -1;

    const remainingMs = entry.expiresAtMs - this.getNow();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  public async flushall(): Promise<void> {
    this.store.clear();
  }

  public reset(): void {
    this.store.clear();
    this.simulatedTimeOffsetMs = 0;
  }

  public advanceTime(seconds: number): void {
    this.simulatedTimeOffsetMs += seconds * 1000;
  }

  public size(): number {
    let count = 0;
    for (const [k, v] of this.store.entries()) {
      if (!this.pruneKeyIfExpired(k, v)) {
        count++;
      }
    }
    return count;
  }

  public keys(pattern?: string): string[] {
    const activeKeys: string[] = [];
    for (const [k, v] of this.store.entries()) {
      if (!this.pruneKeyIfExpired(k, v)) {
        if (!pattern || pattern === "*" || k.includes(pattern.replace(/\*/g, ""))) {
          activeKeys.push(k);
        }
      }
    }
    return activeKeys;
  }
}

// ============================================================================
// 2. Upstash REST Adapter Implementation
// ============================================================================

export class UpstashRedisClientAdapter implements RedisClientInterface {
  private client: any;

  constructor(client: any) {
    this.client = client;
  }

  public async set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
    flag?: "NX"
  ): Promise<string | null> {
    const options: any = { ex: ttlSeconds };
    if (flag === "NX") {
      options.nx = true;
    }
    const res = await this.client.set(key, value, options);
    return res === "OK" ? "OK" : null;
  }

  public async get(key: string): Promise<string | null> {
    const res = await this.client.get(key);
    if (res === null || res === undefined) return null;
    return typeof res === "string" ? res : JSON.stringify(res);
  }

  public async del(key: string): Promise<number> {
    const res = await this.client.del(key);
    return typeof res === "number" ? res : res ? 1 : 0;
  }

  public async ttl(key: string): Promise<number> {
    const res = await this.client.ttl(key);
    return typeof res === "number" ? res : -2;
  }

  public async flushall(): Promise<void> {
    if (typeof this.client.flushall === "function") {
      await this.client.flushall();
    }
  }
}

// ============================================================================
// 3. IORedis TCP Adapter Implementation
// ============================================================================

export class IORedisClientAdapter implements RedisClientInterface {
  private client: any;

  constructor(client: any) {
    this.client = client;
  }

  public async set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
    flag?: "NX"
  ): Promise<string | null> {
    let res: any;
    if (flag === "NX") {
      res = await this.client.set(key, value, "EX", ttlSeconds, "NX");
    } else {
      res = await this.client.set(key, value, "EX", ttlSeconds);
    }
    return res === "OK" ? "OK" : null;
  }

  public async get(key: string): Promise<string | null> {
    const res = await this.client.get(key);
    return res !== null && res !== undefined ? String(res) : null;
  }

  public async del(key: string): Promise<number> {
    const res = await this.client.del(key);
    return typeof res === "number" ? res : res ? 1 : 0;
  }

  public async ttl(key: string): Promise<number> {
    const res = await this.client.ttl(key);
    return typeof res === "number" ? res : -2;
  }

  public async flushall(): Promise<void> {
    if (typeof this.client.flushall === "function") {
      await this.client.flushall();
    }
  }

  public async disconnect(): Promise<void> {
    if (typeof this.client.quit === "function") {
      await this.client.quit();
    } else if (typeof this.client.disconnect === "function") {
      this.client.disconnect();
    }
  }
}

// ============================================================================
// 4. Singleton Instantiation & Global Caching Engine
// ============================================================================

declare global {
  // eslint-disable-next-line no-var
  var __pixelmesh_redis__: RedisClientInterface | undefined;
  // eslint-disable-next-line no-var
  var __pixelmesh_redis_backend__: RedisBackendType | undefined;
}

export function determineRedisBackend(): RedisBackendType {
  if (process.env.USE_IN_MEMORY_REDIS === "true" || process.env.MOCK_REDIS === "true") {
    return "memory";
  }
  if (process.env.NODE_ENV === "test" && process.env.TEST_USE_REAL_REDIS !== "true") {
    return "memory";
  }

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (upstashUrl && upstashToken && !upstashUrl.startsWith("mock:") && !upstashUrl.startsWith("memory:")) {
    return "upstash";
  }

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && !redisUrl.startsWith("mock:") && !redisUrl.startsWith("memory:") && !redisUrl.startsWith("test:")) {
    return "ioredis";
  }

  return "memory";
}

function createRedisInstance(): { client: RedisClientInterface; backend: RedisBackendType } {
  const backend = determineRedisBackend();

  if (backend === "upstash") {
    try {
      // Dynamic import to prevent crash when @upstash/redis is optional/missing
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Redis: UpstashRedis } = require("@upstash/redis");
      const rawClient = new UpstashRedis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!
      });
      return { client: new UpstashRedisClientAdapter(rawClient), backend: "upstash" };
    } catch (err) {
      console.warn("[Redis] @upstash/redis initialization failed. Falling back to InMemoryRedisClient.", err);
      return { client: new InMemoryRedisClient(), backend: "memory" };
    }
  }

  if (backend === "ioredis") {
    try {
      // Dynamic import to prevent crash when ioredis is optional/missing
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const IORedis = require("ioredis");
      const rawClient = new IORedis(process.env.REDIS_URL!, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false
      });
      return { client: new IORedisClientAdapter(rawClient), backend: "ioredis" };
    } catch (err) {
      console.warn("[Redis] ioredis initialization failed. Falling back to InMemoryRedisClient.", err);
      return { client: new InMemoryRedisClient(), backend: "memory" };
    }
  }

  return { client: new InMemoryRedisClient(), backend: "memory" };
}

export function getRedisClient(): RedisClientInterface {
  if (globalThis.__pixelmesh_redis__) {
    return globalThis.__pixelmesh_redis__;
  }

  const { client, backend } = createRedisInstance();
  globalThis.__pixelmesh_redis__ = client;
  globalThis.__pixelmesh_redis_backend__ = backend;

  return client;
}

export const redis: RedisClientInterface = getRedisClient();

export function getRedisBackend(): RedisBackendType {
  return globalThis.__pixelmesh_redis_backend__ ?? determineRedisBackend();
}

export function resetMockRedis(): void {
  const client = getRedisClient();
  if (client instanceof InMemoryRedisClient) {
    client.reset();
  } else if ((client as any).reset) {
    (client as any).reset();
  }
}
