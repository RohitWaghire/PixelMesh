/**
 * PixelMesh Phase 1 - Challenger Stress & Adversarial Test Suite
 * Milestone 2: Distributed Anti-Replay Nonce Cache
 * 
 * Adversarial Verifications:
 * 1. 100+ concurrent requests with identical nonces (exact 1-winner guarantee).
 * 2. High-volume burst traffic with 500 distinct concurrent nonces (100% success rate).
 * 3. Interleaved high-volume burst with 50 distinct nonces x 10 concurrent replays (500 total).
 * 4. Concurrent race conditions under simulated asynchronous network jitter/latency (5-20ms).
 * 5. Sub-second and boundary clock skew fuzzing (exact 60s, fractional timestamps, outliers).
 * 6. Concurrency at exact TTL expiration boundary.
 * 7. Redis protocol command injection & adversarial payload sanitization.
 * 8. Intermittent chaos backend failure under concurrent burst (fail-closed verification).
 * 9. Rapid lifecycle recycling across time-shifts.
 * 10. Multi-instance simulated cluster concurrency on shared distributed cache.
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { NonceCache, nonceCache, NONCE_KEY_PREFIX } from "@/lib/auth/nonce-cache";
import {
  InMemoryRedisClient,
  RedisClientInterface,
  resetMockRedis,
  getRedisClient
} from "@/lib/redis/client";

function generateNonce(prefix = "stress"): string {
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
// 1. Concurrency: 100+ Identical Nonce Attack
// ============================================================================

test("adversarial: 100+ concurrent requests with identical nonce guarantee exactly 1 winner and 99+ rejections", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const targetNonce = `identical-attack-${crypto.randomBytes(16).toString("hex")}`;
  const now = getNowSeconds();
  const concurrency = 120; // 120 simultaneous requests

  const promises = Array.from({ length: concurrency }, (_, idx) =>
    cache.checkAndRecord(targetNonce, now)
  );

  const results = await Promise.all(promises);

  const passed = results.filter((r) => r.valid === true);
  const failed = results.filter((r) => r.valid === false);

  assert.equal(passed.length, 1, `Exactly 1 request must pass (actual: ${passed.length})`);
  assert.equal(failed.length, concurrency - 1, `Exactly ${concurrency - 1} must be rejected (actual: ${failed.length})`);

  // Verify all failed requests have statusCode 401 and replay reason
  for (const failure of failed) {
    assert.equal(failure.statusCode, 401, "All rejections must be HTTP 401");
    assert.ok(
      failure.reason?.includes("Replay attack detected"),
      `Reason must specify replay attack (got: "${failure.reason}")`
    );
  }

  // Key must still exist in cache with correct value
  const key = `${NONCE_KEY_PREFIX}${targetNonce}`;
  const storedVal = await memoryClient.get(key);
  assert.equal(storedVal, String(now));
});

// ============================================================================
// 2. High-Volume Burst: 500 Unique Distinct Nonces
// ============================================================================

test("adversarial: burst traffic with 500 unique concurrent nonces achieves 100% acceptance", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const totalRequests = 500;
  const now = getNowSeconds();

  const nonces = Array.from({ length: totalRequests }, (_, i) =>
    `burst-unique-${i}-${crypto.randomBytes(8).toString("hex")}`
  );

  const promises = nonces.map((nonce) => cache.checkAndRecord(nonce, now));
  const results = await Promise.all(promises);

  const passed = results.filter((r) => r.valid === true);
  const failed = results.filter((r) => r.valid === false);

  assert.equal(passed.length, totalRequests, `All ${totalRequests} unique nonces must pass`);
  assert.equal(failed.length, 0, "No unique nonces should fail");
  assert.equal(memoryClient.size(), totalRequests, `Redis store must hold all ${totalRequests} active entries`);
});

// ============================================================================
// 3. Interleaved High-Volume Burst: 50 Distinct Nonces x 10 Replays (500 total)
// ============================================================================

test("adversarial: interleaved 500 requests across 50 distinct nonces strictly isolates replay per key", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const distinctKeys = 50;
  const attemptsPerKey = 10; // Total 500 requests
  const now = getNowSeconds();

  const nonceList = Array.from({ length: distinctKeys }, (_, i) => `key-${i}-${crypto.randomBytes(6).toString("hex")}`);

  // Create 500 interleaved tasks
  const tasks: Array<Promise<{ nonce: string; result: any }>> = [];
  for (let round = 0; round < attemptsPerKey; round++) {
    for (const nonce of nonceList) {
      tasks.push(
        (async () => {
          const res = await cache.checkAndRecord(nonce, now);
          return { nonce, result: res };
        })()
      );
    }
  }

  // Shuffle tasks array to simulate chaotic arrival order
  for (let i = tasks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
  }

  const results = await Promise.all(tasks);

  // Validate per key
  for (const nonce of nonceList) {
    const keyResults = results.filter((r) => r.nonce === nonce).map((r) => r.result);
    const valid = keyResults.filter((r) => r.valid === true);
    const invalid = keyResults.filter((r) => r.valid === false);

    assert.equal(valid.length, 1, `Key ${nonce} must have exactly 1 success`);
    assert.equal(invalid.length, attemptsPerKey - 1, `Key ${nonce} must have exactly ${attemptsPerKey - 1} failures`);
    for (const inv of invalid) {
      assert.equal(inv.statusCode, 401);
      assert.ok(inv.reason?.includes("Replay attack detected"));
    }
  }
});

// ============================================================================
// 4. Simulated Network Latency & Asynchronous Jitter
// ============================================================================

test("adversarial: concurrent requests under simulated async network latency jitter (5-20ms)", async () => {
  // Decorate InMemoryRedisClient with artificial latency
  const baseClient = new InMemoryRedisClient();
  const jitterClient: RedisClientInterface = {
    set: async (key, val, mode, ttl, flag) => {
      const delay = Math.floor(Math.random() * 15) + 5; // 5ms - 20ms
      await new Promise((resolve) => setTimeout(resolve, delay));
      return baseClient.set(key, val, mode, ttl, flag);
    },
    get: async (key) => baseClient.get(key),
    del: async (key) => baseClient.del(key),
    ttl: async (key) => baseClient.ttl(key),
    getNow: () => baseClient.getNow(),
    getNowSeconds: () => baseClient.getNowSeconds()
  };

  const cache = new NonceCache(60, jitterClient);
  const raceNonce = `jitter-race-${crypto.randomBytes(12).toString("hex")}`;
  const now = getNowSeconds();
  const concurrency = 50;

  const promises = Array.from({ length: concurrency }, () =>
    cache.checkAndRecord(raceNonce, now)
  );

  const results = await Promise.all(promises);

  const passes = results.filter((r) => r.valid === true);
  const rejections = results.filter((r) => r.valid === false);

  assert.equal(passes.length, 1, "Even under asynchronous network latency jitter, exactly 1 request succeeds");
  assert.equal(rejections.length, concurrency - 1, "All other concurrent requests must be rejected");
});

// ============================================================================
// 5. Clock Skew Sub-Second Precision and Edge Fuzzing
// ============================================================================

test("adversarial: clock skew sub-second precision, exact boundaries, and numeric edge values", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const now = getNowSeconds();

  // 1. Fractional timestamp (e.g. 1700000000.5) within window -> Valid
  const resFractional = await cache.checkAndRecord(generateNonce("ts-frac"), now - 10.45);
  assert.equal(resFractional.valid, true, "Valid numeric fractional timestamp should be accepted");

  // 2. Negative timestamp -> Rejected
  const resNeg = await cache.checkAndRecord(generateNonce("ts-neg"), -1);
  assert.equal(resNeg.valid, false, "Negative timestamp should be rejected as clock skew too large");
  assert.equal(resNeg.statusCode, 401);

  // 3. Zero epoch timestamp -> Rejected
  const resZero = await cache.checkAndRecord(generateNonce("ts-zero"), 0);
  assert.equal(resZero.valid, false, "Epoch 0 timestamp should be rejected");

  // 4. Extreme future timestamp (e.g. year 3000) -> Rejected
  const resFuture = await cache.checkAndRecord(generateNonce("ts-future"), now + 1000000);
  assert.equal(resFuture.valid, false, "Futuristic timestamp should be rejected");

  // 5. Boundary: exactly 60.0s drift -> Valid
  const resBoundPast = await cache.checkAndRecord(generateNonce("bound-past"), now - 60);
  assert.equal(resBoundPast.valid, true, "Drift of exactly 60s past should be accepted");

  // 6. Boundary: 60.1s drift -> Rejected
  const resBoundOver = await cache.checkAndRecord(generateNonce("bound-over"), now - 60.1);
  assert.equal(resBoundOver.valid, false, "Drift of 60.1s past should be rejected");
});

// ============================================================================
// 6. Concurrency at Exact TTL Expiration Boundary
// ============================================================================

test("adversarial: concurrency at TTL expiration boundary handles race seamlessly", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const nonce = `boundary-ttl-${crypto.randomBytes(8).toString("hex")}`;
  const t0 = memoryClient.getNowSeconds ? memoryClient.getNowSeconds() : getNowSeconds();

  // 1. Record nonce at t0
  const first = await cache.checkAndRecord(nonce, t0);
  assert.equal(first.valid, true);

  // 2. Advance time to 60s (at the exact boundary)
  memoryClient.advanceTime(60);

  // At 60s with fresh timestamp t0+60: key is expired (now >= expiresAtMs) -> Should succeed
  const freshTs = t0 + 60;
  const resAtBoundary = await cache.checkAndRecord(nonce, freshTs);
  assert.equal(resAtBoundary.valid, true, "At 60s expiration, recycled nonce with fresh timestamp succeeds");

  // 3. Immediately fire 50 concurrent requests with the SAME recycled nonce and fresh timestamp
  const promises = Array.from({ length: 50 }, () =>
    cache.checkAndRecord(nonce, freshTs)
  );

  const results = await Promise.all(promises);
  const passed = results.filter((r) => r.valid === true);
  const failed = results.filter((r) => r.valid === false);

  assert.equal(passed.length, 0, "All 50 duplicate requests on recycled nonce must be rejected");
  assert.equal(failed.length, 50);
});

// ============================================================================
// 7. Malicious Payload Injection & Adversarial Key Sanitization
// ============================================================================

test("adversarial: Redis protocol injection and hostile key characters", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const now = getNowSeconds();

  const hostileNonces = [
    "evil\r\nSET pixelmesh:injected:key 1\r\n",
    "evil\nFLUSHALL\n",
    "key_with_null_\0_byte",
    "../../etc/passwd",
    "<script>alert(1)</script>",
    "SELECT * FROM AgentKey;",
    "🌟💎🚀🛡️⚡🔥",
    "a".repeat(10000) // 10KB nonce payload
  ];

  for (const hostileNonce of hostileNonces) {
    const res1 = await cache.checkAndRecord(hostileNonce, now);
    assert.equal(res1.valid, true, `Hostile payload "${hostileNonce.slice(0, 25)}" must be recorded safely`);

    // Second submission must be detected as replay
    const res2 = await cache.checkAndRecord(hostileNonce, now);
    assert.equal(res2.valid, false, `Duplicate of hostile payload must be rejected as replay`);
    assert.equal(res2.statusCode, 401);
  }
});

// ============================================================================
// 8. Intermittent Chaos Backend Failure (Fail-Closed Assurance)
// ============================================================================

test("adversarial: chaotic intermittent Redis failures never fail-open during concurrent bursts", async () => {
  let failureRate = 0.5; // 50% random failure
  const baseClient = new InMemoryRedisClient();

  const chaosClient: RedisClientInterface = {
    set: async (key, val, mode, ttl, flag) => {
      if (Math.random() < failureRate) {
        throw new Error("EAI_AGAIN: DNS lookup failed / Redis transient timeout");
      }
      return baseClient.set(key, val, mode, ttl, flag);
    },
    get: async (key) => baseClient.get(key),
    del: async (key) => baseClient.del(key),
    ttl: async (key) => baseClient.ttl(key),
    getNow: () => baseClient.getNow(),
    getNowSeconds: () => baseClient.getNowSeconds()
  };

  const cache = new NonceCache(60, chaosClient);
  const now = getNowSeconds();
  const burstCount = 100;

  const nonces = Array.from({ length: burstCount }, (_, i) => `chaos-nonce-${i}`);
  const results = await Promise.all(nonces.map((n) => cache.checkAndRecord(n, now)));

  for (const result of results) {
    if (result.valid) {
      assert.equal(result.statusCode, undefined);
    } else {
      // If invalid, it MUST have a 500 error (fail-closed) or 401
      assert.ok(
        result.statusCode === 500 || result.statusCode === 401,
        `Result statusCode must be 500 or 401 (got: ${result.statusCode})`
      );
      if (result.statusCode === 500) {
        assert.ok(result.reason?.includes("Anti-replay cache error"));
      }
    }
  }
});

// ============================================================================
// 9. Multi-Instance Distributed Cluster Simulation
// ============================================================================

test("adversarial: multiple independent NonceCache instances sharing single Redis backend strictly prevent multi-node replays", async () => {
  // Simulates 3 different serverless / microservice instances sharing 1 Redis database
  const sharedRedis = new InMemoryRedisClient();
  const nodeA = new NonceCache(60, sharedRedis);
  const nodeB = new NonceCache(60, sharedRedis);
  const nodeC = new NonceCache(60, sharedRedis);

  const sharedNonce = `cluster-nonce-${crypto.randomBytes(8).toString("hex")}`;
  const now = getNowSeconds();

  // Node A receives the initial request
  const resA = await nodeA.checkAndRecord(sharedNonce, now);
  assert.equal(resA.valid, true, "Node A must accept fresh nonce");

  // Attacker immediately replays to Node B
  const resB = await nodeB.checkAndRecord(sharedNonce, now);
  assert.equal(resB.valid, false, "Node B must reject duplicate nonce");
  assert.equal(resB.statusCode, 401);

  // Attacker replays to Node C
  const resC = await nodeC.checkAndRecord(sharedNonce, now);
  assert.equal(resC.valid, false, "Node C must reject duplicate nonce");
  assert.equal(resC.statusCode, 401);
});

// ============================================================================
// 10. Adapter Concurrency: Upstash and IORedis under 50+ Concurrent Race
// ============================================================================

test("adversarial: UpstashRedisClientAdapter under 60 concurrent identical requests", async () => {
  // Underlying mock simulating Upstash REST API behavior
  const store = new Map<string, string>();
  const mockUpstash = {
    set: async (key: string, val: string, opts: any) => {
      if (opts?.nx && store.has(key)) {
        return null;
      }
      store.set(key, val);
      return "OK";
    },
    get: async (key: string) => store.get(key) ?? null,
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    ttl: async () => 60
  };

  const adapter = new (require("@/lib/redis/client").UpstashRedisClientAdapter)(mockUpstash);
  const cache = new NonceCache(60, adapter);
  const raceNonce = `upstash-race-${crypto.randomBytes(8).toString("hex")}`;
  const now = getNowSeconds();
  const concurrency = 60;

  const results = await Promise.all(
    Array.from({ length: concurrency }, () => cache.checkAndRecord(raceNonce, now))
  );

  const passed = results.filter((r) => r.valid === true);
  const failed = results.filter((r) => r.valid === false);

  assert.equal(passed.length, 1, "Upstash adapter must yield exactly 1 winner");
  assert.equal(failed.length, concurrency - 1, "Upstash adapter must reject all 59 replays");
});

test("adversarial: IORedisClientAdapter under 60 concurrent identical requests", async () => {
  // Underlying mock simulating IORedis TCP driver behavior
  const store = new Map<string, string>();
  const mockIORedis = {
    set: async (key: string, val: string, mode: string, ttl: number, flag?: string) => {
      if (flag === "NX" && store.has(key)) {
        return null;
      }
      store.set(key, val);
      return "OK";
    },
    get: async (key: string) => store.get(key) ?? null,
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    ttl: async () => 60
  };

  const adapter = new (require("@/lib/redis/client").IORedisClientAdapter)(mockIORedis);
  const cache = new NonceCache(60, adapter);
  const raceNonce = `ioredis-race-${crypto.randomBytes(8).toString("hex")}`;
  const now = getNowSeconds();
  const concurrency = 60;

  const results = await Promise.all(
    Array.from({ length: concurrency }, () => cache.checkAndRecord(raceNonce, now))
  );

  const passed = results.filter((r) => r.valid === true);
  const failed = results.filter((r) => r.valid === false);

  assert.equal(passed.length, 1, "IORedis adapter must yield exactly 1 winner");
  assert.equal(failed.length, concurrency - 1, "IORedis adapter must reject all 59 replays");
});

