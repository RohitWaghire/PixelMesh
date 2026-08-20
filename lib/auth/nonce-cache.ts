/**
 * In-memory sliding window cache to prevent replay attacks
 */
class NonceCache {
  private nonces = new Map<string, number>();
  private readonly maxWindowSeconds: number;

  constructor(maxWindowSeconds = 60) {
    this.maxWindowSeconds = maxWindowSeconds;
    // Auto-prune expired nonces every 30s
    if (typeof setInterval !== "undefined") {
      setInterval(() => this.prune(), 30000).unref();
    }
  }

  /**
   * Validate and record nonce. Returns true if fresh, false if replayed or expired.
   */
  public checkAndRecord(nonce: string, timestampSeconds: number): { valid: boolean; reason?: string } {
    const now = Math.floor(Date.now() / 1000);
    const drift = Math.abs(now - timestampSeconds);

    if (drift > this.maxWindowSeconds) {
      return { valid: false, reason: `Timestamp clock skew too large (${drift}s > ${this.maxWindowSeconds}s)` };
    }

    if (this.nonces.has(nonce)) {
      return { valid: false, reason: "Replay attack detected: Nonce has already been used" };
    }

    this.nonces.set(nonce, timestampSeconds);
    return { valid: true };
  }

  public prune(): void {
    const cutoff = Math.floor(Date.now() / 1000) - this.maxWindowSeconds;
    for (const [nonce, ts] of this.nonces.entries()) {
      if (ts < cutoff) {
        this.nonces.delete(nonce);
      }
    }
  }

  public clear(): void {
    this.nonces.clear();
  }
}

export const nonceCache = new NonceCache(60);
