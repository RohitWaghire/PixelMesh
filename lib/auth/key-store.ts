/**
 * PixelMesh Phase 1 - Asynchronous Prisma-Backed KeyStore
 * 
 * Features:
 * 1. ACID-compliant relational persistence via PostgreSQL & Prisma ORM.
 * 2. Atomic credit deduction with race condition prevention via `prisma.$transaction`.
 * 3. Double-entry transaction ledgering (`CreditTransaction` with FREE_GRANT, USAGE_DEDUCTION, TOP_UP).
 * 4. Dual-signature support (options object and positional arguments) for 100% backward compatibility.
 * 5. Integrated Dev Admin key auto-provisioning and caching.
 * 6. Synchronous property decorator on returned promises to preserve compatibility with legacy unawaited key access.
 */

import fs from "fs";
import path from "path";
import { prisma, AgentKeyRecord } from "../db/prisma";
import { 
  computeKeyFingerprint, 
  generateAgentKeypair, 
  AgentKeypair 
} from "./agent-crypto";

export interface AuthorizedAgentKey {
  id?: string;
  fingerprint: string;
  agentName: string;
  publicKeyPem: string;
  algorithm: "ed25519" | "rsa";
  creditsBalance: number;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
  totalInvocations: number;
  status: "active" | "revoked";
  organizationId?: string | null;
  userId?: string | null;
}

export interface RegisterKeyParams {
  agentName?: string;
  publicKeyPem: string;
  algorithm?: "ed25519" | "rsa";
  scopes?: string[];
  initialCredits?: number;
  organizationId?: string | null;
  userId?: string | null;
}

export interface DeductCreditsResult {
  success: boolean;
  remaining: number;
  error?: string;
}

export interface DevKeypairInfo {
  keypair: AgentKeypair;
  fingerprint: string;
  creditsBalance: number;
  publicKeyPem: string;
  privateKeyPem: string;
}

function toAuthorizedAgentKey(record: AgentKeyRecord): AuthorizedAgentKey {
  return {
    id: record.id,
    fingerprint: record.fingerprint,
    agentName: record.agentName,
    publicKeyPem: record.publicKeyPem,
    algorithm: record.algorithm as "ed25519" | "rsa",
    creditsBalance: record.creditsBalance,
    scopes: Array.isArray(record.scopes) ? record.scopes : ["all-tools"],
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : new Date(record.createdAt).toISOString(),
    lastUsedAt: record.lastUsedAt ? (record.lastUsedAt instanceof Date ? record.lastUsedAt.toISOString() : new Date(record.lastUsedAt).toISOString()) : undefined,
    totalInvocations: record.totalInvocations ?? 0,
    status: record.status as "active" | "revoked",
    organizationId: record.organizationId ?? null,
    userId: record.userId ?? null
  };
}

const KEYS_DIR = path.join(process.cwd(), ".keys");
const DEV_KEYPAIR_FILE = path.join(KEYS_DIR, "dev_admin_keypair.json");
const LEGACY_KEYS_FILE = path.join(KEYS_DIR, "authorized_keys.json");

export class KeyStore {
  private devKeypairData: DevKeypairInfo | null = null;
  private initialized = false;

  constructor() {
    // Generate immediate in-memory fallback dev keypair so getDevKeypair() is always available synchronously
    try {
      const dev = generateAgentKeypair("ed25519");
      const fp = computeKeyFingerprint(dev.publicKeyPem);
      this.devKeypairData = {
        keypair: dev,
        fingerprint: fp,
        creditsBalance: 500,
        publicKeyPem: dev.publicKeyPem,
        privateKeyPem: dev.privateKeyPem
      };
    } catch {
      // ignore
    }
  }

