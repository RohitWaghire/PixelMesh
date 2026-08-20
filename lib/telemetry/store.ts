export interface RequestLogEntry {
  id: string;
  timestamp: string;
  method: string;
  tool?: string;
  fingerprint: string;
  agentName: string;
  signatureValid: boolean;
  timestampDriftMs: number;
  nonce: string;
  costCredits: number;
  creditsRemaining: number;
  latencyMs: number;
  status: "success" | "auth_error" | "tool_error" | "rate_limited";
  errorMessage?: string;
}

class TelemetryStore {
  private logs: RequestLogEntry[] = [];
  private readonly maxLogs = 100;

  public addLog(entry: RequestLogEntry) {
    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
  }

  public getLogs(): RequestLogEntry[] {
    return this.logs;
  }

  public clear() {
    this.logs = [];
  }
}

export const telemetryStore = new TelemetryStore();
