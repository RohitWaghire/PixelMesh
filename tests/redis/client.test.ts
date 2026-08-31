import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryRedisClient,
  UpstashRedisClientAdapter,
  IORedisClientAdapter,
  getRedisClient,
  resetMockRedis,
  determineRedisBackend,
  getRedisBackend
} from "@/lib/redis/client";

beforeEach(() => {
  resetMockRedis();
});

// ============================================================================
// 1. InMemoryRedisClient Unit & Semantic Verification
// ============================================================================

test("redis-client (in-memory): basic set, get, del, ttl operations", async () => {
  const client = new InMemoryRedisClient();

  // Set with TTL
  const setRes = await client.set("key1", "val1", "EX", 60);
  assert.equal(setRes, "OK");

  // Get
  const getRes = await client.get("key1");
  assert.equal(getRes, "val1");

  // TTL
  const ttlRes = await client.ttl("key1");
  assert.ok(ttlRes >= 59 && ttlRes <= 60, `TTL should be ~60 (actual: ${ttlRes})`);

  // Del
  const delRes = await client.del("key1");
  assert.equal(delRes, 1);

  // Get after del
  const getAfterDel = await client.get("key1");
  assert.equal(getAfterDel, null);

  // TTL after del
  const ttlAfterDel = await client.ttl("key1");
  assert.equal(ttlAfterDel, -2);
});

test("redis-client (in-memory): atomic SET EX NX semantics", async () => {
  const client = new InMemoryRedisClient();

  // 1. Initial SET with NX flag -> Succeeds
  const first = await client.set("lock:1", "owner-a", "EX", 60, "NX");
  assert.equal(first, "OK", "First SET ... NX must return OK");

  // 2. Duplicate SET with NX flag -> Fails and returns null
  const duplicate = await client.set("lock:1", "owner-b", "EX", 60, "NX");
  assert.equal(duplicate, null, "Duplicate SET ... NX must return null");

  // 3. Stored value remains unchanged
  assert.equal(await client.get("lock:1"), "owner-a");

  // 4. Overwrite without NX flag -> Succeeds
  const overwrite = await client.set("lock:1", "owner-c", "EX", 60);
  assert.equal(overwrite, "OK");
  assert.equal(await client.get("lock:1"), "owner-c");
});

test("redis-client (in-memory): time simulation & TTL expiration via advanceTime", async () => {
  const client = new InMemoryRedisClient();

  await client.set("temp:key", "temp_value", "EX", 60);
  assert.equal(await client.get("temp:key"), "temp_value");
  assert.equal(client.size(), 1);

  // Advance time by 30 seconds -> Still valid
  client.advanceTime(30);
  assert.equal(await client.get("temp:key"), "temp_value");
  const midTtl = await client.ttl("temp:key");
  assert.ok(midTtl >= 29 && midTtl <= 30, `TTL should be ~30 after 30s advance (actual: ${midTtl})`);

  // Advance time by another 31 seconds (total 61s) -> Expired
  client.advanceTime(31);
  assert.equal(await client.get("temp:key"), null, "Key must be expired after 61s");
  assert.equal(await client.ttl("temp:key"), -2, "Expired key TTL must be -2");
  assert.equal(client.size(), 0, "Expired key should be pruned from size count");

  // SET ... NX should now succeed on the expired key
  const reSet = await client.set("temp:key", "new_value", "EX", 60, "NX");
  assert.equal(reSet, "OK", "SET NX must succeed once key has expired");
  assert.equal(await client.get("temp:key"), "new_value");
});

test("redis-client (in-memory): flushall, reset, size, and keys helper methods", async () => {
  const client = new InMemoryRedisClient();

  await client.set("pixelmesh:nonce:1", "val1", "EX", 60);
  await client.set("pixelmesh:nonce:2", "val2", "EX", 60);
  await client.set("other:key:3", "val3", "EX", 60);

  assert.equal(client.size(), 3);
  assert.equal(client.keys().length, 3);
  assert.equal(client.keys("pixelmesh:nonce:*").length, 2);

  // flushall
  await client.flushall();
  assert.equal(client.size(), 0);
  assert.equal(await client.get("pixelmesh:nonce:1"), null);

  // reset
  await client.set("k1", "v1", "EX", 60);
  client.advanceTime(100);
  client.reset();
  assert.equal(client.size(), 0);
  // Time offset should also be reset to 0
  await client.set("k2", "v2", "EX", 60);
  const ttlAfterReset = await client.ttl("k2");
  assert.ok(ttlAfterReset >= 59 && ttlAfterReset <= 60);
});

