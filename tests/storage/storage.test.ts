/**
 * PixelMesh Phase 3 - Direct Object Storage Transport & Streaming Pipeline Unit Tests
 */

import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "stream";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { NextRequest } from "next/server";

import { InMemoryStorageAdapter } from "@/lib/storage/memory-adapter";
import { LocalStorageAdapter } from "@/lib/storage/local-adapter";
import { S3StorageAdapter } from "@/lib/storage/s3-adapter";
import {
  getStorageClient,
  setStorageClient,
  resetMockStorage,
  resolveStorageDriver,
  createStorageAdapter,
  storageClient
} from "@/lib/storage/client";
import {
  resolveInputImage,
  resolveInputStream,
  formatStorageResult,
  processSingleFilter,
  processPipeline,
  parseBase64Image
} from "@/lib/image/engine";
import { keyStore } from "@/lib/auth/key-store";
import { generateAgentKeypair, signRequestPayload } from "@/lib/auth/agent-crypto";
import { nonceCache } from "@/lib/auth/nonce-cache";
import { resetMockDb } from "@/lib/db/prisma";
import { resetMockRedis } from "@/lib/redis/client";
import { POST as uploadUrlHandler } from "@/app/api/mcp/upload-url/route";

const TEST_LOCAL_DIR = path.resolve(process.cwd(), ".test-storage");

beforeEach(async () => {
  resetMockDb();
  resetMockRedis();
  await nonceCache.clear();
  await resetMockStorage();
  setStorageClient(null);
});

afterEach(async () => {
  try {
    if (fs.existsSync(TEST_LOCAL_DIR)) {
      await fs.promises.rm(TEST_LOCAL_DIR, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup error
  }
});

async function createSampleImageBuffer(
  width = 120,
  height = 120,
  color = { r: 50, g: 100, b: 150 }
): Promise<Buffer> {
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color
    }
  })
    .png()
    .toBuffer();
}

// ============================================================================
// 1. InMemoryStorageAdapter Tests
// ============================================================================

test("storage-memory: CRUD operations and metadata", async () => {
  const adapter = new InMemoryStorageAdapter({ cdnBaseUrl: "https://cdn.test.io" });
  const sampleBuf = await createSampleImageBuffer(100, 100);
  const key = "raw/2026/08/23/test-image.png";

  // 1. putObject
  const putRes = await adapter.putObject({
    key,
    body: sampleBuf,
    contentType: "image/png",
    metadata: { author: "agent-1" }
  });

  assert.equal(putRes.key, key);
  assert.equal(putRes.publicUrl, `https://cdn.test.io/${key}`);
  assert.equal(putRes.sizeBytes, sampleBuf.length);

  // 2. exists
  assert.equal(await adapter.exists(key), true);
  assert.equal(await adapter.exists("non-existent-key"), false);

  // 3. getObjectBuffer
  const retrievedBuf = await adapter.getObjectBuffer(key);
  assert.deepEqual(retrievedBuf, sampleBuf);

  // 4. getObjectStream
  const stream = await adapter.getObjectStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const streamBuf = Buffer.concat(chunks);
  assert.deepEqual(streamBuf, sampleBuf);

  // 5. getMetadata
  const meta = await adapter.getMetadata(key);
  assert.ok(meta);
  assert.equal(meta.contentType, "image/png");
  assert.equal(meta.contentLength, sampleBuf.length);
  assert.equal(meta.metadata?.author, "agent-1");

  // 6. deleteObject
  const deleted = await adapter.deleteObject(key);
  assert.equal(deleted, true);
  assert.equal(await adapter.exists(key), false);

  // 7. error on missing object
  await assert.rejects(
    async () => adapter.getObjectBuffer(key),
    /not found in storage bucket/
  );
});

