/**
 * PixelMesh Hybrid Rate Limiter
 * 
 * Supports:
 * 1. Distributed Redis sliding-window via INCR/EXPIRE or ZADD when Redis backend is active.
 * 2. In-Memory sliding-window Map fallback for local development, offline mode, and testing.
 */

import { redis } from "../redis/client";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

interface InMemoryRateLimitEntry {
  count: number;
  expiresAtMs: number;
}

class InMemoryRateLimiter {
  private store = new Map<string, InMemoryRateLimitEntry>();

  public checkAndIncrement(key: string, limit: number, windowSeconds: number): RateLimitResult {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now >= entry.expiresAtMs) {
      const expiresAtMs = now + windowSeconds * 1000;
      this.store.set(key, { count: 1, expiresAtMs });
      return {
        allowed: true,
        limit,
        remaining: limit - 1,
        resetSeconds: windowSeconds
      };
    }

    if (entry.count >= limit) {
      const resetSeconds = Math.max(1, Math.ceil((entry.expiresAtMs - now) / 1000));
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds
      };
    }

    entry.count++;
    const resetSeconds = Math.max(1, Math.ceil((entry.expiresAtMs - now) / 1000));
    return {
      allowed: true,
      limit,
      remaining: limit - entry.count,
      resetSeconds
    };
  }

  public reset(): void {
    this.store.clear();
  }
}

export const inMemoryRateLimiter = new InMemoryRateLimiter();

/**
 * Checks and increments rate limit for a given key (e.g. IP address or key fingerprint)
 */
export async function checkRateLimit(
  key: string,
  limit: number = 20,
  windowSeconds: number = 60
): Promise<RateLimitResult> {
  const rateLimitKey = `pixelmesh:ratelimit:${key}`;

  try {
    if (typeof redis.incr === "function" && typeof redis.expire === "function") {
      const count = await redis.incr(rateLimitKey);

      let resetSeconds = windowSeconds;
      if (count === 1) {
        await redis.expire(rateLimitKey, windowSeconds);
      } else {
        const ttl = typeof redis.ttl === "function" ? await redis.ttl(rateLimitKey) : -1;
        // If Redis accepted INCR but key has no TTL (ttl === -1) or expired, restore TTL to heal counter
        if (ttl <= 0) {
          await redis.expire(rateLimitKey, windowSeconds);
          resetSeconds = windowSeconds;
        } else {
          resetSeconds = ttl;
        }
      }

      if (count > limit) {
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetSeconds
        };
      }

      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - count),
        resetSeconds
      };
    }

    // Fallback if incr/expire not implemented on custom client
    const currentVal = await redis.get(rateLimitKey);
    if (currentVal === null) {
      await redis.set(rateLimitKey, "1", "EX", windowSeconds);
      return {
        allowed: true,
        limit,
        remaining: limit - 1,
        resetSeconds: windowSeconds
      };
    }

    const currentCount = parseInt(currentVal, 10);
    const ttl = await redis.ttl(rateLimitKey);
    const resetSeconds = ttl > 0 ? ttl : windowSeconds;

    if (currentCount >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds
      };
    }

    const newCount = (currentCount + 1).toString();
    await redis.set(rateLimitKey, newCount, "EX", resetSeconds);

    return {
      allowed: true,
      limit,
      remaining: limit - (currentCount + 1),
      resetSeconds
    };
  } catch {
    // Fallback to in-memory rate limiter on any Redis failure
    return inMemoryRateLimiter.checkAndIncrement(key, limit, windowSeconds);
  }
}

/**
 * Helper to extract client IP address from Next.js request headers
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "127.0.0.1";
}
