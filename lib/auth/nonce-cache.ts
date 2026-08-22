/**
 * PixelMesh Phase 1 - Distributed Anti-Replay Nonce Cache
 * 
 * Protects against replay attacks across distributed server instances using
 * Redis atomic `SET key value EX 60 NX` with pre-flight clock skew validation.
 */

import { getRedisClient, RedisClientInterface } from "@/lib/redis/client";

/**
 * Result of validating and recording a nonce in the distributed cache.
 */
export interface NonceValidationResult {
  valid: boolean;
  reason?: string;
  statusCode?: number;
}

export const NONCE_KEY_PREFIX = "pixelmesh:nonce:";

export class NonceCache {
  private readonly maxWindowSeconds: number;
  private customRedisClient?: RedisClientInterface;

  /**
   * @param maxWindowSeconds Allowed clock skew and TTL window in seconds (default: 60)
   * @param redisClient Optional explicit Redis client instance (e.g. for testing)
   */
  constructor(maxWindowSeconds = 60, redisClient?: RedisClientInterface) {
    this.maxWindowSeconds = maxWindowSeconds;
    this.customRedisClient = redisClient;
  }

  /**
   * Resolves the active Redis client interface (custom client or global singleton).
   */
  private get redis(): RedisClientInterface {
    return this.customRedisClient ?? getRedisClient();
  }

  /**
   * Returns current unix timestamp in seconds, respecting simulated time in InMemoryRedisClient if active.
   */
  private getNowSeconds(): number {
    if (this.redis && typeof this.redis.getNowSeconds === "function") {
      return this.redis.getNowSeconds();
    }
    if (this.redis && typeof this.redis.getNow === "function") {
      return Math.floor(this.redis.getNow() / 1000);
    }
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Returns the configured sliding window duration in seconds.
   */
  public getWindowSeconds(): number {
    return this.maxWindowSeconds;
  }

  /**
   * Formats the Redis key for a given nonce string.
   */
  public formatKey(nonce: string): string {
    return `${NONCE_KEY_PREFIX}${nonce}`;
  }

  /**
   * Asynchronously validates timestamp clock skew and records the nonce in Redis
   * using atomic `SET pixelmesh:nonce:<nonce> <timestamp> EX 60 NX`.
   * 
   * Pre-conditions:
   * 1. Nonce must be a non-empty string.
   * 2. Timestamp must be a valid numeric unix timestamp in seconds.
   * 3. Clock drift (|now - timestamp|) must be <= maxWindowSeconds (60s).
   * 
   * Distributed Anti-Replay Protocol:
   * 1. Performs local clock skew validation. If drift > 60s, immediately rejects (HTTP 401)
   *    without sending a command to Redis.
   * 2. Issues `SET pixelmesh:nonce:<nonce> <timestamp> EX 60 NX` to Redis.
   * 3. If Redis returns "OK", the nonce is fresh and recorded with 60s TTL -> valid: true.
   * 4. If Redis returns null (key exists), duplicate nonce detected -> valid: false (HTTP 401).
   * 5. If Redis throws an unexpected error, fails closed -> valid: false (HTTP 500).
   */
  public async checkAndRecord(
    nonce: string,
    timestampSeconds: number
  ): Promise<NonceValidationResult> {
    // 1. Input Sanitization & Type Validation
    if (!nonce || typeof nonce !== "string" || nonce.trim() === "") {
      return {
        valid: false,
        reason: "Invalid nonce: Nonce must be a non-empty string",
        statusCode: 401
      };
    }

    if (
      typeof timestampSeconds !== "number" ||
      isNaN(timestampSeconds) ||
      !isFinite(timestampSeconds)
    ) {
      return {
        valid: false,
        reason: "Invalid timestamp: Timestamp must be a valid numeric unix timestamp in seconds",
        statusCode: 401
      };
    }

    // 2. Pre-Redis Clock Skew Verification (|now - timestamp| > 60s)
    const now = this.getNowSeconds();
    const drift = Math.abs(now - timestampSeconds);

    if (drift > this.maxWindowSeconds) {
      return {
        valid: false,
        reason: `Timestamp clock skew too large (${drift}s > ${this.maxWindowSeconds}s)`,
        statusCode: 401
      };
    }

    // 3. Distributed Redis Atomic SET EX NX
    const key = this.formatKey(nonce);

    try {
      const res = await this.redis.set(
        key,
        String(timestampSeconds),
        "EX",
        this.maxWindowSeconds,
        "NX"
      );

      // If SET ... NX returned null, the key already existed in the cache (replay attack)
      if (res !== "OK") {
        return {
          valid: false,
          reason: "Replay attack detected: Nonce has already been used",
          statusCode: 401
        };
      }

      return { valid: true };
    } catch (err: any) {
      console.error(`[NonceCache] Redis operation failed for key "${key}":`, err);
      // Security fail-closed: Do not allow unverified nonces during cache outage
      return {
        valid: false,
        reason: `Anti-replay cache error: ${err?.message || "Internal cache failure"}`,
        statusCode: 500
      };
    }
  }

  /**
   * Inspects whether a nonce is currently stored in Redis.
   */
  public async exists(nonce: string): Promise<boolean> {
    try {
      const key = this.formatKey(nonce);
      const val = await this.redis.get(key);
      return val !== null;
    } catch {
      return false;
    }
  }

  /**
   * Retrieves the remaining TTL in seconds for a stored nonce.
   * Returns -2 if key does not exist or has expired.
   */
  public async getTTL(nonce: string): Promise<number> {
    try {
      const key = this.formatKey(nonce);
      return await this.redis.ttl(key);
    } catch {
      return -2;
    }
  }

  /**
   * Deletes a nonce from the cache (e.g. for testing or administrative revocation).
   */
  public async delete(nonce: string): Promise<boolean> {
    try {
      const key = this.formatKey(nonce);
      const count = await this.redis.del(key);
      return count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Clears all nonces from the Redis cache (for test suite isolation).
   */
  public async clear(): Promise<void> {
    try {
      if (typeof this.redis.flushall === "function") {
        await this.redis.flushall();
      } else if (typeof (this.redis as any).reset === "function") {
        (this.redis as any).reset();
      }
    } catch (err) {
      console.warn("[NonceCache] Clear operation failed:", err);
    }
  }

  /**
   * Legacy prune method preserved for backwards compatibility.
   * Redis automatically prunes expired keys using native TTL (EX 60).
   */
  public prune(): void {
    // No-op in distributed Redis architecture
  }
}

/**
 * Global singleton NonceCache instance configured with default 60-second window.
 */
export const nonceCache = new NonceCache(60);
