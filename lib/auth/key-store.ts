import fs from "fs";
import path from "path";
import { computeKeyFingerprint, generateAgentKeypair } from "./agent-crypto";

export interface AuthorizedAgentKey {
  fingerprint: string;
  agentName: string;
  publicKeyPem: string;
  algorithm: "ed25519" | "rsa";
  creditsBalance: number;
  scopes: string[]; // ["all-tools", "filters:*", "geometry:*", "export-only"]
  createdAt: string;
  lastUsedAt?: string;
  totalInvocations: number;
  status: "active" | "revoked";
}

export interface KeyStoreData {
  keys: AuthorizedAgentKey[];
  initialDevKeypair?: {
    publicKeyPem: string;
    privateKeyPem: string;
  };
}

const KEYS_DIR = path.join(process.cwd(), ".keys");
const KEYS_FILE = path.join(KEYS_DIR, "authorized_keys.json");

class KeyStore {
  private data: KeyStoreData = { keys: [] };

  constructor() {
    this.ensureInitialized();
  }

  private ensureInitialized() {
    try {
      if (!fs.existsSync(KEYS_DIR)) {
        fs.mkdirSync(KEYS_DIR, { recursive: true });
      }

      if (fs.existsSync(KEYS_FILE)) {
        const raw = fs.readFileSync(KEYS_FILE, "utf-8");
        this.data = JSON.parse(raw);
      } else {
        // Auto-provision initial Dev Agent keypair
        const devKeypair = generateAgentKeypair("ed25519");
        const fingerprint = computeKeyFingerprint(devKeypair.publicKeyPem);

        const initialKey: AuthorizedAgentKey = {
          fingerprint,
          agentName: "Dev Admin Agent (Auto-Provisioned)",
          publicKeyPem: devKeypair.publicKeyPem,
          algorithm: "ed25519",
          creditsBalance: 500,
          scopes: ["all-tools"],
          createdAt: new Date().toISOString(),
          totalInvocations: 0,
          status: "active"
        };

        this.data = {
          keys: [initialKey],
          initialDevKeypair: devKeypair
        };

        this.save();
      }
    } catch (err) {
      console.error("[KeyStore] Initialization warning:", err);
    }
  }

  private save() {
    try {
      fs.writeFileSync(KEYS_FILE, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error("[KeyStore] Failed to save keys to file:", err);
    }
  }

  public getAllKeys(): AuthorizedAgentKey[] {
    this.ensureInitialized();
    return this.data.keys;
  }

  public getDevKeypair() {
    this.ensureInitialized();
    return this.data.initialDevKeypair;
  }

  public findKeyByFingerprint(fingerprint: string): AuthorizedAgentKey | undefined {
    this.ensureInitialized();
    return this.data.keys.find(k => k.fingerprint === fingerprint);
  }

  public registerKey(params: {
    agentName: string;
    publicKeyPem: string;
    algorithm?: "ed25519" | "rsa";
    scopes?: string[];
    initialCredits?: number;
  }): AuthorizedAgentKey {
    this.ensureInitialized();
    const fingerprint = computeKeyFingerprint(params.publicKeyPem);

    const existing = this.findKeyByFingerprint(fingerprint);
    if (existing) {
      if (existing.status === "revoked") {
        throw new Error("This agent key fingerprint has been revoked.");
      }
      if (params.initialCredits !== undefined) {
        existing.creditsBalance = params.initialCredits;
        this.save();
      }
      return existing;
    }

    const newKey: AuthorizedAgentKey = {
      fingerprint,
      agentName: params.agentName || "Autonomous AI Agent",
      publicKeyPem: params.publicKeyPem,
      algorithm: params.algorithm || "ed25519",
      creditsBalance: params.initialCredits ?? 100, // 100 free credits
      scopes: params.scopes || ["all-tools"],
      createdAt: new Date().toISOString(),
      totalInvocations: 0,
      status: "active"
    };

    this.data.keys.push(newKey);
    this.save();
    return newKey;
  }

  public deductCredits(fingerprint: string, amount: number): { success: boolean; remaining: number; error?: string } {
    this.ensureInitialized();
    const key = this.findKeyByFingerprint(fingerprint);
    if (!key) {
      return { success: false, remaining: 0, error: "Agent key not found" };
    }

    if (key.status === "revoked") {
      return { success: false, remaining: 0, error: "Agent key has been revoked" };
    }

    if (key.creditsBalance < amount) {
      return { 
        success: false, 
        remaining: key.creditsBalance, 
        error: `Insufficient credits. Required: ${amount}, Available: ${key.creditsBalance}` 
      };
    }

    key.creditsBalance -= amount;
    key.totalInvocations += 1;
    key.lastUsedAt = new Date().toISOString();
    this.save();

    return { success: true, remaining: key.creditsBalance };
  }

  public topUpCredits(fingerprint: string, amount: number): AuthorizedAgentKey {
    this.ensureInitialized();
    const key = this.findKeyByFingerprint(fingerprint);
    if (!key) {
      throw new Error("Agent key not found");
    }
    key.creditsBalance += amount;
    this.save();
    return key;
  }

  public revokeKey(fingerprint: string): AuthorizedAgentKey {
    this.ensureInitialized();
    const key = this.findKeyByFingerprint(fingerprint);
    if (!key) {
      throw new Error("Agent key not found");
    }
    key.status = "revoked";
    this.save();
    return key;
  }
}

export const keyStore = new KeyStore();