test("redis-client (in-memory): high-concurrency race condition on SET NX", async () => {
  const client = new InMemoryRedisClient();
  const concurrency = 30;

  const results = await Promise.all(
    Array.from({ length: concurrency }, (_, i) =>
      client.set("race:resource", `worker-${i}`, "EX", 60, "NX")
    )
  );

  const okCount = results.filter((r) => r === "OK").length;
  const nullCount = results.filter((r) => r === null).length;

  assert.equal(okCount, 1, "Exactly 1 worker should acquire the lock");
  assert.equal(nullCount, concurrency - 1, "All other workers should receive null");
});

// ============================================================================
// 2. Upstash & IORedis Client Adapter Tests (Mocked Drivers)
// ============================================================================

test("redis-client (upstash adapter): correctly maps methods and options", async () => {
  const calls: any[] = [];
  const mockUpstashClient = {
    set: async (key: string, val: string, opts: any) => {
      calls.push({ method: "set", key, val, opts });
      return "OK";
    },
    get: async (key: string) => {
      calls.push({ method: "get", key });
      return "mock_value";
    },
    del: async (key: string) => {
      calls.push({ method: "del", key });
      return 1;
    },
    ttl: async (key: string) => {
      calls.push({ method: "ttl", key });
      return 55;
    },
    flushall: async () => {
      calls.push({ method: "flushall" });
    }
  };

  const adapter = new UpstashRedisClientAdapter(mockUpstashClient);

  const setRes = await adapter.set("test_key", "test_val", "EX", 60, "NX");
  assert.equal(setRes, "OK");
  assert.deepEqual(calls[0], {
    method: "set",
    key: "test_key",
    val: "test_val",
    opts: { ex: 60, nx: true }
  });

  const getRes = await adapter.get("test_key");
  assert.equal(getRes, "mock_value");

  const ttlRes = await adapter.ttl("test_key");
  assert.equal(ttlRes, 55);

  const delRes = await adapter.del("test_key");
  assert.equal(delRes, 1);

  await adapter.flushall();
  assert.equal(calls[4].method, "flushall");
});

test("redis-client (ioredis adapter): correctly maps methods and arguments", async () => {
  const calls: any[] = [];
  const mockIORedisClient = {
    set: async (key: string, val: string, mode: string, ttl: number, flag?: string) => {
      calls.push({ method: "set", key, val, mode, ttl, flag });
      return "OK";
    },
    get: async (key: string) => {
      calls.push({ method: "get", key });
      return "io_val";
    },
    del: async (key: string) => {
      calls.push({ method: "del", key });
      return 1;
    },
    ttl: async (key: string) => {
      calls.push({ method: "ttl", key });
      return 45;
    },
    quit: async () => {
      calls.push({ method: "quit" });
    }
  };

  const adapter = new IORedisClientAdapter(mockIORedisClient);

  const setRes = await adapter.set("io_key", "io_val", "EX", 60, "NX");
  assert.equal(setRes, "OK");
  assert.deepEqual(calls[0], {
    method: "set",
    key: "io_key",
    val: "io_val",
    mode: "EX",
    ttl: 60,
    flag: "NX"
  });

  const getRes = await adapter.get("io_key");
  assert.equal(getRes, "io_val");

  const ttlRes = await adapter.ttl("io_key");
  assert.equal(ttlRes, 45);

  const delRes = await adapter.del("io_key");
  assert.equal(delRes, 1);

  await adapter.disconnect();
  assert.equal(calls[4].method, "quit");
});

// ============================================================================
// 3. Backend Detection & Global Singleton
// ============================================================================

test("redis-client (detection): determines backend based on environment configuration", () => {
  const originalEnv = { ...process.env };

  try {
    // 1. Default in test mode -> memory
    process.env.NODE_ENV = "test";
    delete process.env.USE_IN_MEMORY_REDIS;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.REDIS_URL;
    assert.equal(determineRedisBackend(), "memory");

    // 2. Explicit MOCK_REDIS
    process.env.MOCK_REDIS = "true";
    assert.equal(determineRedisBackend(), "memory");
    delete process.env.MOCK_REDIS;

    // 3. Upstash configured
    process.env.NODE_ENV = "production";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret-token";
    delete process.env.REDIS_URL;
    assert.equal(determineRedisBackend(), "upstash");

    // 4. IORedis configured
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.REDIS_URL = "redis://localhost:6379";
    assert.equal(determineRedisBackend(), "ioredis");
  } finally {
    process.env = originalEnv;
  }
});

test("redis-client (singleton): getRedisClient returns stable singleton instance", () => {
  const client1 = getRedisClient();
  const client2 = getRedisClient();
  assert.equal(client1, client2, "getRedisClient must return the same singleton reference");
  assert.ok(client1 instanceof InMemoryRedisClient, "In test mode, client should be InMemoryRedisClient");
});
