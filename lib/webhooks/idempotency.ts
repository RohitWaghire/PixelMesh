/**
 * PixelMesh Webhook Idempotency & Delivery Cache
 * 
 * Guards against replay attacks and duplicate event processing by tracking
 * X-GitHub-Delivery identifiers with configurable TTL across Redis or in-memory stores.
 * 
 * @module lib/webhooks/idempotency
 */

import { getRedisClient } from "@/lib/redis/client";

const DEFAULT_DELIVERY_TTL_SECONDS = 86400; // 24 hours
const DELIVERY_KEY_PREFIX = "pixelmesh:webhook:delivery:";

export class WebhookIdempotencyStore {
  private memoryStore: Map<string, { expiresAt: number; eventName: string }> = new Map();

  /**
   * Cleans up expired in-memory delivery keys
   */
  private pruneMemory(): void {
    const now = Date.now();
    for (const [key, record] of this.memoryStore.entries()) {
      if (record.expiresAt <= now) {
        this.memoryStore.delete(key);
      }
    }
  }

  /**
   * Attempts to record a delivery identifier.
   * Returns true if newly recorded (first time observed), false if already recorded (duplicate/replay).
   * 
   * @param deliveryId GitHub delivery UUID from X-GitHub-Delivery
   * @param eventName GitHub event type (e.g. 'pull_request')
   * @param ttlSeconds Expiration window in seconds (default 86400 = 24h)
   */
  public async checkAndRecordDelivery(
    deliveryId: string,
    eventName: string,
    ttlSeconds: number = DEFAULT_DELIVERY_TTL_SECONDS
  ): Promise<boolean> {
    if (!deliveryId) return false;

    const redisKey = `${DELIVERY_KEY_PREFIX}${deliveryId}`;
    const redis = getRedisClient();

    try {
      // Use atomic Redis SET key EX ttl NX if available
      if (typeof redis.set === "function") {
        const result = await redis.set(redisKey, eventName, "EX", ttlSeconds, "NX");
        return result === "OK";
      }
    } catch {
      // Fall through to in-memory store if Redis encounters a transient failure
    }

    this.pruneMemory();
    const now = Date.now();
    const existing = this.memoryStore.get(deliveryId);

    if (existing && existing.expiresAt > now) {
      return false; // Already processed
    }

    this.memoryStore.set(deliveryId, {
      expiresAt: now + ttlSeconds * 1000,
      eventName,
    });
    return true;
  }

  /**
   * Checks whether a delivery identifier has already been recorded.
   */
  public async isDeliveryProcessed(deliveryId: string): Promise<boolean> {
    if (!deliveryId) return false;

    const redisKey = `${DELIVERY_KEY_PREFIX}${deliveryId}`;
    const redis = getRedisClient();

    try {
      const val = await redis.get(redisKey);
      if (val !== null) return true;
    } catch {
      // Fall through
    }

    this.pruneMemory();
    const existing = this.memoryStore.get(deliveryId);
    return Boolean(existing && existing.expiresAt > Date.now());
  }

  /**
   * Clears all cached deliveries (primarily for automated testing teardown).
   */
  public async clear(): Promise<void> {
    this.memoryStore.clear();
    const redis = getRedisClient();
    if (typeof redis.flushall === "function") {
      // Avoid flushing all of redis in production; reset is supported on mock client
      if (typeof (redis as any).reset === "function") {
        (redis as any).reset();
      }
    }
  }
}

export const webhookIdempotency = new WebhookIdempotencyStore();
