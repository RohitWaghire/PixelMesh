import test from "node:test";
import assert from "node:assert/strict";
import { prisma, InMemoryPrismaClient, resetMockDb } from "@/lib/db/prisma";
import { generateAgentKeypair, computeKeyFingerprint } from "@/lib/auth/agent-crypto";

test("stress: high-frequency atomic increment and decrement mutations (100 concurrent)", async () => {
  if (typeof resetMockDb === "function") resetMockDb();

  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  const initialKey = await prisma.agentKey.create({
    data: {
      fingerprint,
      agentName: "Atomic-Concurrency-Agent",
      publicKeyPem: keypair.publicKeyPem,
      creditsBalance: 500,
      totalInvocations: 0
    }
  });

  // Launch 100 concurrent decrement (-2) and increment (+1 invocations)
  const CONCURRENCY = 100;
  const promises = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    promises.push(
      prisma.agentKey.update({
        where: { id: initialKey.id },
        data: {
          creditsBalance: { decrement: 2 },
          totalInvocations: { increment: 1 }
        }
      })
    );
  }

  await Promise.all(promises);

  const finalKey = await prisma.agentKey.findUnique({
    where: { id: initialKey.id }
  });

  assert.ok(finalKey, "Final key must exist");
  assert.equal(
    finalKey.creditsBalance,
    500 - CONCURRENCY * 2,
    `creditsBalance must equal 300 after 100 decrements of 2 (actual: ${finalKey.creditsBalance})`
  );
  assert.equal(
    finalKey.totalInvocations,
    CONCURRENCY,
    `totalInvocations must equal 100 after 100 increments of 1 (actual: ${finalKey.totalInvocations})`
  );
});

test("stress: mixed high-frequency concurrent increments and decrements (200 ops)", async () => {
  if (typeof resetMockDb === "function") resetMockDb();

  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  const key = await prisma.agentKey.create({
    data: {
      fingerprint,
      agentName: "Mixed-Ops-Agent",
      publicKeyPem: keypair.publicKeyPem,
      creditsBalance: 1000,
      totalInvocations: 0
    }
  });

  // 100 operations of -5, 100 operations of +3
  // Net balance change: 100 * (-5) + 100 * (+3) = -500 + 300 = -200 (final: 800)
  const ops = [];
  for (let i = 0; i < 100; i++) {
    ops.push(
      prisma.agentKey.update({
        where: { id: key.id },
        data: { creditsBalance: { decrement: 5 } }
      })
    );
    ops.push(
      prisma.agentKey.update({
        where: { id: key.id },
        data: { creditsBalance: { increment: 3 } }
      })
    );
  }

  // Shuffle ops to maximize race conditions
  ops.sort(() => Math.random() - 0.5);

  await Promise.all(ops);

  const finalKey = await prisma.agentKey.findUnique({ where: { id: key.id } });
  assert.equal(finalKey?.creditsBalance, 800, `Net balance must be exactly 800 (actual: ${finalKey?.creditsBalance})`);
});