test("storage-memory: putObject accepts various stream and buffer body types", async () => {
  const adapter = new InMemoryStorageAdapter();

  // Node Readable Stream
  const buf1 = Buffer.from("readable-stream-data");
  await adapter.putObject({
    key: "stream-test-1.txt",
    body: Readable.from(buf1),
    contentType: "text/plain"
  });
  assert.deepEqual(await adapter.getObjectBuffer("stream-test-1.txt"), buf1);

  // Uint8Array
  const u8 = new Uint8Array([1, 2, 3, 4, 5]);
  await adapter.putObject({
    key: "u8-test.bin",
    body: u8,
    contentType: "application/octet-stream"
  });
  assert.deepEqual(await adapter.getObjectBuffer("u8-test.bin"), Buffer.from(u8));

  // String
  await adapter.putObject({
    key: "string-test.txt",
    body: "hello world",
    contentType: "text/plain"
  });
  assert.equal((await adapter.getObjectBuffer("string-test.txt")).toString(), "hello world");
});

test("storage-memory: getUploadUrl generates valid presigned URL structure", async () => {
  const adapter = new InMemoryStorageAdapter({ cdnBaseUrl: "https://cdn.pixelmesh.io" });

  const result = await adapter.getUploadUrl({
    filename: "landscape.png",
    contentType: "image/png",
    expiresInSeconds: 300,
    maxSizeBytes: 10485760
  });

  assert.ok(result.uploadUrl.startsWith("https://storage.pixelmesh.local/upload/"));
  assert.ok(result.imageKey.startsWith("raw/"));
  assert.ok(result.imageKey.includes("landscape.png"));
  assert.equal(result.publicUrl, `https://cdn.pixelmesh.io/${result.imageKey}`);
  assert.equal(result.method, "PUT");
  assert.equal(result.headers["Content-Type"], "image/png");
  assert.equal(result.maxSizeBytes, 10485760);
  assert.ok(new Date(result.expiresAt).getTime() > Date.now());
});

test("storage-memory: reset() clears all stored entries", async () => {
  const adapter = new InMemoryStorageAdapter();
  await adapter.putObject({ key: "k1.png", body: Buffer.from("1"), contentType: "image/png" });
  await adapter.putObject({ key: "k2.png", body: Buffer.from("2"), contentType: "image/png" });

  assert.equal(adapter.size(), 2);
  await adapter.reset();
  assert.equal(adapter.size(), 0);
  assert.equal(await adapter.exists("k1.png"), false);
});

// ============================================================================
// 2. LocalStorageAdapter Tests
// ============================================================================

test("storage-local: CRUD operations, streaming, and directory persistence", async () => {
  const adapter = new LocalStorageAdapter({
    localStorageDir: ".test-storage",
    cdnBaseUrl: "http://localhost:3000/storage"
  });

  const sampleBuf = await createSampleImageBuffer(80, 80);
  const key = "raw/2026/08/23/nested-image.png";

  // 1. putObject with nested folder creation
  const putRes = await adapter.putObject({
    key,
    body: sampleBuf,
    contentType: "image/png",
    metadata: { job: "m2-test" }
  });

  assert.equal(putRes.key, key);
  assert.equal(putRes.sizeBytes, sampleBuf.length);
  assert.equal(putRes.publicUrl, `http://localhost:3000/storage/${key}`);

  // 2. exists & file on disk
  assert.equal(await adapter.exists(key), true);
  assert.equal(await adapter.exists("unseen-key.png"), false);

  // 3. getObjectBuffer
  const retrievedBuf = await adapter.getObjectBuffer(key);
  assert.deepEqual(retrievedBuf, sampleBuf);

  // 4. getObjectStream
  const stream = await adapter.getObjectStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  assert.deepEqual(Buffer.concat(chunks), sampleBuf);

  // 5. getMetadata
  const meta = await adapter.getMetadata(key);
  assert.ok(meta);
  assert.equal(meta.contentType, "image/png");
  assert.equal(meta.contentLength, sampleBuf.length);

  // 6. deleteObject
  const deleted = await adapter.deleteObject(key);
  assert.equal(deleted, true);
  assert.equal(await adapter.exists(key), false);
});

