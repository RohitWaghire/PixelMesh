import crypto from "crypto";

export type KeyAlgorithm = "ed25519" | "rsa";

export interface AgentKeypair {
  publicKeyPem: string;
  privateKeyPem: string;
  algorithm: KeyAlgorithm;
}

export interface SigningParams {
  privateKeyPem: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}

export interface VerificationParams {
  publicKeyPem: string;
  signature: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}

/**
 * Creates canonical signing string:
 * METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(BODY)
 */
export function createCanonicalSigningString(params: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}): string {
  const bodySha256 = crypto.createHash("sha256").update(params.body || "").digest("hex");
  return [
    params.method.toUpperCase(),
    params.path,
    params.timestamp,
    params.nonce,
    bodySha256
  ].join("\n");
}

/**
 * Compute canonical SHA256 key fingerprint (format: SHA256:<base64-url-safe>)
 */
export function computeKeyFingerprint(publicKeyPem: string): string {
  // Normalize PEM whitespace
  const normalized = publicKeyPem.trim();
  const hash = crypto.createHash("sha256").update(normalized).digest("base64url");
  return `SHA256:${hash}`;
}

/**
 * Generate a cryptographically secure keypair (Ed25519 or RSA-2048)
 */
export function generateAgentKeypair(algorithm: KeyAlgorithm = "ed25519"): AgentKeypair {
  if (algorithm === "ed25519") {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    return { publicKeyPem: publicKey, privateKeyPem: privateKey, algorithm: "ed25519" };
  } else {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    return { publicKeyPem: publicKey, privateKeyPem: privateKey, algorithm: "rsa" };
  }
}

/**
 * Sign canonical request string with Agent's private key
 */
export function signRequestPayload(params: SigningParams): string {
  const canonical = createCanonicalSigningString({
    method: params.method,
    path: params.path,
    timestamp: params.timestamp,
    nonce: params.nonce,
    body: params.body
  });

  const sign = crypto.createSign("SHA256");
  sign.update(canonical);
  sign.end();
  
  // Note: For Ed25519 in Node crypto, crypto.sign(null, buffer, privateKey) or crypto.sign('sha256', ...) works via sign()
  try {
    const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), params.privateKeyPem);
    return signature.toString("base64");
  } catch {
    const signature = crypto.sign("SHA256", Buffer.from(canonical, "utf8"), params.privateKeyPem);
    return signature.toString("base64");
  }
}

/**
 * Verify signature against Agent's public key
 */
export function verifyRequestSignature(params: VerificationParams): boolean {
  const canonical = createCanonicalSigningString({
    method: params.method,
    path: params.path,
    timestamp: params.timestamp,
    nonce: params.nonce,
    body: params.body
  });

  try {
    const sigBuffer = Buffer.from(params.signature, "base64");
    // Try null algorithm for ed25519, or SHA256 for RSA
    try {
      if (crypto.verify(null, Buffer.from(canonical, "utf8"), params.publicKeyPem, sigBuffer)) {
        return true;
      }
    } catch {
      // Fallback to SHA256
    }
    return crypto.verify("SHA256", Buffer.from(canonical, "utf8"), params.publicKeyPem, sigBuffer);
  } catch (err) {
    return false;
  }
}
