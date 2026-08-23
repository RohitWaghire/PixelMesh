import test from "node:test";
import assert from "node:assert/strict";
import { prisma, resetMockDb, isMockPrisma } from "./prisma";
import { generateAgentKeypair, computeKeyFingerprint } from "../auth/agent-crypto";
import { seedDatabase } from "../../prisma/seed";

test("prisma: singleton instance is defined and exported with all model delegates", () => {
  assert.ok(prisma, "prisma singleton must be defined");
  assert.ok(prisma.organization, "prisma.organization delegate must be available");
  assert.ok(prisma.user, "prisma.user delegate must be available");
  assert.ok(prisma.agentKey, "prisma.agentKey delegate must be available");
  assert.ok(prisma.creditTransaction, "prisma.creditTransaction delegate must be available");
  assert.ok(prisma.auditLog, "prisma.auditLog delegate must be available");
  assert.ok(typeof prisma.$transaction === "function", "prisma.$transaction must be a function");
});

test("prisma: organization CRUD and unique slug constraint", async () => {
  if (typeof resetMockDb === "function") resetMockDb();

  const slug = `org-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const org = await prisma.organization.create({
    data: {
      name: "Acme AI Labs",
      slug
    }
  });

  assert.ok(org.id, "Organization must have an id");
  assert.equal(org.name, "Acme AI Labs");
  assert.equal(org.slug, slug);

  // Query by unique slug
  const found = await prisma.organization.findUnique({
    where: { slug }
  });
  assert.ok(found, "Organization should be findable by slug");
  assert.equal(found?.id, org.id);

  // Update organization name
  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { name: "Acme AI Robotics" }
  });
  assert.equal(updated.name, "Acme AI Robotics");
});

test("prisma: user CRUD and organization relation", async () => {
  const org = await prisma.organization.create({
    data: {
      name: "User Test Org",
      slug: `user-org-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    }
  });

  const email = `engineer-${Date.now()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      name: "Staff Engineer",
      role: "ADMIN",
      organizationId: org.id
    }
  });

  assert.ok(user.id);
  assert.equal(user.email, email);
  assert.equal(user.organizationId, org.id);

  // Query user with included organization
  const userWithOrg = await prisma.user.findUnique({
    where: { email },
    include: { organization: true }
  });
  assert.equal(userWithOrg?.organization?.id, org.id);
  assert.equal(userWithOrg?.organization?.name, "User Test Org");
});

test("prisma: agent key CRUD and relational integrity", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  const agentKey = await prisma.agentKey.create({
    data: {
      fingerprint,
      agentName: "Vision-Worker-01",
      publicKeyPem: keypair.publicKeyPem,
      algorithm: "ed25519",
      creditsBalance: 250,
      scopes: ["all-tools", "filters:*"],
      status: "active"
    }
  });

  assert.ok(agentKey.id);
  assert.equal(agentKey.fingerprint, fingerprint);
  assert.equal(agentKey.creditsBalance, 250);
  assert.equal(agentKey.status, "active");
  assert.deepEqual(agentKey.scopes, ["all-tools", "filters:*"]);

  const found = await prisma.agentKey.findUnique({
    where: { fingerprint }
  });
  assert.ok(found);
  assert.equal(found?.agentName, "Vision-Worker-01");
});

test("prisma: credit transaction ledger and balance association", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  const agentKey = await prisma.agentKey.create({
    data: {
      fingerprint,
      agentName: "Ledger-Test-Agent",
      publicKeyPem: keypair.publicKeyPem,
      creditsBalance: 100
    }
  });

  // Create initial FREE_GRANT transaction
  const grantTx = await prisma.creditTransaction.create({
    data: {
      agentKeyId: agentKey.id,
      amount: 100,
      balanceAfter: 100,
      type: "FREE_GRANT",
      referenceId: "test-grant"
    }
  });

  assert.ok(grantTx.id);
  assert.equal(grantTx.amount, 100);
  assert.equal(grantTx.type, "FREE_GRANT");

  // Query agentKey with creditTransactions relation
  const keyWithTxs = await prisma.agentKey.findUnique({
    where: { id: agentKey.id },
    include: { creditTransactions: true }
  });

  assert.ok(keyWithTxs?.creditTransactions);
  assert.equal(keyWithTxs?.creditTransactions?.length, 1);
  assert.equal(keyWithTxs?.creditTransactions?.[0].id, grantTx.id);
});

test("prisma: audit log creation and query filtering", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  const log = await prisma.auditLog.create({
    data: {
      fingerprint,
      agentName: "Audit-Agent",
      method: "tools/call",
      toolName: "adjust_contrast",
      status: "success",
      latencyMs: 42,
      costCredits: 1,
      creditsRemaining: 99,
      timestampDriftMs: 120,
      nonce: "550e8400-e29b-41d4-a716-446655440000",
      signatureValid: true
    }
  });

  assert.ok(log.id);
  assert.equal(log.toolName, "adjust_contrast");
  assert.equal(log.status, "success");
  assert.equal(log.costCredits, 1);

  // Query audit logs by fingerprint
  const logs = await prisma.auditLog.findMany({
    where: { fingerprint }
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].id, log.id);
});

test("prisma: atomic field increment and decrement mutations", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  const agentKey = await prisma.agentKey.create({
    data: {
      fingerprint,
      agentName: "Atomic-Mutation-Agent",
      publicKeyPem: keypair.publicKeyPem,
      creditsBalance: 100,
      totalInvocations: 5
    }
  });

  const updated = await prisma.agentKey.update({
    where: { id: agentKey.id },
    data: {
      creditsBalance: { decrement: 15 },
      totalInvocations: { increment: 2 }
    }
  });

  assert.equal(updated.creditsBalance, 85, "creditsBalance must be decremented from 100 to 85");
  assert.equal(updated.totalInvocations, 7, "totalInvocations must be incremented from 5 to 7");
});

test("prisma: atomic $transaction batch operations", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  const agentKey = await prisma.agentKey.create({
    data: {
      fingerprint,
      agentName: "Tx-Batch-Agent",
      publicKeyPem: keypair.publicKeyPem,
      creditsBalance: 50
    }
  });

  // Execute batch deduction and ledger entry
  const [updatedKey, txRecord] = await prisma.$transaction([
    prisma.agentKey.update({
      where: { id: agentKey.id },
      data: { creditsBalance: 47, totalInvocations: 1 }
    }),
    prisma.creditTransaction.create({
      data: {
        agentKeyId: agentKey.id,
        amount: -3,
        balanceAfter: 47,
        type: "USAGE_DEDUCTION",
        referenceId: "batch-test-call"
      }
    })
  ]);

  assert.equal(updatedKey.creditsBalance, 47);
  assert.equal(updatedKey.totalInvocations, 1);
  assert.equal(txRecord.amount, -3);
  assert.equal(txRecord.balanceAfter, 47);
});

test("prisma: interactive $transaction rollback on error", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  const initialKey = await prisma.agentKey.create({
    data: {
      fingerprint,
      agentName: "Rollback-Test-Agent",
      publicKeyPem: keypair.publicKeyPem,
      creditsBalance: 100
    }
  });

  // Attempt transactional deduction with deliberate error
  let caughtError = false;
  try {
    await prisma.$transaction(async (tx) => {
      // Step 1: Deduct balance
      await tx.agentKey.update({
        where: { id: initialKey.id },
        data: { creditsBalance: 90 }
      });

      // Step 2: Record transaction
      await tx.creditTransaction.create({
        data: {
          agentKeyId: initialKey.id,
          amount: -10,
          balanceAfter: 90,
          type: "USAGE_DEDUCTION"
        }
      });

      // Step 3: Deliberately abort
      throw new Error("Simulated tool failure or abort");
    });
  } catch (err: any) {
    caughtError = true;
    assert.equal(err.message, "Simulated tool failure or abort");
  }

  assert.ok(caughtError, "Transaction error must have been thrown");

  // Verify rollback: balance must remain 100, no transaction record created
  const keyAfter = await prisma.agentKey.findUnique({
    where: { id: initialKey.id },
    include: { creditTransactions: true }
  });

  assert.equal(keyAfter?.creditsBalance, 100, "Balance must be rolled back to 100");
  assert.equal(keyAfter?.creditTransactions?.length, 0, "Transaction record must not exist after rollback");
});

test("prisma: seedDatabase provisions default org, dev admin, and initial credit grant idempotently", async () => {
  const result1 = await seedDatabase();
  assert.ok(result1.organization.id);
  assert.equal(result1.organization.slug, "default");
  assert.equal(result1.agentKey.creditsBalance, 500);

  const grant1 = await prisma.creditTransaction.findFirst({
    where: { agentKeyId: result1.agentKey.id, type: "FREE_GRANT" }
  });
  assert.ok(grant1);
  assert.equal(grant1?.amount, 500);

  // Run seed a second time to verify idempotency
  const result2 = await seedDatabase();
  assert.equal(result2.organization.id, result1.organization.id);
  assert.equal(result2.agentKey.fingerprint, result1.agentKey.fingerprint);

  const grantsAfter = await prisma.creditTransaction.findMany({
    where: { agentKeyId: result1.agentKey.id, type: "FREE_GRANT" }
  });
  assert.equal(grantsAfter.length, 1, "Idempotent seed must not duplicate FREE_GRANT transactions");
});