test("storage-local: path traversal security violations are strictly rejected", async () => {
  const adapter = new LocalStorageAdapter({ localStorageDir: ".test-storage" });

  const traversalKeys = [
    "../../etc/passwd",
    "../../../windows/win.ini",
    "..\\..\\boot.ini",
    "/root/.ssh/id_rsa",
    "raw/../../secret.key"
  ];

  for (const maliciousKey of traversalKeys) {
    await assert.rejects(
      async () => adapter.getObjectBuffer(maliciousKey),
      /Security Violation: Path traversal detected|Invalid object key/
    );

    await assert.rejects(
      async () => adapter.putObject({ key: maliciousKey, body: Buffer.from("evil"), contentType: "text/plain" }),
      /Security Violation: Path traversal detected|Invalid object key/
    );
  }
});

// ============================================================================
// 3. S3StorageAdapter Tests
// ============================================================================

test("storage-s3: configuration and presigned URL generation", async () => {
  const adapter = new S3StorageAdapter({
    s3Bucket: "pixelmesh-prod-bucket",
    s3Region: "us-west-2",
    s3AccessKeyId: "AKIA_TEST_KEY",
    s3SecretAccessKey: "SECRET_KEY_123",
    cdnBaseUrl: "https://cdn.pixelmesh.io"
  });

  const uploadResult = await adapter.getUploadUrl({
    filename: "portrait.jpg",
    contentType: "image/jpeg",
    expiresInSeconds: 600
  });

  assert.ok(uploadResult.uploadUrl.includes("pixelmesh-prod-bucket"));
  assert.ok(uploadResult.uploadUrl.includes("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
  assert.ok(uploadResult.uploadUrl.includes("X-Amz-Signature="));
  assert.ok(uploadResult.imageKey.startsWith("raw/"));
  assert.equal(uploadResult.publicUrl, `https://cdn.pixelmesh.io/${uploadResult.imageKey}`);
  assert.equal(uploadResult.headers["Content-Type"], "image/jpeg");
});

test("storage-s3: includes temporary AWS session credentials when signing URLs", async () => {
  const envKeys = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"] as const;
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  try {
    process.env.AWS_ACCESS_KEY_ID = "ASIA_TEST_KEY";
    process.env.AWS_SECRET_ACCESS_KEY = "SECRET_KEY_123";
    process.env.AWS_SESSION_TOKEN = "SESSION_TOKEN_123";

    const adapter = new S3StorageAdapter({
      s3Bucket: "temporary-credentials-bucket",
      s3Region: "us-east-1"
    });
    const uploadResult = await adapter.getUploadUrl("raw/test.png", "image/png", 600);

    assert.match(uploadResult.uploadUrl, /X-Amz-Security-Token=/);
  } finally {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
});

test("storage-s3: fallback and simulated store operations", async () => {
  const adapter = new S3StorageAdapter({
    s3Bucket: "mock-r2-bucket",
    s3Region: "auto",
    s3Endpoint: "https://account.r2.cloudflarestorage.com"
  });

  const sampleBuf = await createSampleImageBuffer(50, 50);
  const key = "raw/2026/08/23/r2-img.png";

  await adapter.putObject({ key, body: sampleBuf, contentType: "image/png" });
  assert.equal(await adapter.exists(key), true);

  const readBuf = await adapter.getObjectBuffer(key);
  assert.deepEqual(readBuf, sampleBuf);

  const stream = await adapter.getObjectStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  assert.deepEqual(Buffer.concat(chunks), sampleBuf);

  assert.equal(await adapter.deleteObject(key), true);
  assert.equal(await adapter.exists(key), false);
});

// ============================================================================
// 4. Storage Client Singleton & Driver Resolution Tests
// ============================================================================

test("storage-client: resolveStorageDriver resolves driver priority correctly", () => {
  const origEnv = { ...process.env };

  try {
    delete process.env.STORAGE_DRIVER;
    delete process.env.USE_IN_MEMORY_STORAGE;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;

    // Default test env -> memory
    (process.env as any).NODE_ENV = "test";
    assert.equal(resolveStorageDriver(), "memory");

    // Explicit driver
    assert.equal(resolveStorageDriver("local"), "local");
    assert.equal(resolveStorageDriver("s3"), "s3");

    // STORAGE_DRIVER env var
    process.env.STORAGE_DRIVER = "local";
    assert.equal(resolveStorageDriver(), "local");

    process.env.STORAGE_DRIVER = "r2";
    assert.equal(resolveStorageDriver(), "r2");

    // S3 bucket auto-detection
    delete process.env.STORAGE_DRIVER;
    process.env.S3_BUCKET = "my-bucket";
    process.env.S3_ACCESS_KEY_ID = "key-id";
    assert.equal(resolveStorageDriver(), "s3");
  } finally {
    process.env = origEnv;
  }
});

test("storage-client: singleton stability and proxy delegation", async () => {
  const client1 = getStorageClient();
  const client2 = getStorageClient();
  assert.equal(client1, client2, "getStorageClient should return stable singleton");

  const sampleBuf = await createSampleImageBuffer(40, 40);
  await storageClient.putObject({ key: "proxy-test.png", body: sampleBuf, contentType: "image/png" });

  assert.equal(await storageClient.exists("proxy-test.png"), true);
  const retrieved = await storageClient.getObjectBuffer("proxy-test.png");
  assert.deepEqual(retrieved, sampleBuf);

  await resetMockStorage();
  assert.equal(await storageClient.exists("proxy-test.png"), false);
});

// ============================================================================
// 5. Image Engine Input/Output Resolution & Streaming Tests
// ============================================================================

test("image-engine: resolveInputImage resolves inline Base64 data URIs", async () => {
  const sampleBuf = await createSampleImageBuffer(60, 60);
  const base64Uri = `data:image/png;base64,${sampleBuf.toString("base64")}`;

  // Direct string input
  const res1 = await resolveInputImage(base64Uri);
  assert.equal(res1.sourceType, "base64");
  assert.deepEqual(res1.buffer, sampleBuf);

  // Object input { image_base64 }
  const res2 = await resolveInputImage({ image_base64: base64Uri });
  assert.equal(res2.sourceType, "base64");
  assert.deepEqual(res2.buffer, sampleBuf);

  // Object input { imageBase64 }
  const res3 = await resolveInputImage({ imageBase64: base64Uri });
  assert.equal(res3.sourceType, "base64");
  assert.deepEqual(res3.buffer, sampleBuf);
});

test("image-engine: resolveInputImage resolves from storage keys via storageClient", async () => {
  const sampleBuf = await createSampleImageBuffer(90, 90);
  const key = "raw/2026/08/23/stored-for-engine.png";
  await storageClient.putObject({ key, body: sampleBuf, contentType: "image/png" });

  // Key string
  const res1 = await resolveInputImage(key);
  assert.equal(res1.sourceType, "storage");
  assert.equal(res1.sourceKey, key);
  assert.deepEqual(res1.buffer, sampleBuf);

  // Object { image_key }
  const res2 = await resolveInputImage({ image_key: key });
  assert.equal(res2.sourceType, "storage");
  assert.equal(res2.sourceKey, key);
  assert.deepEqual(res2.buffer, sampleBuf);

  // Missing storage key throws
  await assert.rejects(
    async () => resolveInputImage({ image_key: "missing/not-found.png" }),
    /not found in storage bucket/
  );
});

test("image-engine: resolveInputStream provides readable Node stream directly to Sharp", async () => {
  const sampleBuf = await createSampleImageBuffer(110, 110);
  const key = "raw/2026/08/23/stream-to-sharp.png";
  await storageClient.putObject({ key, body: sampleBuf, contentType: "image/png" });

  const { stream, sourceType } = await resolveInputStream({ image_key: key });
  assert.equal(sourceType, "storage");

  // Pipe stream into sharp
  const sharpTransform = sharp();
  stream.pipe(sharpTransform);
  const metadata = await sharpTransform.metadata();

  assert.equal(metadata.width, 110);
  assert.equal(metadata.height, 110);
  assert.equal(metadata.format, "png");
});

test("image-engine: formatStorageResult stores processed image and returns keys and CDN URLs", async () => {
  const sampleBuf = await createSampleImageBuffer(150, 150);
  const stored = await formatStorageResult({
    buffer: sampleBuf,
    format: "webp",
    prefix: "processed"
  });

  assert.ok(stored.image_key.startsWith("processed/"));
  assert.ok(stored.image_key.endsWith(".webp"));
  assert.ok(stored.public_url.includes(stored.image_key));
  assert.equal(stored.size_bytes, sampleBuf.length);

  // Verify object is indeed in storage
  assert.equal(await storageClient.exists(stored.image_key), true);
});

test("image-engine: processSingleFilter and processPipeline accept image_key and return storage URLs", async () => {
  const sampleBuf = await createSampleImageBuffer(200, 150);
  const key = "raw/2026/08/23/filter-input.png";
  await storageClient.putObject({ key, body: sampleBuf, contentType: "image/png" });

  // Single filter with return_type: "storage"
  const filterRes = await processSingleFilter(
    { image_key: key, return_type: "storage" },
    "crop_image",
    { left: 10, top: 10, width: 100, height: 100 }
  );

  assert.equal(filterRes.metadata.width, 100);
  assert.equal(filterRes.metadata.height, 100);
  assert.ok(filterRes.image_key);
  assert.ok(filterRes.public_url);
  assert.equal(await storageClient.exists(filterRes.image_key!), true);

  // Pipeline with return_type: "storage"
  const pipeRes = await processPipeline(
    { image_key: key, return_type: "storage" },
    [
      { tool: "crop_image", params: { left: 0, top: 0, width: 80, height: 80 } },
      { tool: "grayscale_image", params: {} }
    ]
  );

  assert.equal(pipeRes.metadata.width, 80);
  assert.equal(pipeRes.metadata.height, 80);
  assert.ok(pipeRes.image_key);
  assert.ok(pipeRes.public_url);
  assert.equal(await storageClient.exists(pipeRes.image_key!), true);
});

// ============================================================================
// 6. Pre-Signed Upload URL Route Tests (POST /api/mcp/upload-url)
// ============================================================================

test("upload-url-route: unauthenticated request missing SSH headers is rejected with 401", async () => {
  const req = new NextRequest("http://localhost:3000/api/mcp/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: "test.png" })
  });

  const res = await uploadUrlHandler(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.success, false);
  assert.ok(json.error.includes("Missing required SSH cryptographic headers"));
});

test("upload-url-route: tampered signature or invalid key is rejected with 401", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Upload-Agent-1",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  const rawBody = JSON.stringify({ filename: "sample.png", content_type: "image/png" });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "nonce-" + crypto.randomUUID();

  // Valid signature
  const validSig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/upload-url",
    timestamp,
    nonce,
    body: rawBody
  });

  // 1. Tampered payload
  const tamperedReq = new NextRequest("http://localhost:3000/api/mcp/upload-url", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": timestamp,
      "x-agent-nonce": nonce,
      "x-agent-signature": validSig
    },
    body: JSON.stringify({ filename: "hacked.png" }) // modified body
  });

  const tamperedRes = await uploadUrlHandler(tamperedReq);
  assert.equal(tamperedRes.status, 401);

  // 2. Revoked key
  await keyStore.revokeKey(agent.fingerprint);
  const freshNonce = "fresh-nonce-" + crypto.randomUUID();
  const freshSig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/upload-url",
    timestamp,
    nonce: freshNonce,
    body: rawBody
  });

  const revokedReq = new NextRequest("http://localhost:3000/api/mcp/upload-url", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": timestamp,
      "x-agent-nonce": freshNonce,
      "x-agent-signature": freshSig
    },
    body: rawBody
  });

  const revokedRes = await uploadUrlHandler(revokedReq);
  assert.equal(revokedRes.status, 401);
});

