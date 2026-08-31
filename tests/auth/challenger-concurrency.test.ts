/**
 * PixelMesh Phase 1 - Challenger Concurrency & Transaction Stress Test Suite
 * 
 * Adversarial tests:
 * 1. 150 concurrent deductions on 100-credit balance (exhaustion & zero negative balance).
 * 2. 200 concurrent variable-cost deductions (1, 2, 3, 5 credits) with ledger sum verification.
 * 3. 120 concurrent mixed operations (deductions + top-ups + reads) with total ledger accounting.
 * 4. Revocation race condition under high concurrency.
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { KeyStore, keyStore } from "@/lib/auth/key-store";
import { generateAgentKeypair } from "@/lib/auth/agent-crypto";
import { prisma, resetMockDb } from "@/lib/db/prisma";

beforeEach(() => {
  resetMockDb();
});

test("challenger-concurrency: 150 concurrent deductions against 100-credit key (zero negative balance, zero lost updates)", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Challenger-Worker-1",
    publicKeyPem,
    initialCredits: 100
  });

  assert.equal(agent.creditsBalance, 100);

  // Launch 150 concurrent 1-credit deductions
  const tasks = Array.from({ length: 150 }, (_, i) =>
    keyStore.deductCredits(agent.fingerprint, 1, `race-task-${i}`)
  );

  const results = await Promise.all(tasks);

  const successes = results.filter(r => r.success === true);
  const failures = results.filter(r => r.success === false);

  assert.equal(successes.length, 100, "Exactly 100 deductions must succeed");
  assert.equal(failures.length, 50, "Exactly 50 deductions must fail due to exhaustion");

  // Verify all failures returned remaining balance 0 and appropriate error
  for (const failure of failures) {
    assert.equal(failure.remaining, 0, "Failure must report remaining balance as 0");
    assert.ok(failure.error?.includes("Insufficient credits"), "Error must state Insufficient credits");
  }

  // Verify key state in database
  const finalKey = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.ok(finalKey);
  assert.equal(finalKey.creditsBalance, 0, "Final balance must be exactly 0 (never negative)");
  assert.equal(finalKey.totalInvocations, 100, "Total invocations must be exactly 100");

  // Verify CreditTransaction ledger
  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id }
  });

  const grantTxs = txs.filter(t => t.type === "FREE_GRANT");
  const deductionTxs = txs.filter(t => t.type === "USAGE_DEDUCTION");

  assert.equal(grantTxs.length, 1, "Exactly 1 FREE_GRANT record");
  assert.equal(grantTxs[0].amount, 100);
  assert.equal(grantTxs[0].balanceAfter, 100);

  assert.equal(deductionTxs.length, 100, "Exactly 100 USAGE_DEDUCTION records in ledger");
  const totalDeducted = deductionTxs.reduce((sum, t) => sum + t.amount, 0);
  assert.equal(totalDeducted, -100, "Sum of deductions must equal -100");

  // Verify balance monotonic decrease across transactions
  const sortedDeductions = [...deductionTxs].sort((a, b) => b.balanceAfter - a.balanceAfter);
  for (let i = 0; i < sortedDeductions.length; i++) {
    assert.equal(sortedDeductions[i].balanceAfter, 99 - i, `Transaction ${i} balanceAfter must be ${99 - i}`);
  }
});

test("challenger-concurrency: 200 concurrent variable-cost deductions (1, 2, 3, 5 credits) with strict ledger reconciliation", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");
  const initialCredits = 100;
  const agent = await keyStore.registerKey({
    agentName: "Challenger-Variable-Worker",
    publicKeyPem,
    initialCredits
  });

  const costs = [1, 2, 3, 5];
  const tasks = Array.from({ length: 200 }, (_, i) => {
    const cost = costs[i % costs.length];
    return keyStore.deductCredits(agent.fingerprint, cost, `var-task-${i}`).then(res => ({
      index: i,
      cost,
      res
    }));
  });

  const results = await Promise.all(tasks);

  const successes = results.filter(r => r.res.success);
  const failures = results.filter(r => !r.res.success);

  const totalSuccessfulCost = successes.reduce((sum, s) => sum + s.cost, 0);

  const finalKey = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.ok(finalKey);
  assert.ok(finalKey.creditsBalance >= 0, "Balance must never be negative");
  assert.equal(
    finalKey.creditsBalance,
    initialCredits - totalSuccessfulCost,
    "Final balance must strictly equal initialCredits - totalSuccessfulCost"
  );
  assert.equal(
    finalKey.totalInvocations,
    successes.length,
    "Total invocations must equal number of successful deductions"
  );

  // Reconcile with CreditTransaction ledger
  const deductionTxs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });

  assert.equal(deductionTxs.length, successes.length, "Ledger records must match successful operations count");
  const sumLedgerDeductions = deductionTxs.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  assert.equal(sumLedgerDeductions, totalSuccessfulCost, "Sum of ledger deductions must match total successful cost");
});

test("challenger-concurrency: 120 concurrent mixed operations (deductions + top-ups + reads) with total ledger accounting", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");
  const initialCredits = 50;
  const agent = await keyStore.registerKey({
    agentName: "Challenger-Mixed-Worker",
    publicKeyPem,
    initialCredits
  });

  let topUpAmounts: number[] = [];
  let deductionAmounts: number[] = [];

  const mixedTasks = Array.from({ length: 120 }, async (_, i) => {
    const mod = i % 3;
    if (mod === 0) {
      // Deduction of 1-4 credits
      const amount = (i % 4) + 1;
      const res = await keyStore.deductCredits(agent.fingerprint, amount, `mixed-deduct-${i}`);
      if (res.success) {
        deductionAmounts.push(amount);
      }
      return { type: "deduct", res };
    } else if (mod === 1) {
      // Top up of 5-15 credits
      const amount = ((i % 3) + 1) * 5;
      const res = await keyStore.topUpCredits(agent.fingerprint, amount, `mixed-topup-${i}`);
      topUpAmounts.push(amount);
      return { type: "topup", res };
    } else {
      // Read key
      const key = await keyStore.findKeyByFingerprint(agent.fingerprint);
      return { type: "read", key };
    }
  });

  await Promise.all(mixedTasks);

  const finalKey = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.ok(finalKey);

  const totalTopUp = topUpAmounts.reduce((a, b) => a + b, 0);
  const totalDeducted = deductionAmounts.reduce((a, b) => a + b, 0);
  const expectedBalance = initialCredits + totalTopUp - totalDeducted;

  assert.equal(
    finalKey.creditsBalance,
    expectedBalance,
    `Final balance (${finalKey.creditsBalance}) must match expected (${expectedBalance})`
  );
  assert.ok(finalKey.creditsBalance >= 0, "Balance must never be negative");

  // Check ledger counts and sums
  const allTxs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id }
  });

  const topupTxs = allTxs.filter(t => t.type === "TOP_UP");
  const deductTxs = allTxs.filter(t => t.type === "USAGE_DEDUCTION");

  assert.equal(topupTxs.length, topUpAmounts.length, "All top ups must have ledger entries");
  assert.equal(deductTxs.length, deductionAmounts.length, "All successful deductions must have ledger entries");

  const ledgerTopUpSum = topupTxs.reduce((sum, t) => sum + t.amount, 0);
  assert.equal(ledgerTopUpSum, totalTopUp);

  const ledgerDeductSum = deductTxs.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  assert.equal(ledgerDeductSum, totalDeducted);
});

test("challenger-concurrency: key revocation race condition under high concurrent traffic", async () => {
  const { publicKeyPem } = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Challenger-Revocation-Worker",
    publicKeyPem,
    initialCredits: 100
  });

  // Launch 50 concurrent deductions with 1 revoke operation interspersed
  const tasks = Array.from({ length: 50 }, async (_, i) => {
    if (i === 20) {
      // Interspersed revocation
      return { type: "revoke", res: await keyStore.revokeKey(agent.fingerprint) };
    }
    return {
      type: "deduct",
      res: await keyStore.deductCredits(agent.fingerprint, 1, `rev-task-${i}`)
    };
  });

  const results = await Promise.all(tasks);

  const finalKey = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.ok(finalKey);
  assert.equal(finalKey.status, "revoked");

  // Once revoked, subsequent operations are guaranteed to fail
  const postRevokeDeduct = await keyStore.deductCredits(agent.fingerprint, 1);
  assert.equal(postRevokeDeduct.success, false);
  assert.ok(postRevokeDeduct.error?.includes("revoked"));

  // Check ledger consistency
  const deductionTxs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });

  const successfulDeducts = results.filter(r => r.type === "deduct" && (r.res as any).success);
  assert.equal(deductionTxs.length, successfulDeducts.length);
  assert.equal(finalKey.creditsBalance, 100 - successfulDeducts.length);
  assert.ok(finalKey.creditsBalance >= 0);
});