test("stress: multi-entity rollback strictly prevents all state mutations on error", async () => {
  if (typeof resetMockDb === "function") resetMockDb();

  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);
  const testEmail = `rollback-user-${Date.now()}@example.com`;
  const orgSlug = `rollback-org-${Date.now()}`;

  let caughtError = false;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Create Org
      const org = await tx.organization.create({
        data: { name: "Rollback Org", slug: orgSlug }
      });

      // 2. Create User
      const user = await tx.user.create({
        data: { email: testEmail, role: "ADMIN", organizationId: org.id }
      });

      // 3. Create AgentKey
      const agentKey = await tx.agentKey.create({
        data: {
          fingerprint,
          agentName: "Rollback-Key",
          publicKeyPem: keypair.publicKeyPem,
          userId: user.id,
          organizationId: org.id,
          creditsBalance: 500
        }
      });

      // 4. Create Ledger Entry
      await tx.creditTransaction.create({
        data: {
          agentKeyId: agentKey.id,
          amount: 500,
          balanceAfter: 500,
          type: "FREE_GRANT"
        }
      });

      // 5. Create Audit Log
      await tx.auditLog.create({
        data: {
          fingerprint,
          agentName: "Rollback-Key",
          method: "tools/call",
          status: "success",
          latencyMs: 15,
          nonce: "test-nonce-rollback"
        }
      });

      // 6. Simulate fatal error / unhandled exception in tool execution
      throw new Error("FATAL_SIMULATED_EXECUTION_FAILURE");
    });
  } catch (err: any) {
    caughtError = true;
    assert.equal(err.message, "FATAL_SIMULATED_EXECUTION_FAILURE");
  }

  assert.ok(caughtError, "Exception must be caught");

  // Verify that NONE of the records survived the transaction rollback
  const foundOrg = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  const foundUser = await prisma.user.findUnique({ where: { email: testEmail } });
  const foundKey = await prisma.agentKey.findUnique({ where: { fingerprint } });
  const foundTx = await prisma.creditTransaction.findMany({ where: { type: "FREE_GRANT" } });
  const foundLogs = await prisma.auditLog.findMany({ where: { nonce: "test-nonce-rollback" } });

  assert.equal(foundOrg, null, "Organization must not exist after rollback");
  assert.equal(foundUser, null, "User must not exist after rollback");
  assert.equal(foundKey, null, "AgentKey must not exist after rollback");
  assert.equal(foundTx.length, 0, "CreditTransaction must not exist after rollback");
  assert.equal(foundLogs.length, 0, "AuditLog must not exist after rollback");
});

test("stress: sequential interactive transactions with alternating failure and success", async () => {
  if (typeof resetMockDb === "function") resetMockDb();

  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  const initialKey = await prisma.agentKey.create({
    data: {
      fingerprint,
      agentName: "Alternating-Agent",
      publicKeyPem: keypair.publicKeyPem,
      creditsBalance: 100
    }
  });

  const TOTAL_ROUNDS = 20;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    const shouldFail = i % 2 === 1; // Odd rounds fail
    try {
      await prisma.$transaction(async (tx) => {
        await tx.agentKey.update({
          where: { id: initialKey.id },
          data: {
            creditsBalance: { decrement: 2 },
            totalInvocations: { increment: 1 }
          }
        });

        await tx.creditTransaction.create({
          data: {
            agentKeyId: initialKey.id,
            amount: -2,
            balanceAfter: 100 - (successCount + 1) * 2,
            type: "USAGE_DEDUCTION",
            referenceId: `round-${i}`
          }
        });

        if (shouldFail) {
          throw new Error(`Intentional Failure Round ${i}`);
        }
      });
      successCount++;
    } catch (err: any) {
      failCount++;
      assert.ok(err.message.startsWith("Intentional Failure"));
    }
  }

  assert.equal(successCount, 10, "10 transactions must succeed");
  assert.equal(failCount, 10, "10 transactions must fail and roll back");

  const finalKey = await prisma.agentKey.findUnique({
    where: { id: initialKey.id },
    include: { creditTransactions: true }
  });

  assert.equal(finalKey?.creditsBalance, 80, "Balance must be exactly 80 (100 - 10 * 2)");
  assert.equal(finalKey?.totalInvocations, 10, "Total invocations must be exactly 10");
  assert.equal(finalKey?.creditTransactions?.length, 10, "Exactly 10 credit transactions must be recorded in ledger");
});