test("upload-url-route: anti-replay and clock drift defenses are enforced", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Replay-Test-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  const rawBody = JSON.stringify({ filename: "replay-test.png" });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const replayNonce = "replay-nonce-" + crypto.randomUUID();

  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/upload-url",
    timestamp,
    nonce: replayNonce,
    body: rawBody
  });

  const makeReq = () =>
    new NextRequest("http://localhost:3000/api/mcp/upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-key-fingerprint": agent.fingerprint,
        "x-agent-timestamp": timestamp,
        "x-agent-nonce": replayNonce,
        "x-agent-signature": signature
      },
      body: rawBody
    });

  // First call succeeds
  const res1 = await uploadUrlHandler(makeReq());
  assert.equal(res1.status, 200);

  // Second call with same nonce is rejected as replay attack
  const res2 = await uploadUrlHandler(makeReq());
  assert.equal(res2.status, 401);
  const json2 = await res2.json();
  assert.ok(json2.error.includes("Replay attack detected"));

  // Expired clock skew (>60s)
  const expiredTimestamp = (Math.floor(Date.now() / 1000) - 120).toString();
  const expiredNonce = "expired-nonce-" + crypto.randomUUID();
  const expiredSig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/upload-url",
    timestamp: expiredTimestamp,
    nonce: expiredNonce,
    body: rawBody
  });

  const expiredReq = new NextRequest("http://localhost:3000/api/mcp/upload-url", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": expiredTimestamp,
      "x-agent-nonce": expiredNonce,
      "x-agent-signature": expiredSig
    },
    body: rawBody
  });

  const expiredRes = await uploadUrlHandler(expiredReq);
  assert.equal(expiredRes.status, 401);
  const expiredJson = await expiredRes.json();
  assert.ok(expiredJson.error.includes("Timestamp clock skew too large"));
});