  /**
   * Initializes dev admin keypair and ensures default seed state exists in the database
   */
  public async init(): Promise<void> {
    try {
      if (!fs.existsSync(KEYS_DIR)) {
        try {
          fs.mkdirSync(KEYS_DIR, { recursive: true });
        } catch {
          // ignore
        }
      }

      let keypair: AgentKeypair | null = null;
      let fingerprint: string | null = null;

      // 1. Try reading dev_admin_keypair.json
      if (fs.existsSync(DEV_KEYPAIR_FILE)) {
        try {
          const content = JSON.parse(fs.readFileSync(DEV_KEYPAIR_FILE, "utf-8"));
          if (content.publicKeyPem && content.privateKeyPem) {
            keypair = {
              publicKeyPem: content.publicKeyPem,
              privateKeyPem: content.privateKeyPem,
              algorithm: content.algorithm || "ed25519"
            };
            fingerprint = content.fingerprint || computeKeyFingerprint(keypair.publicKeyPem);
          }
        } catch (e) {
          console.warn("[KeyStore] Warning reading dev_admin_keypair.json:", e);
        }
      }

      // 2. Fallback to legacy authorized_keys.json
      if (!keypair && fs.existsSync(LEGACY_KEYS_FILE)) {
        try {
          const content = JSON.parse(fs.readFileSync(LEGACY_KEYS_FILE, "utf-8"));
          if (content.initialDevKeypair) {
            keypair = {
              publicKeyPem: content.initialDevKeypair.publicKeyPem,
              privateKeyPem: content.initialDevKeypair.privateKeyPem,
              algorithm: "ed25519"
            };
            fingerprint = computeKeyFingerprint(keypair.publicKeyPem);
          }
        } catch (e) {
          console.warn("[KeyStore] Warning reading authorized_keys.json:", e);
        }
      }

      // 3. Fallback to existing this.devKeypairData or generate fresh
      if (!keypair || !fingerprint) {
        if (this.devKeypairData) {
          keypair = this.devKeypairData.keypair;
          fingerprint = this.devKeypairData.fingerprint;
        } else {
          keypair = generateAgentKeypair("ed25519");
          fingerprint = computeKeyFingerprint(keypair.publicKeyPem);
        }
        try {
          fs.writeFileSync(DEV_KEYPAIR_FILE, JSON.stringify({ ...keypair, fingerprint }, null, 2), "utf-8");
        } catch {
          // ignore
        }
      }

      // 4. Ensure Dev Admin exists in Prisma
      const existing = await prisma.agentKey.findUnique({
        where: { fingerprint }
      });

      if (!existing) {
        let defaultOrg = await prisma.organization.findUnique({ where: { slug: "default" } });
        if (!defaultOrg) {
          defaultOrg = await prisma.organization.findFirst({ where: { slug: "default" } });
        }
        if (!defaultOrg) {
          defaultOrg = await prisma.organization.create({
            data: { name: "PixelMesh Default Organization", slug: "default" }
          });
        }

        let devAdminUser = await prisma.user.findUnique({ where: { email: "admin@pixelmesh.local" } });
        if (!devAdminUser) {
          devAdminUser = await prisma.user.findFirst({ where: { email: "admin@pixelmesh.local" } });
        }
        if (!devAdminUser) {
          devAdminUser = await prisma.user.create({
            data: { email: "admin@pixelmesh.local", name: "Dev Admin", role: "ADMIN", organizationId: defaultOrg.id }
          });
        }

        const devKey = await prisma.agentKey.create({
          data: {
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

        await prisma.creditTransaction.create({
          data: {
            agentKeyId: devKey.id,
            amount: 500,
            balanceAfter: 500,
            type: "FREE_GRANT",
            referenceId: "seed-dev-admin-grant"
          }
        });

        this.devKeypairData = {
          keypair,
          fingerprint,
          creditsBalance: 500,
          publicKeyPem: keypair.publicKeyPem,
          privateKeyPem: keypair.privateKeyPem
        };
      } else {
        this.devKeypairData = {
          keypair,
          fingerprint,
          creditsBalance: existing.creditsBalance,
          publicKeyPem: keypair.publicKeyPem,
          privateKeyPem: keypair.privateKeyPem
        };
      }

      this.initialized = true;
    } catch (err) {
      console.warn("[KeyStore] init() warning:", err);
    }
  }

  /**
   * Returns the cached Dev Admin keypair and fingerprint
   */
  public getDevKeypair(): DevKeypairInfo | null {
    if (this.devKeypairData) {
      return this.devKeypairData;
    }
    try {
      if (fs.existsSync(DEV_KEYPAIR_FILE)) {
        const content = JSON.parse(fs.readFileSync(DEV_KEYPAIR_FILE, "utf-8"));
        if (content.publicKeyPem && content.privateKeyPem) {
          const fingerprint = content.fingerprint || computeKeyFingerprint(content.publicKeyPem);
          return {
            keypair: {
              publicKeyPem: content.publicKeyPem,
              privateKeyPem: content.privateKeyPem,
              algorithm: content.algorithm || "ed25519"
            },
            fingerprint,
            creditsBalance: 500,
            publicKeyPem: content.publicKeyPem,
            privateKeyPem: content.privateKeyPem
          };
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Find key record by SHA-256 fingerprint
   */
  public async findKeyByFingerprint(fingerprint: string): Promise<AuthorizedAgentKey | null> {
    const key = await prisma.agentKey.findUnique({
      where: { fingerprint }
    });
    if (!key) return null;
    return toAuthorizedAgentKey(key);
  }

  /**
   * Register a new agent public key with atomic FREE_GRANT ledger entry
   */
  public registerKey(
    paramsOrName: RegisterKeyParams | string,
    publicKeyPem?: string,
    algorithm?: "ed25519" | "rsa",
    scopes?: string[],
    initialCredits?: number,
    organizationId?: string | null,
    userId?: string | null
  ): Promise<AuthorizedAgentKey> & Partial<AuthorizedAgentKey> {
    let params: RegisterKeyParams;

    if (typeof paramsOrName === "object" && paramsOrName !== null) {
      params = paramsOrName;
    } else {
      params = {
        agentName: paramsOrName,
        publicKeyPem: publicKeyPem!,
        algorithm: algorithm || "ed25519",
        scopes: scopes || ["all-tools"],
        initialCredits: initialCredits !== undefined ? initialCredits : 100,
        organizationId: organizationId || null,
        userId: userId || null
      };
    }

    if (!params.publicKeyPem) {
      throw new Error("Missing required field: publicKeyPem");
    }

    const fingerprint = computeKeyFingerprint(params.publicKeyPem);
    const agentName = params.agentName || "Autonomous AI Agent";
    const keyAlgorithm = params.algorithm || "ed25519";
    const keyScopes = params.scopes || ["all-tools"];
    const credits = params.initialCredits !== undefined ? params.initialCredits : 100;

    const execPromise = (async (): Promise<AuthorizedAgentKey> => {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.agentKey.findUnique({
          where: { fingerprint }
        });

        if (existing) {
          if (existing.status === "revoked") {
            throw new Error("This agent key fingerprint has been revoked.");
          }
          if (params.agentName && params.agentName !== existing.agentName) {
            const updated = await tx.agentKey.update({
              where: { id: existing.id },
              data: { agentName: params.agentName }
            });
            return toAuthorizedAgentKey(updated);
          }
          return toAuthorizedAgentKey(existing);
        }

        const created = await tx.agentKey.create({
          data: {
            fingerprint,
            agentName,
            publicKeyPem: params.publicKeyPem,
            algorithm: keyAlgorithm,
            creditsBalance: credits,
            scopes: keyScopes,
            totalInvocations: 0,
            status: "active",
            organizationId: params.organizationId || null,
            userId: params.userId || null
          }
        });

        await tx.creditTransaction.create({
          data: {
            agentKeyId: created.id,
            amount: credits,
            balanceAfter: credits,
            type: "FREE_GRANT",
            referenceId: `reg-${created.id}`
          }
        });

        return toAuthorizedAgentKey(created);
      });
    })();

    // Decorate promise object with synchronous properties for backwards compatibility
    const decorated: any = execPromise;
    decorated.fingerprint = fingerprint;
    decorated.agentName = agentName;
    decorated.publicKeyPem = params.publicKeyPem;
    decorated.algorithm = keyAlgorithm;
    decorated.creditsBalance = credits;
    decorated.scopes = keyScopes;
    decorated.status = "active";
    decorated.totalInvocations = 0;

    return decorated;
  }

  /**
   * Atomic transactional credit deduction with race condition prevention & idempotency
   */
  public deductCredits(
    fingerprint: string,
    amount: number,
    referenceId?: string,
    toolName?: string
  ): Promise<DeductCreditsResult> & Partial<DeductCreditsResult> {
    if (amount < 0) {
      const errRes: DeductCreditsResult = { success: false, remaining: 0, error: "Deduction amount must be non-negative" };
      const p: any = Promise.resolve(errRes);
      p.success = false;
      p.remaining = 0;
      p.error = errRes.error;
      return p;
    }

    const execPromise = (async (): Promise<DeductCreditsResult> => {
      return await prisma.$transaction(async (tx) => {
        const key = await tx.agentKey.findUnique({
          where: { fingerprint }
        });

        if (!key) {
          return { success: false, remaining: 0, error: "Agent key not found" };
        }

        if (key.status === "revoked") {
          return { success: false, remaining: 0, error: "Agent key has been revoked" };
        }

        if (amount === 0) {
          return { success: true, remaining: key.creditsBalance };
        }

        // Idempotency check: if explicit referenceId was already processed, return existing balance
        if (referenceId) {
          const existingTx = await tx.creditTransaction.findFirst({
            where: { referenceId, agentKeyId: key.id }
          });
          if (existingTx) {
            return {
              success: true,
              remaining: existingTx.balanceAfter
            };
          }
        }

        const now = new Date();

        // Atomic conditional decrement: prevents race condition overdraw in Read Committed PostgreSQL
        const updateResult = await tx.agentKey.updateMany({
          where: {
            id: key.id,
            status: "active",
            creditsBalance: { gte: amount }
          },
          data: {
            creditsBalance: { decrement: amount },
            totalInvocations: { increment: 1 },
            lastUsedAt: now
          }
        });

        const refreshedKey = await tx.agentKey.findUnique({ where: { id: key.id } });

        if (updateResult.count === 0) {
          const currentBal = refreshedKey?.creditsBalance ?? 0;
          return {
            success: false,
            remaining: currentBal,
            error: `Insufficient credits. Required: ${amount}, Available: ${currentBal}`
          };
        }

        const newBalance = refreshedKey?.creditsBalance ?? (key.creditsBalance - amount);

        await tx.creditTransaction.create({
          data: {
            agentKeyId: key.id,
            amount: -amount,
            balanceAfter: newBalance,
            type: "USAGE_DEDUCTION",
            referenceId: referenceId || (toolName ? `tool:${toolName}` : null)
          }
        });

        return {
          success: true,
          remaining: newBalance
        };
      });
    })();

    return execPromise as any;
  }

  /**
   * Atomic credit top-up with TOP_UP ledger record
   */
  public async topUpCredits(
    fingerprint: string,
    amount: number,
    referenceId?: string
  ): Promise<AuthorizedAgentKey> {
    if (amount <= 0) {
      throw new Error("Top up amount must be greater than 0");
    }

    return await prisma.$transaction(async (tx) => {
      const key = await tx.agentKey.findUnique({
        where: { fingerprint }
      });

      if (!key) {
        throw new Error("Agent key not found");
      }

      if (key.status === "revoked") {
        throw new Error("Cannot top up a revoked agent key");
      }

      const newBalance = key.creditsBalance + amount;

      const updated = await tx.agentKey.update({
        where: { id: key.id },
        data: {
          creditsBalance: { increment: amount }
        }
      });

      await tx.creditTransaction.create({
        data: {
          agentKeyId: key.id,
          amount,
          balanceAfter: newBalance,
          type: "TOP_UP",
          referenceId: referenceId || `topup-${Date.now()}`
        }
      });

      return toAuthorizedAgentKey(updated);
    });
  }

  /**
   * Revoke an active agent key
   */
  public async revokeKey(fingerprint: string): Promise<AuthorizedAgentKey> {
    return await prisma.$transaction(async (tx) => {
      const key = await tx.agentKey.findUnique({
        where: { fingerprint }
      });

      if (!key) {
        throw new Error("Agent key not found");
      }

      const updated = await tx.agentKey.update({
        where: { id: key.id },
        data: {
          status: "revoked"
        }
      });

      return toAuthorizedAgentKey(updated);
    });
  }

  /**
   * List all registered keys ordered by creation date descending
   */
  public async listKeys(): Promise<AuthorizedAgentKey[]> {
    const keys = await prisma.agentKey.findMany({
      orderBy: { createdAt: "desc" }
    });
    return keys.map(toAuthorizedAgentKey);
  }

  /**
   * Backward-compatibility alias for listKeys()
   */
  public async getAllKeys(): Promise<AuthorizedAgentKey[]> {
    return this.listKeys();
  }
}

export const keyStore = new KeyStore();
