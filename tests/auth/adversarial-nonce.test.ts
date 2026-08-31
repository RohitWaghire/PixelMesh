/**
 * PixelMesh Phase 1 - Challenger 2 Adversarial Stress Harness: Distributed Anti-Replay Nonce Cache
 * 
 * Comprehensive empirical tests covering:
 * 1. Clock Skew Drift exact boundaries (59s, 60s, 61s, fractional, future/past, epoch bounds).
 * 2. Adversarial Nonces (empty, whitespace, non-string, control chars, null bytes, unicode, 2048/10000 chars, Redis protocol injections).
 * 3. Redis Connection Failure Injection (fail-closed HTTP 500 behavior across diverse error types).
 * 4. High-concurrency race condition stress (100 workers, interleaved nonces).
 * 5. Full End-to-End MCP Route (/api/mcp) boundary and fail-closed validation.
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { NonceCache, nonceCache, NONCE_KEY_PREFIX } from "@/lib/auth/nonce-cache";
import {
  getRedisClient,
  resetMockRedis,
  InMemoryRedisClient,
  RedisClientInterface,
  UpstashRedisClientAdapter,
  IORedisClientAdapter
} from "@/lib/redis/client";
import { generateAgentKeypair, signRequestPayload } from "@/lib/auth/agent-crypto";
import { keyStore } from "@/lib/auth/key-store";
import { NextRequest } from "next/server";
import { POST as mcpPostHandler } from "@/app/api/mcp/route";

function getNowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

beforeEach(async () => {
  resetMockRedis();
  await nonceCache.clear();
});

// ============================================================================
// 1. Clock Skew Exact Boundaries & Temporal Drift Stress Tests
// ============================================================================

test("adversarial: clock skew exact boundary tests (59s, 60s, 61s past and future)", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const now = cache["getNowSeconds"]();

  // Test 0: exact now -> VALID
  const res0 = await cache.checkAndRecord("drift-0", now);
  assert.equal(res0.valid, true, "0s drift must be valid");
  assert.equal(res0.statusCode, undefined);

  // Test 1: 59s in past -> VALID
  const resPast59 = await cache.checkAndRecord("drift-past-59", now - 59);
  assert.equal(resPast59.valid, true, "59s past drift must be valid");

  // Test 2: 60s in past -> VALID (drift <= 60)
  const resPast60 = await cache.checkAndRecord("drift-past-60", now - 60);
  assert.equal(resPast60.valid, true, "Exact 60s past drift must be valid");

  // Test 3: 61s in past -> REJECTED (drift > 60)
  const resPast61 = await cache.checkAndRecord("drift-past-61", now - 61);
  assert.equal(resPast61.valid, false, "61s past drift must be rejected");
  assert.equal(resPast61.statusCode, 401);
  assert.ok(resPast61.reason?.includes("61s > 60s"));
  assert.equal(await memoryClient.get(`pixelmesh:nonce:drift-past-61`), null, "No Redis key should be created on skew rejection");

  // Test 4: 59s in future -> VALID
  const resFut59 = await cache.checkAndRecord("drift-fut-59", now + 59);
  assert.equal(resFut59.valid, true, "59s future drift must be valid");

  // Test 5: 60s in future -> VALID (drift <= 60)
  const resFut60 = await cache.checkAndRecord("drift-fut-60", now + 60);
  assert.equal(resFut60.valid, true, "Exact 60s future drift must be valid");

  // Test 6: 61s in future -> REJECTED (drift > 60)
  const resFut61 = await cache.checkAndRecord("drift-fut-61", now + 61);
  assert.equal(resFut61.valid, false, "61s future drift must be rejected");
  assert.equal(resFut61.statusCode, 401);
  assert.ok(resFut61.reason?.includes("61s > 60s"));
  assert.equal(await memoryClient.get(`pixelmesh:nonce:drift-fut-61`), null);
});

test("adversarial: clock skew with simulated time shift stepping (0s -> 59s -> 60s -> 61s)", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const t0 = memoryClient.getNowSeconds();

  const nonce = "step-nonce-1";
  const resInit = await cache.checkAndRecord(nonce, t0);
  assert.equal(resInit.valid, true);

  // Advance time by 30 seconds -> Key should exist, replay must be rejected
  memoryClient.advanceTime(30);
  const resMid = await cache.checkAndRecord(nonce, t0 + 30);
  assert.equal(resMid.valid, false, "Replay at +30s must be rejected");
  assert.equal(resMid.statusCode, 401);
  assert.ok(resMid.reason?.includes("Replay attack detected"));

  // Advance time by another 29 seconds (total 59s) -> Key still active (TTL ~1s)
  memoryClient.advanceTime(29);
  assert.equal(await cache.exists(nonce), true);
  const ttl59 = await cache.getTTL(nonce);
  assert.ok(ttl59 >= 1, `TTL at 59s should be >= 1s (actual: ${ttl59})`);

  // Advance time by another 2 seconds (total 61s) -> Key must be expired
  memoryClient.advanceTime(2);
  assert.equal(await cache.exists(nonce), false, "Key must be expired after 61s");
  assert.equal(await cache.getTTL(nonce), -2);

  // Now an attacker submitting original request with timestamp t0 gets rejected by skew
  const resStale = await cache.checkAndRecord(nonce, t0);
  assert.equal(resStale.valid, false);
  assert.equal(resStale.statusCode, 401);
  assert.ok(resStale.reason?.includes("Timestamp clock skew too large"));

  // But a legitimate client reusing the nonce with FRESH timestamp (t0 + 61) succeeds
  const resFresh = await cache.checkAndRecord(nonce, t0 + 61);
  assert.equal(resFresh.valid, true, "Recycled nonce with fresh timestamp succeeds once TTL expired");
});

test("adversarial: clock skew edge cases (fractional, negative, extreme timestamps)", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const now = memoryClient.getNowSeconds();

  // Negative timestamp
  const resNeg = await cache.checkAndRecord("neg-ts", -100);
  assert.equal(resNeg.valid, false);
  assert.equal(resNeg.statusCode, 401);
  assert.ok(resNeg.reason?.includes("Timestamp clock skew too large"));

  // Unix epoch zero (0)
  const resZero = await cache.checkAndRecord("zero-ts", 0);
  assert.equal(resZero.valid, false);
  assert.equal(resZero.statusCode, 401);

  // Year 2038 / extreme future
  const resFarFuture = await cache.checkAndRecord("far-future", 2147483647);
  assert.equal(resFarFuture.valid, false);
  assert.equal(resFarFuture.statusCode, 401);

  // Fractional timestamp within window (e.g. now + 0.4)
  const resFracIn = await cache.checkAndRecord("frac-in", now + 0.4);
  assert.equal(resFracIn.valid, true);

  // Fractional timestamp right on the edge (now + 60.4 -> Math.abs(now - (now+60.4)) = 60.4 > 60)
  const resFracOut = await cache.checkAndRecord("frac-out", now + 60.4);
  assert.equal(resFracOut.valid, false);
  assert.equal(resFracOut.statusCode, 401);
});

// ============================================================================
// 2. Adversarial Nonce Strings & Malicious Payload Injection
// ============================================================================

test("adversarial: empty, whitespace, and non-string nonces are strictly rejected with 401", async () => {
  const now = getNowSeconds();
  const badNonces: any[] = [
    "",
    " ",
    "   ",
    "\t",
    "\n",
    "\r\n",
    " \t \r \n ",
    null,
    undefined,
    12345,
    0,
    true,
    false,
    {},
    [],
    { nonce: "nested" },
    Symbol("nonce"),
    () => "nonce"
  ];

  for (const bad of badNonces) {
    const res = await nonceCache.checkAndRecord(bad, now);
    assert.equal(
      res.valid,
      false,
      `Non-string / whitespace nonce "${String(bad)}" must be rejected`
    );
    assert.equal(res.statusCode, 401, "Status code must be 401");
    assert.ok(res.reason?.includes("Invalid nonce"));
  }
});

test("adversarial: control characters, null bytes, unicode, emojis, and RTL strings", async () => {
  const now = getNowSeconds();
  const weirdNonces = [
    "nonce\x00nullbyte",
    "nonce\x01\x02\x03ctrl",
    "nonce\x1b[31mcolor\x1b[0m",
    "nonce-\u200B\u200C\u200D-zerowidth",
    "nonce-\uFEFF-bom",
    "nonce-🔥-🛡️-⚡-🚀",
    "nonce-العربية-مرحبا",
    "nonce-中文-测试-安全",
    "nonce-日本語-テスト",
    "nonce-русский-тест",
    "nonce-symbols-~!@#$%^&*()_+`-={}|[]\\:\";'<>?,./"
  ];

  for (const n of weirdNonces) {
    // 1. Initial submission should succeed
    const res1 = await nonceCache.checkAndRecord(n, now);
    assert.equal(res1.valid, true, `Weird nonce [${encodeURIComponent(n)}] must be accepted on first use`);

    // 2. Immediate duplicate must be rejected
    const res2 = await nonceCache.checkAndRecord(n, now);
    assert.equal(res2.valid, false, `Weird nonce [${encodeURIComponent(n)}] duplicate must be rejected`);
    assert.equal(res2.statusCode, 401);
    assert.ok(res2.reason?.includes("Replay attack detected"));
  }
});

test("adversarial: massive nonce strings (2048 chars, 10000 chars)", async () => {
  const now = getNowSeconds();

  const nonce2k = "nonce-2k-" + "a".repeat(2048);
  const res2k_1 = await nonceCache.checkAndRecord(nonce2k, now);
  assert.equal(res2k_1.valid, true, "2048-char nonce should be accepted");

  const res2k_2 = await nonceCache.checkAndRecord(nonce2k, now);
  assert.equal(res2k_2.valid, false, "2048-char nonce replay must be rejected");
  assert.equal(res2k_2.statusCode, 401);

  const nonce10k = "nonce-10k-" + "x".repeat(10000);
  const res10k_1 = await nonceCache.checkAndRecord(nonce10k, now);
  assert.equal(res10k_1.valid, true, "10,000-char nonce should be accepted");

  const res10k_2 = await nonceCache.checkAndRecord(nonce10k, now);
  assert.equal(res10k_2.valid, false, "10,000-char nonce replay must be rejected");
});

test("adversarial: Redis protocol injection strings and nested prefix attacks", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const now = memoryClient.getNowSeconds();

  const injectionAttempts = [
    "foo\r\nSET pixelmesh:hacked true\r\n",
    "foo\nFLUSHALL\n",
    ":::::",
    "pixelmesh:nonce:already_prefixed",
    "*",
    "?",
    "id:1; DROP TABLE AgentKey; --"
  ];

  for (const payload of injectionAttempts) {
    const res = await cache.checkAndRecord(payload, now);
    assert.equal(res.valid, true, `Payload [${payload}] should be treated as literal key`);

    // Verify formatted key
    const expectedKey = `${NONCE_KEY_PREFIX}${payload}`;
    assert.equal(await memoryClient.get(expectedKey), String(now));

    // Replay is properly rejected
    const replay = await cache.checkAndRecord(payload, now);
    assert.equal(replay.valid, false);
    assert.equal(replay.statusCode, 401);
  }
});

// ============================================================================
// 3. Redis Connection Failure Injection (Fail-Closed 500 Behavior)
// ============================================================================

test("adversarial: Redis connection failure injection returns fail-closed 500 across all error variants", async () => {
  const errorScenarios = [
    new Error("ECONNREFUSED 127.0.0.1:6379"),
    new Error("ETIMEDOUT: Connection timed out"),
    new Error("NOAUTH Authentication required"),
    new Error("OOM command not allowed when used memory > 'maxmemory'"),
    new Error("READONLY You can't write against a read only replica"),
    new Error("CLUSTERDOWN The cluster is down"),
    new TypeError("Cannot read properties of undefined (reading 'call')"),
    "String error rejection (non-Error object)"
  ];

  const now = getNowSeconds();

  for (const err of errorScenarios) {
    const faultyRedis: RedisClientInterface = {
      set: async () => {
        throw err;
      },
      get: async () => {
        throw err;
      },
      del: async () => {
        throw err;
      },
      ttl: async () => {
        throw err;
      }
    };

    const faultCache = new NonceCache(60, faultyRedis);
    const nonce = `fault-${crypto.randomUUID()}`;

    // checkAndRecord must fail-closed with 500
    const checkRes = await faultCache.checkAndRecord(nonce, now);
    assert.equal(checkRes.valid, false, "Must reject request when Redis fails");
    assert.equal(checkRes.statusCode, 500, "Must return HTTP 500 on Redis failure");
    assert.ok(
      checkRes.reason?.includes("Anti-replay cache error"),
      `Reason must contain 'Anti-replay cache error' (actual: "${checkRes.reason}")`
    );

    // Helper methods must not throw uncaught errors
    const existsRes = await faultCache.exists(nonce);
    assert.equal(existsRes, false, "exists() must return false on Redis error without throwing");

    const ttlRes = await faultCache.getTTL(nonce);
    assert.equal(ttlRes, -2, "getTTL() must return -2 on Redis error without throwing");

    const delRes = await faultCache.delete(nonce);
    assert.equal(delRes, false, "delete() must return false on Redis error without throwing");

    // clear() should not throw
    await assert.doesNotReject(async () => {
      await faultCache.clear();
    });
  }
});

test("adversarial: Redis connection failure during concurrent race condition maintains 100% fail-closed", async () => {
  let callCount = 0;
  const intermittentRedis: RedisClientInterface = {
    set: async () => {
      callCount++;
      if (callCount % 2 === 0) {
        throw new Error("Intermittent network timeout");
      }
      return "OK";
    },
    get: async () => null,
    del: async () => 0,
    ttl: async () => -2
  };

  const cache = new NonceCache(60, intermittentRedis);
  const now = getNowSeconds();
  const concurrency = 20;

  const tasks = Array.from({ length: concurrency }, (_, i) =>
    cache.checkAndRecord(`intermittent-${i}`, now)
  );

  const results = await Promise.all(tasks);

  for (let i = 0; i < concurrency; i++) {
    const res = results[i];
    if (res.valid) {
      assert.equal(res.statusCode, undefined);
    } else {
      // Failed calls must be fail-closed with 500
      assert.equal(res.statusCode, 500);
      assert.ok(res.reason?.includes("Anti-replay cache error"));
    }
  }
});

// ============================================================================
// 4. High-Concurrency Race Condition Stress Harness (100 concurrent workers)
// ============================================================================

test("adversarial: 100 concurrent requests for the exact same nonce results in 1 success and 99 rejections", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const targetNonce = `race-100-${crypto.randomUUID()}`;
  const now = memoryClient.getNowSeconds();
  const concurrency = 100;

  const promises = Array.from({ length: concurrency }, () =>
    cache.checkAndRecord(targetNonce, now)
  );

  const results = await Promise.all(promises);

  const successes = results.filter((r) => r.valid === true);
  const rejections = results.filter((r) => r.valid === false);

  assert.equal(successes.length, 1, `Exactly 1 request must win the race (actual: ${successes.length})`);
  assert.equal(rejections.length, 99, `Exactly 99 requests must be rejected (actual: ${rejections.length})`);

  for (const rej of rejections) {
    assert.equal(rej.statusCode, 401);
    assert.ok(rej.reason?.includes("Replay attack detected"));
  }
});

// ============================================================================
// 5. End-to-End MCP HTTP Route (/api/mcp) Boundary and Adversarial Nonce Validation
// ============================================================================

test("adversarial: MCP route strictly rejects invalid nonces, clock skew, and replays via HTTP status codes", async () => {
  // Provision a test key in keyStore
  const { publicKeyPem, privateKeyPem } = generateAgentKeypair();
  const key = keyStore.registerKey({
    publicKeyPem,
    agentName: "Adversarial Agent",
    scopes: ["all-tools"]
  });

  const nowSec = Math.floor(Date.now() / 1000);

  // Helper to craft signed MCP request
  function createSignedRequest(nonce: string, timestamp: number | string, bodyObj: any): NextRequest {
    const rawBody = JSON.stringify(bodyObj);
    const sig = signRequestPayload({
      privateKeyPem,
      method: "POST",
      path: "/api/mcp",
      timestamp: String(timestamp),
      nonce,
      body: rawBody
    });

    return new NextRequest("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-key-fingerprint": key.fingerprint,
        "x-agent-timestamp": String(timestamp),
        "x-agent-nonce": nonce,
        "x-agent-signature": sig
      },
      body: rawBody
    });
  }

  const listToolsBody = { jsonrpc: "2.0", id: "1", method: "tools/list" };

  // 1. Whitespace Nonce -> 401 (Rejected either by header layer or nonceCache)
  const reqSpaceNonce = createSignedRequest("   ", nowSec, listToolsBody);
  const resSpace = await mcpPostHandler(reqSpaceNonce);
  assert.equal(resSpace.status, 401, "Whitespace nonce header must return 401");
  const jsonSpace = await resSpace.json();
  assert.ok(
    jsonSpace.error.message.includes("Invalid nonce") ||
    jsonSpace.error.message.includes("Missing required SSH cryptographic headers") ||
    jsonSpace.error.message.includes("Unauthorized"),
    "Whitespace nonce must be rejected with unauthorized message"
  );

  // 2. 61s Past Clock Skew -> 401
  const reqPastSkew = createSignedRequest(`skew-past-${crypto.randomUUID()}`, nowSec - 61, listToolsBody);
  const resPastSkew = await mcpPostHandler(reqPastSkew);
  assert.equal(resPastSkew.status, 401);
  const jsonPastSkew = await resPastSkew.json();
  assert.ok(jsonPastSkew.error.message.includes("Timestamp clock skew too large"));

  // 3. 61s Future Clock Skew -> 401
  const reqFutSkew = createSignedRequest(`skew-fut-${crypto.randomUUID()}`, nowSec + 61, listToolsBody);
  const resFutSkew = await mcpPostHandler(reqFutSkew);
  assert.equal(resFutSkew.status, 401);
  const jsonFutSkew = await resFutSkew.json();
  assert.ok(jsonFutSkew.error.message.includes("Timestamp clock skew too large"));

  // 4. Past Drift within window -> 200 SUCCESS (use 50s past to avoid wall clock millisecond rollover beyond 60s)
  const valid60Nonce = `valid-60s-${crypto.randomUUID()}`;
  const freshNow = Math.floor(Date.now() / 1000);
  const req60s = createSignedRequest(valid60Nonce, freshNow - 50, listToolsBody);
  const res60s = await mcpPostHandler(req60s);
  assert.equal(res60s.status, 200, "Valid past drift within window should succeed");

  // 5. Immediate Duplicate Replay of the valid nonce -> 401
  const reqReplay = createSignedRequest(valid60Nonce, freshNow - 50, listToolsBody);
  const resReplay = await mcpPostHandler(reqReplay);
  assert.equal(resReplay.status, 401);
  const jsonReplay = await resReplay.json();
  assert.ok(jsonReplay.error.message.includes("Replay attack detected"));

  // 6. 2048-Char Nonce -> 200 SUCCESS
  const nonce2k = "long-nonce-" + "b".repeat(2048);
  const req2k = createSignedRequest(nonce2k, nowSec, listToolsBody);
  const res2k = await mcpPostHandler(req2k);
  assert.equal(res2k.status, 200, "2048-character nonce should succeed");

  // 7. Duplicate 2048-Char Nonce -> 401
  const req2kReplay = createSignedRequest(nonce2k, nowSec, listToolsBody);
  const res2kReplay = await mcpPostHandler(req2kReplay);
  assert.equal(res2kReplay.status, 401);
});

test("adversarial: MCP route returns HTTP 500 when Redis backend fails", async () => {
  const { publicKeyPem, privateKeyPem } = generateAgentKeypair();
  const key = keyStore.registerKey({
    publicKeyPem,
    agentName: "Redis Fault Agent",
    scopes: ["all-tools"]
  });

  const nowSec = Math.floor(Date.now() / 1000);
  const nonce = `fault-route-${crypto.randomUUID()}`;
  const listToolsBody = { jsonrpc: "2.0", id: "1", method: "tools/list" };

  const rawBody = JSON.stringify(listToolsBody);
  const sig = signRequestPayload({
    privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: String(nowSec),
    nonce,
    body: rawBody
  });

  const req = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": key.fingerprint,
      "x-agent-timestamp": String(nowSec),
      "x-agent-nonce": nonce,
      "x-agent-signature": sig
    },
    body: rawBody
  });

  // Inject broken redis client on the global singleton
  const faultyRedis: RedisClientInterface = {
    set: async () => {
      throw new Error("Redis cluster disconnected");
    },
    get: async () => null,
    del: async () => 0,
    ttl: async () => -2
  };

  const originalClient = globalThis.__pixelmesh_redis__;
  (nonceCache as any).customRedisClient = faultyRedis;

  try {
    const res = await mcpPostHandler(req);
    assert.equal(res.status, 500, "MCP route must return HTTP 500 on Redis failure");
    const json = await res.json();
    assert.ok(json.error.message.includes("Anti-replay cache error"));
    assert.ok(json.error.message.includes("Redis cluster disconnected"));
  } finally {
    (nonceCache as any).customRedisClient = undefined;
    globalThis.__pixelmesh_redis__ = originalClient;
  }
});

// ============================================================================
// 6. Nonce Recycling & Timestamp Mutation Replay Matrix
// ============================================================================

test("adversarial: timestamp mutation replay attack within window is strictly rejected", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const now = memoryClient.getNowSeconds();
  const nonce = `mutate-ts-${crypto.randomUUID()}`;

  // 1. Initial request with timestamp = now
  const res1 = await cache.checkAndRecord(nonce, now);
  assert.equal(res1.valid, true);

  // 2. Attacker modifies timestamp to now + 5 (within valid skew window) with same nonce
  const resMutatedPlus = await cache.checkAndRecord(nonce, now + 5);
  assert.equal(resMutatedPlus.valid, false, "Altered timestamp within window must be rejected");
  assert.equal(resMutatedPlus.statusCode, 401);
  assert.ok(resMutatedPlus.reason?.includes("Replay attack detected"));

  // 3. Attacker modifies timestamp to now - 5 (within valid skew window) with same nonce
  const resMutatedMinus = await cache.checkAndRecord(nonce, now - 5);
  assert.equal(resMutatedMinus.valid, false, "Altered past timestamp within window must be rejected");
  assert.equal(resMutatedMinus.statusCode, 401);
  assert.ok(resMutatedMinus.reason?.includes("Replay attack detected"));
});

test("adversarial: Upstash and IORedis adapters under fail-closed error simulation", async () => {
  const now = getNowSeconds();

  // 1. Upstash Adapter throwing network error
  const mockFailingUpstash = {
    set: async () => {
      throw new Error("Upstash REST API 503 Service Unavailable");
    }
  };
  const upstashAdapter = new UpstashRedisClientAdapter(mockFailingUpstash);
  const upstashCache = new NonceCache(60, upstashAdapter);

  const resUpstash = await upstashCache.checkAndRecord("upstash-err-nonce", now);
  assert.equal(resUpstash.valid, false);
  assert.equal(resUpstash.statusCode, 500);
  assert.ok(resUpstash.reason?.includes("Upstash REST API 503 Service Unavailable"));

  // 2. IORedis Adapter throwing TCP socket error
  const mockFailingIORedis = {
    set: async () => {
      throw new Error("NR_CLOSED: Connection closed before command response");
    }
  };
  const ioredisAdapter = new IORedisClientAdapter(mockFailingIORedis);
  const ioredisCache = new NonceCache(60, ioredisAdapter);

  const resIORedis = await ioredisCache.checkAndRecord("ioredis-err-nonce", now);
  assert.equal(resIORedis.valid, false);
  assert.equal(resIORedis.statusCode, 500);
  assert.ok(resIORedis.reason?.includes("NR_CLOSED"));
});

test("adversarial: high-volume throughput stress (1,000 unique nonces recorded and pruned)", async () => {
  const memoryClient = new InMemoryRedisClient();
  const cache = new NonceCache(60, memoryClient);
  const t0 = memoryClient.getNowSeconds();
  const count = 1000;

  // Insert 1000 nonces in sequence
  for (let i = 0; i < count; i++) {
    const res = await cache.checkAndRecord(`bulk-${i}`, t0);
    assert.equal(res.valid, true);
  }

  assert.equal(memoryClient.size(), count, "Memory store size must equal 1000");

  // Advance time by 61 seconds
  memoryClient.advanceTime(61);

  // All 1000 keys must be expired
  assert.equal(memoryClient.size(), 0, "Pruned store size must be 0 after 61s");
  assert.equal(await cache.exists("bulk-0"), false);
  assert.equal(await cache.exists(`bulk-${count - 1}`), false);
});