test("upload-url-route: payload size exceeding 50MB is rejected with 400", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Oversized-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  const rawBody = JSON.stringify({
    filename: "huge-panorama.png",
    size_bytes: 60 * 1024 * 1024 // 60MB (> 50MB limit)
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "huge-nonce-" + crypto.randomUUID();
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/upload-url",
    timestamp,
    nonce,
    body: rawBody
  });

  const req = new NextRequest("http://localhost:3000/api/mcp/upload-url", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": timestamp,
      "x-agent-nonce": nonce,
      "x-agent-signature": signature
    },
    body: rawBody
  });

  const res = await uploadUrlHandler(req);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error.includes("exceeds 50MB maximum limit"));
});

test("upload-url-route: successful upload-url generation for valid signed request", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Happy-Path-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  const rawBody = JSON.stringify({
    filename: "product-render.png",
    content_type: "image/png",
    size_bytes: 12 * 1024 * 1024,
    expires_seconds: 600
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "happy-nonce-" + crypto.randomUUID();
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp/upload-url",
    timestamp,
    nonce,
    body: rawBody
  });

  const req = new NextRequest("http://localhost:3000/api/mcp/upload-url", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": timestamp,
      "x-agent-nonce": nonce,
      "x-agent-signature": signature
    },
    body: rawBody
  });

  const res = await uploadUrlHandler(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-agent-credits-remaining"), "100");

  const json = await res.json();
  assert.equal(json.success, true);
  assert.ok(json.upload_url);
  assert.ok(json.image_key.startsWith("raw/"));
  assert.ok(json.image_key.includes("product-render.png"));
  assert.ok(json.public_url);
  assert.equal(json.method, "PUT");
  assert.equal(json.headers["Content-Type"], "image/png");
  assert.equal(json.max_size_bytes, 52428800);
  assert.ok(new Date(json.expires_at).getTime() > Date.now());
});
