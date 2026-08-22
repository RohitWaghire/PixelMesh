/**
 * PixelMesh Phase 1 - Distributed Anti-Replay Nonce Cache Test Suite
 * 
 * Test Scenarios:
 * 1. Fresh nonce recording with 60s TTL and Redis key format validation.
 * 2. Isolated key prefixing prevents namespace collisions.
 * 3. Immediate replay rejection for duplicate nonces within the 60s window.
 * 4. Nonce expiration after 60s allows re-use if timestamp is fresh.
 * 5. Expired nonce with stale timestamp rejected by clock skew without Redis write.
 * 6. Clock skew drift > 60s (past and future) rejected without Redis write.
 * 7. Exact 60s boundary drift tests (0s, 60s valid; 61s invalid).
 * 8. High-concurrency race condition defense (25 identical nonces -> 1 winner, 24 rejected).
 * 9. Interleaved multi-nonce high-concurrency race test (50 concurrent requests).
 * 10. Input sanitization & adversarial nonces (special chars, colons, unicode, large payloads).
 * 11. Invalid timestamp formats (NaN, Infinity, non-numeric).
 * 12. Custom sliding window parameterization (maxWindowSeconds).
 * 13. Administrative deletion and cache clearing.
 * 14. Fail-closed fault resilience on Redis connection/execution error.
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { NonceCache, nonceCache, NONCE_KEY_PREFIX } from "./nonce-cache";
import { getRedisClient, resetMockRedis, InMemoryRedisClient, RedisClientInterface } from "../redis/client";

function generateNonce(prefix = "nonce"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function getNowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

beforeEach(async () => {
  resetMockRedis();
  await nonceCache.clear();
});

// ============================================================================
// 1. Fresh Nonce Recording & TTL Lifecycle
// ============================================================================

test("nonce-cache: fresh nonce records in Redis with 60s TTL", async () => {
  const redis = getRedisClient();
  const nonce = generateNonce("fresh");
  const now = getNowSeconds();

  const result = await nonceCache.checkAndRecord(nonce, now);

  assert.equal(result.valid, true, "Fresh nonce must be accepted");
  assert.equal(result.reason, undefined, "Reason must be undefined on valid nonce");

  // Inspect Redis key directly
  const expectedKey = `${NONCE_KEY_PREFIX}${nonce}`;
  const storedValue = await redis.get(expectedKey);
  assert.equal(storedValue, String(now), "Stored Redis value must equal request timestamp");

  const ttl = await redis.ttl(expectedKey);
  assert.ok(ttl >= 59 && ttl <= 60, `TTL must be between 59 and 60 seconds (actual: ${ttl})`);

  // Inspect NonceCache helper methods
  const exists = await nonceCache.exists(nonce);
  assert.equal(exists, true, "nonceCache.exists must return true for active nonce");

  const cacheTtl = await nonceCache.getTTL(nonce);
  assert.ok(cacheTtl >= 59 && cacheTtl <= 60, `nonceCache.getTTL must return remaining TTL (actual: ${cacheTtl})`);
});

test("nonce-cache: isolated key prefixing prevents namespace collisions", async () => {
  const redis = getRedisClient();
  const nonce = "custom-id-9876";
  const now = getNowSeconds();

  await nonceCache.checkAndRecord(nonce, now);

  // Root keyspace should NOT have raw un-prefixed key
  const rawKeyVal = await redis.get(nonce);
  assert.equal(rawKeyVal, null, "Raw nonce must not be written without prefix");

  // Prefixed key must exist
  const prefixedVal = await redis.get(`pixelmesh:nonce:${nonce}`);
  assert.equal(prefixedVal, String(now), "Prefixed key must be present");
});

// ============================================================================
// 2. Immediate Replay Rejection
// ============================================================================

test("nonce-cache: immediate replay rejection for duplicate nonce within 60s window", async () => {
  const nonce = generateNonce("replay");
  const now = getNowSeconds();

  // 1. First invocation: fresh
  const first = await nonceCache.checkAndRecord(nonce, now);
  assert.equal(first.valid, true, "Initial nonce submission must succeed");

  // 2. Second invocation with exact same timestamp: duplicate replay
  const second = await nonceCache.checkAndRecord(nonce, now);
  assert.equal(second.valid, false, "Replayed nonce must be rejected");
  assert.equal(second.statusCode, 401, "Replay status code must be 401");
  assert.ok(
    second.reason?.includes("Replay attack detected"),
    `Reason must indicate replay attack (actual: "${second.reason}")`
  );

  // 3. Third invocation with slightly different timestamp within window: still rejected
  const third = await nonceCache.checkAndRecord(nonce, now + 5);
  assert.equal(third.valid, false, "Replay with altered timestamp must still be rejected");
  assert.equal(third.statusCode, 401);
  assert.ok(third.reason?.includes("Replay attack detected"));
});

// ============================================================================
// 3. Nonce Expiration & Re-use Lifecycle
// ============================================================================

test("nonce-cache: nonce expiration after 60s allows re-use if timestamp is fresh", async () => {
  const inMemoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, inMemoryClient);

  const nonce = generateNonce("expiry-recycle");
  const t0 = getNowSeconds();

  // 1. Initial fresh record
  const res1 = await cache.checkAndRecord(nonce, t0);
  assert.equal(res1.valid, true, "Initial nonce record must succeed");
  assert.equal(await cache.exists(nonce), true);

  // 2. Advance simulated time by 61 seconds (TTL expires)
  inMemoryClient.advanceTime(61);

  // 3. Verify key is expired in Redis
  const existsAfterTtl = await cache.exists(nonce);
  assert.equal(existsAfterTtl, false, "Key must be expired and pruned from cache after 61s");
  assert.equal(await cache.getTTL(nonce), -2, "TTL must be -2 for expired key");

  // 4. Client generates request with SAME nonce but a FRESH timestamp (t0 + 61)
  const freshTimestamp = t0 + 61;
  const res2 = await cache.checkAndRecord(nonce, freshTimestamp);
  assert.equal(res2.valid, true, "Recycled nonce with fresh timestamp must succeed after previous TTL expiration");
  assert.equal(await cache.exists(nonce), true);
});

test("nonce-cache: expired nonce with stale original timestamp is rejected by clock skew without Redis write", async () => {
  const inMemoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, inMemoryClient);

  const nonce = generateNonce("stale-replay");
  const t0 = getNowSeconds();

  // 1. Initial record
  const res1 = await cache.checkAndRecord(nonce, t0);
  assert.equal(res1.valid, true);

  // 2. Advance simulated time by 65 seconds
  inMemoryClient.advanceTime(65);

  // 3. Attacker replays the original captured request with stale timestamp t0
  const res2 = await cache.checkAndRecord(nonce, t0);
  assert.equal(res2.valid, false, "Stale request replay must be rejected");
  assert.equal(res2.statusCode, 401);
  assert.ok(
    res2.reason?.includes("Timestamp clock skew too large"),
    `Reason must indicate clock skew rather than replay (actual: "${res2.reason}")`
  );

  // 4. Ensure Redis key was NOT resurrected
  assert.equal(await cache.exists(nonce), false, "Redis key must remain non-existent for stale rejected request");
});

// ============================================================================
// 4. Clock Skew Drift Rejection (> 60s) Without Redis Write
// ============================================================================

test("nonce-cache: clock skew past drift > 60s rejected without Redis write", async () => {
  const redis = getRedisClient();
  const nonce = generateNonce("past-skew");
  const now = getNowSeconds();
  const staleTimestamp = now - 65; // 65 seconds in the past

  const result = await nonceCache.checkAndRecord(nonce, staleTimestamp);

  assert.equal(result.valid, false, "Past timestamp > 60s must be rejected");
  assert.equal(result.statusCode, 401);
  assert.ok(
    result.reason?.includes("Timestamp clock skew too large"),
    `Reason must indicate clock skew (actual: "${result.reason}")`
  );

  // Verify key was NOT written to Redis
  const storedVal = await redis.get(`pixelmesh:nonce:${nonce}`);
  assert.equal(storedVal, null, "No key should be written to Redis when clock skew fails");
  assert.equal(await nonceCache.exists(nonce), false);
});

test("nonce-cache: clock skew future drift > 60s rejected without Redis write", async () => {
  const redis = getRedisClient();
  const nonce = generateNonce("future-skew");
  const now = getNowSeconds();
  const futureTimestamp = now + 65; // 65 seconds in the future

  const result = await nonceCache.checkAndRecord(nonce, futureTimestamp);

  assert.equal(result.valid, false, "Future timestamp > 60s must be rejected");
  assert.equal(result.statusCode, 401);
  assert.ok(
    result.reason?.includes("Timestamp clock skew too large"),
    `Reason must indicate clock skew (actual: "${result.reason}")`
  );

  // Verify key was NOT written to Redis
  const storedVal = await redis.get(`pixelmesh:nonce:${nonce}`);
  assert.equal(storedVal, null, "No key should be written to Redis for futuristic requests");
  assert.equal(await nonceCache.exists(nonce), false);
});

test("nonce-cache: clock skew exact boundary tests (0s, 60s valid; 61s invalid)", async () => {
  const now = getNowSeconds();

  // Drift = 0s -> Valid
  const res0 = await nonceCache.checkAndRecord(generateNonce("bound-0"), now);
  assert.equal(res0.valid, true, "0s drift must be valid");

  // Drift = 60s in the past -> Valid (boundary condition: drift <= 60)
  const resPast60 = await nonceCache.checkAndRecord(generateNonce("bound-p60"), now - 60);
  assert.equal(resPast60.valid, true, "Exact 60s past drift must be valid");

  // Drift = 60s in the future -> Valid (boundary condition: drift <= 60)
  const resFuture60 = await nonceCache.checkAndRecord(generateNonce("bound-f60"), now + 60);
  assert.equal(resFuture60.valid, true, "Exact 60s future drift must be valid");

  // Drift = 61s in the past -> Invalid (drift > 60)
  const resPast61 = await nonceCache.checkAndRecord(generateNonce("bound-p61"), now - 61);
  assert.equal(resPast61.valid, false, "61s past drift must be rejected");
  assert.equal(resPast61.statusCode, 401);

  // Drift = 61s in the future -> Invalid (drift > 60)
  const resFuture61 = await nonceCache.checkAndRecord(generateNonce("bound-f61"), now + 61);
  assert.equal(resFuture61.valid, false, "61s future drift must be rejected");
  assert.equal(resFuture61.statusCode, 401);
});

// ============================================================================
// 5. High-Concurrency Race Condition Defense
// ============================================================================

test("nonce-cache: concurrent identical nonce race test (only 1 succeeds, other rejected)", async () => {
  const raceNonce = generateNonce("race-single");
  const now = getNowSeconds();
  const concurrencyCount = 25;

  // Dispatch 25 concurrent requests in parallel attempting to record the same nonce
  const promises = Array.from({ length: concurrencyCount }, () =>
    nonceCache.checkAndRecord(raceNonce, now)
  );

  const results = await Promise.all(promises);

  const successes = results.filter((r) => r.valid === true);
  const rejections = results.filter((r) => r.valid === false);

  assert.equal(
    successes.length,
    1,
    `Exactly 1 request must succeed in concurrent race (actual: ${successes.length})`
  );
  assert.equal(
    rejections.length,
    concurrencyCount - 1,
    `Exactly ${concurrencyCount - 1} requests must be rejected (actual: ${rejections.length})`
  );

  // Verify all rejected attempts received 401 Replay error
  for (const rejected of rejections) {
    assert.equal(rejected.statusCode, 401);
    assert.ok(rejected.reason?.includes("Replay attack detected"));
  }
});

test("nonce-cache: interleaved multi-nonce high-concurrency race test (50 concurrent requests)", async () => {
  const distinctNoncesCount = 10;
  const attemptsPerNonce = 5; // Total 50 requests
  const now = getNowSeconds();

  const nonces = Array.from({ length: distinctNoncesCount }, (_, i) => generateNonce(`multi-${i}`));

  // Create 50 concurrent requests (5 per nonce) interleaved
  const tasks: Array<Promise<{ nonce: string; result: any }>> = [];
  for (let attempt = 0; attempt < attemptsPerNonce; attempt++) {
    for (const nonce of nonces) {
      tasks.push(
        (async () => {
          const result = await nonceCache.checkAndRecord(nonce, now);
          return { nonce, result };
        })()
      );
    }
  }

  // Execute all 50 in parallel
  const executed = await Promise.all(tasks);

  // Validate per-nonce invariant: exactly 1 success and 4 rejections per nonce
  for (const nonce of nonces) {
    const resultsForNonce = executed.filter((e) => e.nonce === nonce).map((e) => e.result);
    const validCount = resultsForNonce.filter((r) => r.valid === true).length;
    const rejectedCount = resultsForNonce.filter((r) => r.valid === false).length;

    assert.equal(validCount, 1, `Nonce ${nonce} must have exactly 1 success`);
    assert.equal(rejectedCount, attemptsPerNonce - 1, `Nonce ${nonce} must have exactly ${attemptsPerNonce - 1} rejections`);
  }
});

// ============================================================================
// 6. Input Sanitization & Adversarial Security Boundaries
// ============================================================================

test("nonce-cache: invalid or empty nonces rejected cleanly", async () => {
  const now = getNowSeconds();

  // Empty string
  const resEmpty = await nonceCache.checkAndRecord("", now);
  assert.equal(resEmpty.valid, false);
  assert.equal(resEmpty.statusCode, 401);
  assert.ok(resEmpty.reason?.includes("Invalid nonce"));

  // Whitespace string
  const resSpaces = await nonceCache.checkAndRecord("   ", now);
  assert.equal(resSpaces.valid, false);
  assert.equal(resSpaces.statusCode, 401);

  // Null / Undefined cast
  const resNull = await nonceCache.checkAndRecord(null as any, now);
  assert.equal(resNull.valid, false);
  assert.equal(resNull.statusCode, 401);
});

test("nonce-cache: invalid timestamp formats (NaN, Infinity, non-numeric) rejected cleanly", async () => {
  const nonce = generateNonce("bad-ts");

  // NaN
  const resNaN = await nonceCache.checkAndRecord(nonce, NaN);
  assert.equal(resNaN.valid, false);
  assert.equal(resNaN.statusCode, 401);
  assert.ok(resNaN.reason?.includes("Invalid timestamp"));

  // Infinity
  const resInf = await nonceCache.checkAndRecord(nonce, Infinity);
  assert.equal(resInf.valid, false);
  assert.equal(resInf.statusCode, 401);

  // Undefined
  const resUndef = await nonceCache.checkAndRecord(nonce, undefined as any);
  assert.equal(resUndef.valid, false);
  assert.equal(resUndef.statusCode, 401);
});

test("nonce-cache: adversarial nonce strings (special chars, colons, unicode, large payloads)", async () => {
  const now = getNowSeconds();

  const complexNonces = [
    "agent:worker:01:nonce:abc-123",
    "nonce-with-spaces in middle",
    "nonce-with-symbols-!@#$%^&*()_+{}[]|:<>?",
    "nonce-unicode-🔥-🛡️-⚡-987",
    "long-nonce-" + "a".repeat(500)
  ];

  for (const complexNonce of complexNonces) {
    const res1 = await nonceCache.checkAndRecord(complexNonce, now);
    assert.equal(res1.valid, true, `Complex nonce "${complexNonce.slice(0, 30)}..." should be accepted`);

    const res2 = await nonceCache.checkAndRecord(complexNonce, now);
    assert.equal(res2.valid, false, `Replay of complex nonce must be rejected`);
  }
});

// ============================================================================
// 7. Configuration, Administrative Operations & Fail-Closed Resilience
// ============================================================================

test("nonce-cache: custom sliding window configuration (maxWindowSeconds)", async () => {
  const inMemoryClient = new InMemoryRedisClient();
  const customCache = new NonceCache(30, inMemoryClient); // 30-second window
  assert.equal(customCache.getWindowSeconds(), 30);

  const now = getNowSeconds();
  const nonce = generateNonce("custom-window");

  // Drift = 25s (< 30s) -> Valid
  const resValid = await customCache.checkAndRecord(nonce, now - 25);
  assert.equal(resValid.valid, true);

  // Inspect TTL is 30s
  const ttl = await customCache.getTTL(nonce);
  assert.ok(ttl >= 29 && ttl <= 30);

  // Drift = 35s (> 30s) -> Invalid
  const resInvalid = await customCache.checkAndRecord(generateNonce("custom-window-2"), now - 35);
  assert.equal(resInvalid.valid, false);
  assert.ok(resInvalid.reason?.includes("35s > 30s"));
});

test("nonce-cache: administrative delete and clear operations", async () => {
  const nonce = generateNonce("admin-del");
  const now = getNowSeconds();

  await nonceCache.checkAndRecord(nonce, now);
  assert.equal(await nonceCache.exists(nonce), true);

  // Administrative delete
  const deleted = await nonceCache.delete(nonce);
  assert.equal(deleted, true, "Delete must return true for existing nonce");
  assert.equal(await nonceCache.exists(nonce), false, "Nonce must no longer exist after delete");

  // Re-record deleted nonce immediately succeeds
  const resReRecord = await nonceCache.checkAndRecord(nonce, now);
  assert.equal(resReRecord.valid, true, "Deleted nonce can be recorded again");

  // Administrative clear
  await nonceCache.clear();
  assert.equal(await nonceCache.exists(nonce), false, "Cache clear must purge all nonces");
});

test("nonce-cache: fail-closed resilience on Redis backend error", async () => {
  // Faulty Redis mock that rejects all set operations
  const faultyRedis: RedisClientInterface = {
    set: async () => {
      throw new Error("ECONNREFUSED: Redis cluster unreachable");
    },
    get: async () => null,
    del: async () => 0,
    ttl: async () => -2
  };

  const faultCache = new NonceCache(60, faultyRedis);
  const now = getNowSeconds();

  const result = await faultCache.checkAndRecord(generateNonce("fault"), now);

  assert.equal(result.valid, false, "Must fail-closed on Redis error");
  assert.equal(result.statusCode, 500, "Status code must be 500 on backend failure");
  assert.ok(
    result.reason?.includes("Anti-replay cache error"),
    `Reason must indicate cache failure (actual: "${result.reason}")`
  );
});
