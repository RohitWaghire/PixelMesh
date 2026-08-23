import fs from "fs";
import path from "path";
import { prisma } from "../lib/db/prisma";
import { 
  generateAgentKeypair, 
  computeKeyFingerprint, 
  AgentKeypair 
} from "../lib/auth/agent-crypto";

const KEYS_DIR = path.join(process.cwd(), ".keys");
const DEV_KEYPAIR_FILE = path.join(KEYS_DIR, "dev_admin_keypair.json");
const LEGACY_KEYS_FILE = path.join(KEYS_DIR, "authorized_keys.json");

export async function getOrCreateDevAdminKeypair(): Promise<{
  keypair: AgentKeypair;
  fingerprint: string;
}> {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  let keypair: AgentKeypair;

  // 1. Try reading existing dev keypair
  if (fs.existsSync(DEV_KEYPAIR_FILE)) {
    try {
      const content = JSON.parse(fs.readFileSync(DEV_KEYPAIR_FILE, "utf-8"));
      if (content.publicKeyPem && content.privateKeyPem) {
        keypair = {
          publicKeyPem: content.publicKeyPem,
          privateKeyPem: content.privateKeyPem,
          algorithm: content.algorithm || "ed25519"
        };
        const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);
        return { keypair, fingerprint };
      }
    } catch (e) {
      console.warn("[Seed] Could not read existing dev_admin_keypair.json, regenerating:", e);
    }
  }

  // 2. Fallback: check legacy authorized_keys.json
  if (fs.existsSync(LEGACY_KEYS_FILE)) {
    try {
      const legacyData = JSON.parse(fs.readFileSync(LEGACY_KEYS_FILE, "utf-8"));
      if (legacyData.initialDevKeypair) {
        keypair = {
          publicKeyPem: legacyData.initialDevKeypair.publicKeyPem,
          privateKeyPem: legacyData.initialDevKeypair.privateKeyPem,
          algorithm: "ed25519"
        };
        const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);
        // Persist to dev_admin_keypair.json
        fs.writeFileSync(DEV_KEYPAIR_FILE, JSON.stringify({ ...keypair, fingerprint }, null, 2), "utf-8");
        return { keypair, fingerprint };
      }
    } catch (e) {
      console.warn("[Seed] Could not read legacy authorized_keys.json:", e);
    }
  }

  // 3. Generate fresh Ed25519 Dev Keypair
  keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  // Save to .keys/dev_admin_keypair.json
  fs.writeFileSync(
    DEV_KEYPAIR_FILE,
    JSON.stringify({ ...keypair, fingerprint }, null, 2),
    "utf-8"
  );

  // Synchronize legacy authorized_keys.json for backward compatibility
  try {
    const legacyPayload = {
      keys: [
        {
          fingerprint,
          agentName: "Dev Admin Agent (Auto-Provisioned)",
          publicKeyPem: keypair.publicKeyPem,
          algorithm: "ed25519",
          creditsBalance: 500,
          scopes: ["all-tools"],
          createdAt: new Date().toISOString(),
          totalInvocations: 0,
          status: "active"
        }
      ],
      initialDevKeypair: keypair
    };
    fs.writeFileSync(LEGACY_KEYS_FILE, JSON.stringify(legacyPayload, null, 2), "utf-8");
  } catch (e) {
    console.warn("[Seed] Could not sync legacy authorized_keys.json:", e);
  }

  return { keypair, fingerprint };
}

export async function seedDatabase() {
  console.log("🌱 Starting PixelMesh database seed...");

  // 1. Ensure/Obtain Dev Admin Keypair
  const { keypair, fingerprint } = await getOrCreateDevAdminKeypair();
  console.log(`🔑 Dev Admin Key Fingerprint: ${fingerprint}`);

  // 2. Upsert Default Organization
  const defaultOrg = await prisma.organization.upsert({
    where: { slug: "default" },
    update: {
      name: "PixelMesh Default Organization"
    },
    create: {
      name: "PixelMesh Default Organization",
      slug: "default"
    }
  });
  console.log(`🏢 Default Organization ready: "${defaultOrg.name}" (${defaultOrg.id})`);

  // 3. Upsert Dev Admin User
  const devAdminUser = await prisma.user.upsert({
    where: { email: "admin@pixelmesh.local" },
    update: {
      name: "Dev Admin",
      role: "ADMIN",
      organizationId: defaultOrg.id
    },
    create: {
      email: "admin@pixelmesh.local",
      name: "Dev Admin",
      role: "ADMIN",
      organizationId: defaultOrg.id
    }
  });
  console.log(`👤 Dev Admin User ready: "${devAdminUser.name}" (${devAdminUser.email})`);

  // 4. Upsert Dev Admin AgentKey
  const devAgentKey = await prisma.agentKey.upsert({
    where: { fingerprint },
    update: {
      agentName: "Dev Admin Agent (Auto-Provisioned)",
      publicKeyPem: keypair.publicKeyPem,
      algorithm: "ed25519",
      creditsBalance: 500,
      scopes: ["all-tools"],
      status: "active",
      organizationId: defaultOrg.id,
      userId: devAdminUser.id
    },
    create: {
      fingerprint,
      agentName: "Dev Admin Agent (Auto-Provisioned)",
      publicKeyPem: keypair.publicKeyPem,
      algorithm: "ed25519",
      creditsBalance: 500,
      scopes: ["all-tools"],
      totalInvocations: 0,
      status: "active",
      organizationId: defaultOrg.id,
      userId: devAdminUser.id
    }
  });
  console.log(`🤖 Dev Admin AgentKey ready: ${devAgentKey.fingerprint} (Balance: ${devAgentKey.creditsBalance} credits)`);

  // 5. Create Initial FREE_GRANT Transaction Ledger Entry (if not already recorded)
  const existingGrant = await prisma.creditTransaction.findFirst({
    where: {
      agentKeyId: devAgentKey.id,
      type: "FREE_GRANT"
    }
  });

  if (!existingGrant) {
    const grantTx = await prisma.creditTransaction.create({
      data: {
        agentKeyId: devAgentKey.id,
        amount: 500,
        balanceAfter: 500,
        type: "FREE_GRANT",
        referenceId: "seed-dev-admin-grant"
      }
    });
    console.log(`💳 Initial FREE_GRANT transaction recorded: +${grantTx.amount} credits (ID: ${grantTx.id})`);
  } else {
    console.log(`💳 Initial FREE_GRANT transaction already exists (ID: ${existingGrant.id})`);
  }

  console.log("✅ PixelMesh database seed completed successfully.\n");
  return {
    organization: defaultOrg,
    user: devAdminUser,
    agentKey: devAgentKey,
    devKeypair: keypair
  };
}

// Auto-run when executed directly via tsx/node
if (typeof require !== "undefined" && require.main === module) {
  seedDatabase()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error("❌ Database seed failed:", e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
