/**
 * PixelMesh Phase 1 - KeyStore Unit & Concurrency Test Suite
 * 
 * Tests:
 * 1. KeyStore init & Dev Admin auto-provisioning idempotency.
 * 2. Agent key registration with FREE_GRANT transaction ledgering.
 * 3. Re-registration idempotency & revoked key registration rejection.
 * 4. Dual signature overload (object vs positional parameters).
 * 5. Atomic credit deduction with USAGE_DEDUCTION ledgering.
 * 6. Insufficient balance and zero-credit exhaustion boundary defenses.
 * 7. Revoked key deduction rejection and top-up rejection.
 * 8. 100-worker high-concurrency race condition testing (atomic isolation).
 * 9. Overdraw race condition defense with exact remaining balance.
 * 10. Negative deduction validation.
 * 11. Key list ordering and getAllKeys alias.
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { KeyStore, keyStore } from "@/lib/auth/key-store";
import { generateAgentKeypair, computeKeyFingerprint } from "@/lib/auth/agent-crypto";
import { prisma, resetMockDb } from "@/lib/db/prisma";

beforeEach(() => {
  resetMockDb();
});

test("keystore: init() provisions default organization, user, dev agent key, and FREE_GRANT idempotently", async () => {
  await keyStore.init();

  const devInfo = keyStore.getDevKeypair();
  assert.ok(devInfo, "Dev keypair info must be populated");
  assert.ok(devInfo.publicKeyPem.includes("BEGIN PUBLIC KEY"));
  assert.ok(devInfo.privateKeyPem.includes("BEGIN PRIVATE KEY"));
  assert.ok(devInfo.fingerprint.startsWith("SHA256:"));

  const keyInDb = await keyStore.findKeyByFingerprint(devInfo.fingerprint);
  assert.ok(keyInDb);
  assert.equal(keyInDb.status, "active");
  assert.equal(keyInDb.creditsBalance, 500);

  // Calling init() a second time should be idempotent
  await keyStore.init();
  const allKeys = await keyStore.listKeys();
  const devMatches = allKeys.filter(k => k.fingerprint === devInfo.fingerprint);
  assert.equal(devMatches.length, 1, "Should not duplicate dev admin key on multiple init calls");
});

test("keystore: registerKey persists key and creates FREE_GRANT ledger entry", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");
  const registered = await keyStore.registerKey({
    agentName: "Alpha-Agent",
    publicKeyPem,
    algorithm: "ed25519",
    initialCredits: 100,
    scopes: ["all-tools", "filters:*"]
  });

  assert.equal(registered.agentName, "Alpha-Agent");
  assert.equal(registered.creditsBalance, 100);
  assert.equal(registered.status, "active");
  assert.deepEqual(registered.scopes, ["all-tools", "filters:*"]);

  // Verify CreditTransaction ledger record
  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: registered.id }
  });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].type, "FREE_GRANT");
  assert.equal(txs[0].amount, 100);
  assert.equal(txs[0].balanceAfter, 100);
});

test("keystore: registerKey handles positional overload and duplicate public keys", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");

  // Positional invocation
  const key1 = await keyStore.registerKey("Positional-Agent", publicKeyPem, "ed25519", ["all-tools"], 150);
  assert.equal(key1.agentName, "Positional-Agent");
  assert.equal(key1.creditsBalance, 150);

  // Duplicate registration returns existing record
  const key2 = await keyStore.registerKey({
    agentName: "Attempted-Duplicate",
    publicKeyPem
  });
  assert.equal(key2.fingerprint, key1.fingerprint);
  assert.equal(key2.creditsBalance, 150);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: key1.id }
  });
  assert.equal(txs.length, 1, "Should not create duplicate FREE_GRANT transaction on re-registration");
});

test("keystore: deductCredits atomically decrements balance, increments invocations, and logs USAGE_DEDUCTION", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Worker-Agent",
    publicKeyPem,
    initialCredits: 10
  });

  const deductRes = await keyStore.deductCredits(agent.fingerprint, 3, "req-123", "adjust_brightness");
  assert.equal(deductRes.success, true);
  assert.equal(deductRes.remaining, 7);

  const updated = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(updated?.creditsBalance, 7);
  assert.equal(updated?.totalInvocations, 1);
  assert.ok(updated?.lastUsedAt);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].amount, -3);
  assert.equal(txs[0].balanceAfter, 7);
  assert.equal(txs[0].referenceId, "req-123");
});

test("keystore: deductCredits rejects insufficient credits without partial updates", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Broke-Agent",
    publicKeyPem,
    initialCredits: 2
  });

  const deductRes = await keyStore.deductCredits(agent.fingerprint, 5);
  assert.equal(deductRes.success, false);
  assert.equal(deductRes.remaining, 2);
  assert.ok(deductRes.error?.includes("Insufficient credits"));

  const keyAfter = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyAfter?.creditsBalance, 2);
  assert.equal(keyAfter?.totalInvocations, 0);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txs.length, 0, "No deduction ledger entry should be created on failure");
});

test("keystore: topUpCredits increments balance and logs TOP_UP transaction", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Topup-Agent",
    publicKeyPem,
    initialCredits: 50
  });

  const toppedUp = await keyStore.topUpCredits(agent.fingerprint, 100, "invoice-99");
  assert.equal(toppedUp.creditsBalance, 150);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "TOP_UP" }
  });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].amount, 100);
  assert.equal(txs[0].balanceAfter, 150);
  assert.equal(txs[0].referenceId, "invoice-99");
});

test("keystore: revokeKey blocks subsequent deductions and re-registration", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Revoke-Agent",
    publicKeyPem,
    initialCredits: 50
  });

  const revoked = await keyStore.revokeKey(agent.fingerprint);
  assert.equal(revoked.status, "revoked");

  // Deduct on revoked key
  const deductRes = await keyStore.deductCredits(agent.fingerprint, 1);
  assert.equal(deductRes.success, false);
  assert.ok(deductRes.error?.includes("revoked"));

  // Top up on revoked key
  await assert.rejects(async () => {
    await keyStore.topUpCredits(agent.fingerprint, 10);
  }, /revoked/);

  // Re-registration of revoked key
  await assert.rejects(async () => {
    await keyStore.registerKey({
      agentName: "Re-Register Attempt",
      publicKeyPem
    });
  }, /revoked/);
});

test("keystore: 100 concurrent deductions against shared balance execute atomically without lost updates", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Race-Worker-Agent",
    publicKeyPem,
    initialCredits: 100
  });

  // Launch 100 concurrent 1-credit deductions
  const tasks = Array.from({ length: 100 }, (_, i) =>
    keyStore.deductCredits(agent.fingerprint, 1, `race-req-${i}`)
  );

  const results = await Promise.all(tasks);

  const successes = results.filter(r => r.success === true);
  assert.equal(successes.length, 100, "All 100 deductions must succeed");

  const finalKey = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(finalKey?.creditsBalance, 0, "Final balance must be exactly 0");
  assert.equal(finalKey?.totalInvocations, 100, "Total invocations must be exactly 100");

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(txs.length, 100, "Exactly 100 USAGE_DEDUCTION records must exist");
});

test("keystore: 50 concurrent 3-credit deductions on 100 balance result in 33 successes, 17 rejections, and exact 1 credit remainder", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Overdraw-Agent",
    publicKeyPem,
    initialCredits: 100
  });

  // 50 requests * 3 credits = 150 credits requested (only 100 available)
  const tasks = Array.from({ length: 50 }, (_, i) =>
    keyStore.deductCredits(agent.fingerprint, 3, `overdraw-req-${i}`)
  );

  const results = await Promise.all(tasks);

  const successes = results.filter(r => r.success === true);
  const failures = results.filter(r => r.success === false);

  assert.equal(successes.length, 33, "Exactly 33 operations should succeed (33 * 3 = 99 credits)");
  assert.equal(failures.length, 17, "Exactly 17 operations should fail with insufficient credits");

  const finalKey = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(finalKey?.creditsBalance, 1, "Final balance must be exactly 1 remainder");
  assert.equal(finalKey?.totalInvocations, 33);
});

test("keystore: rejects negative deduction amount", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Neg-Agent",
    publicKeyPem,
    initialCredits: 50
  });

  const res = await keyStore.deductCredits(agent.fingerprint, -5);
  assert.equal(res.success, false);
  assert.ok(res.error?.includes("non-negative"));
});

test("keystore: non-existent key deduction returns agent key not found", async () => {
  const res = await keyStore.deductCredits("SHA256:nonexistentkey123456", 5);
  assert.equal(res.success, false);
  assert.ok(res.error?.includes("not found"));
});

test("keystore: listKeys and getAllKeys return all registered keys", async () => {
  const { publicKeyPem: pem1 } = generateAgentKeypair("ed25519");
  const { publicKeyPem: pem2 } = generateAgentKeypair("ed25519");

  await keyStore.registerKey({ agentName: "Agent-1", publicKeyPem: pem1, initialCredits: 10 });
  await keyStore.registerKey({ agentName: "Agent-2", publicKeyPem: pem2, initialCredits: 20 });

  const list = await keyStore.listKeys();
  const all = await keyStore.getAllKeys();

  assert.ok(list.length >= 2);
  assert.equal(list.length, all.length);
  assert.ok(list.some(k => k.agentName === "Agent-1"));
  assert.ok(list.some(k => k.agentName === "Agent-2"));
});