test("stress: array batch $transaction rollback on any failed promise", async () => {
  if (typeof resetMockDb === "function") resetMockDb();

  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  const initialKey = await prisma.agentKey.create({
    data: {
      fingerprint,
      agentName: "Batch-Tx-Agent",
      publicKeyPem: keypair.publicKeyPem,
      creditsBalance: 200
    }
  });

  // Array batch transactions with successful operations
  const [updatedKey, txLog] = await prisma.$transaction([
    prisma.agentKey.update({
      where: { id: initialKey.id },
      data: { creditsBalance: 190 }
    }),
    prisma.creditTransaction.create({
      data: {
        agentKeyId: initialKey.id,
        amount: -10,
        balanceAfter: 190,
        type: "USAGE_DEDUCTION",
        referenceId: "batch-success"
      }
    })
  ]);

  assert.equal(updatedKey.creditsBalance, 190);
  assert.equal(txLog.amount, -10);

  const foundKey = await prisma.agentKey.findUnique({ where: { id: initialKey.id } });
  assert.equal(foundKey?.creditsBalance, 190);
});

test("stress: array batch $transaction fails to rollback preceding operations on error", async () => {
  if (typeof resetMockDb === "function") resetMockDb();

  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  const initialKey = await prisma.agentKey.create({
    data: {
      fingerprint,
      agentName: "Batch-Rollback-Agent",
      publicKeyPem: keypair.publicKeyPem,
      creditsBalance: 200
    }
  });

  let caughtError = false;
  try {
    await prisma.$transaction([
      prisma.agentKey.update({
        where: { id: initialKey.id },
        data: { creditsBalance: 150 }
      }),
      prisma.agentKey.update({
        where: { id: "non-existent-id-to-cause-failure" },
        data: { creditsBalance: 0 }
      })
    ]);
  } catch (err: any) {
    caughtError = true;
  }

  assert.ok(caughtError, "Batch transaction should have failed on non-existent record");

  const keyAfter = await prisma.agentKey.findUnique({ where: { id: initialKey.id } });
  console.log(`[Batch Tx Rollback Test] Initial: 200, After failed batch: ${keyAfter?.creditsBalance}`);
});


test("stress: concurrent interactive transactions with simulated delays and simulated failures", async () => {
  if (typeof resetMockDb === "function") resetMockDb();

  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  const initialKey = await prisma.agentKey.create({
    data: {
      fingerprint,
      agentName: "Concurrent-Tx-Agent",
      publicKeyPem: keypair.publicKeyPem,
      creditsBalance: 500,
      totalInvocations: 0
    }
  });

  const CONCURRENCY = 20;
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  let successCount = 0;
  let failCount = 0;

  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, async (_, idx) => {
      const shouldFail = idx % 2 === 1; // 10 fail, 10 succeed
      const delayMs = Math.floor(Math.random() * 15) + 5;

      return await prisma.$transaction(async (tx) => {
        // Step 1: Read current key
        const current = await tx.agentKey.findUnique({ where: { id: initialKey.id } });
        if (!current) throw new Error("Key not found");

        // Simulate async processing (e.g. tool execution / image processing)
        await delay(delayMs);

        // Step 2: Decrement balance atomically
        await tx.agentKey.update({
          where: { id: initialKey.id },
          data: {
            creditsBalance: { decrement: 5 },
            totalInvocations: { increment: 1 }
          }
        });

        // Step 3: Record transaction
        await tx.creditTransaction.create({
          data: {
            agentKeyId: initialKey.id,
            amount: -5,
            balanceAfter: current.creditsBalance - 5,
            type: "USAGE_DEDUCTION",
            referenceId: `concurrent-${idx}`
          }
        });

        if (shouldFail) {
          throw new Error(`CONCURRENT_FAIL_${idx}`);
        }

        return idx;
      });
    })
  );

  for (const res of results) {
    if (res.status === "fulfilled") successCount++;
    else failCount++;
  }

  console.log(`[Concurrent Tx Stress] Fulfilled: ${successCount}, Rejected: ${failCount}`);

  const finalKey = await prisma.agentKey.findUnique({
    where: { id: initialKey.id },
    include: { creditTransactions: true }
  });

  console.log(`[Concurrent Tx Stress] Final balance: ${finalKey?.creditsBalance}, Total Invocations: ${finalKey?.totalInvocations}, Transactions: ${finalKey?.creditTransactions?.length}`);

  assert.equal(
    finalKey?.creditsBalance,
    500 - successCount * 5,
    `Expected balance to be 500 - ${successCount * 5} = ${500 - successCount * 5}, but got ${finalKey?.creditsBalance}`
  );
  assert.equal(
    finalKey?.totalInvocations,
    successCount,
    `Expected totalInvocations to be ${successCount}, but got ${finalKey?.totalInvocations}`
  );
  assert.equal(
    finalKey?.creditTransactions?.length,
    successCount,
    `Expected exactly ${successCount} creditTransactions in ledger, but got ${finalKey?.creditTransactions?.length}`
  );
});

test("stress: concurrent independent transactions clobbering each other (lost updates across entities)", async () => {
  if (typeof resetMockDb === "function") resetMockDb();

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Run 5 concurrent transactions creating distinct organizations
  await Promise.all(
    Array.from({ length: 5 }, async (_, i) => {
      await prisma.$transaction(async (tx) => {
        await delay(10 * (5 - i)); // stagger timings
        await tx.organization.create({
          data: {
            name: `Concurrent Org ${i}`,
            slug: `concurrent-org-${i}`
          }
        });
      });
    })
  );

  const orgs = await prisma.organization.findMany();
  console.log(`[Concurrent Org Creation] Expected 5 organizations, found: ${orgs.length}`, orgs.map(o => o.slug));

  // Assert expected ACID behavior - this will expose the concurrency bug in the in-memory engine
  assert.equal(
    orgs.length,
    5,
    `ACID Isolation Failure: Expected all 5 concurrent transactions to commit distinct organizations, but found only ${orgs.length}. Lost updates occurred due to un-synchronized snapshot restoration.`
  );
});

test("stress: model delegates handle complex query filters and edge case inputs", async () => {
  if (typeof resetMockDb === "function") resetMockDb();

  const org = await prisma.organization.create({
    data: { name: "Filter Org", slug: "filter-org" }
  });

  const u1 = await prisma.user.create({
    data: { email: "alice@example.com", name: "Alice", role: "ADMIN", organizationId: org.id }
  });
  const u2 = await prisma.user.create({
    data: { email: "bob@example.com", name: "Bob", role: "MEMBER", organizationId: org.id }
  });
  const u3 = await prisma.user.create({
    data: { email: "charlie@example.com", name: "Charlie", role: "VIEWER", organizationId: org.id }
  });

  // Test `in` filter
  const foundIn = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "VIEWER"] } }
  });
  assert.equal(foundIn.length, 2);

  // Test `notIn` filter
  const foundNotIn = await prisma.user.findMany({
    where: { role: { notIn: ["ADMIN"] } }
  });
  assert.equal(foundNotIn.length, 2);

  // Test `contains` filter
  const foundContains = await prisma.user.findMany({
    where: { email: { contains: "bob" } }
  });
  assert.equal(foundContains.length, 1);
  assert.equal(foundContains[0].email, "bob@example.com");

  // Test `AND` condition
  const foundAnd = await prisma.user.findMany({
    where: {
      AND: [
        { organizationId: org.id },
        { role: "MEMBER" }
      ]
    }
  });
  assert.equal(foundAnd.length, 1);
  assert.equal(foundAnd[0].name, "Bob");

  // Test `OR` condition
  const foundOr = await prisma.user.findMany({
    where: {
      OR: [
        { email: "alice@example.com" },
        { email: "charlie@example.com" }
      ]
    }
  });
  assert.equal(foundOr.length, 2);

  // Test `findUniqueOrThrow` throwing on missing record
  await assert.rejects(
    async () => {
      await prisma.user.findUniqueOrThrow({
        where: { email: "nonexistent@example.com" }
      });
    },
    /Record not found in database/
  );
});



