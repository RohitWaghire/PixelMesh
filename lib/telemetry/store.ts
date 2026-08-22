/**
 * PixelMesh Phase 1 - Relational Telemetry Store
 * 
 * Features:
 * 1. Persistent audit logging backed by Prisma (`AuditLog` entity).
 * 2. Asynchronous querying with pagination, fingerprint filtering, and status filtering.
 * 3. Backward-compatible mapping exposing both `timestamp` / `createdAt` and `tool` / `toolName`.
 */

import { prisma, AuditStatus, AuditLogRecord } from "../db/prisma";

export interface RequestLogEntry {
  id: string;
  timestamp: string;
  createdAt?: string | Date;
  method: string;
  tool?: string | null;
  toolName?: string | null;
  fingerprint: string;
  agentName: string;
  signatureValid: boolean;
  timestampDriftMs: number;
  nonce: string;
  costCredits: number;
  creditsRemaining: number;
  latencyMs: number;
  status: "success" | "auth_error" | "tool_error" | "rate_limited";
  errorMessage?: string | null;
  agentKeyId?: string | null;
  ipAddress?: string | null;
}

export type CreateRequestLogParams = Omit<RequestLogEntry, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

export class TelemetryStore {
  /**
   * Persist a request log entry into the relational database
   */
  public async addLog(entry: CreateRequestLogParams | RequestLogEntry): Promise<AuditLogRecord | null> {
    try {
      const toolName = entry.toolName || entry.tool || null;
      return await prisma.auditLog.create({
        data: {
          agentKeyId: entry.agentKeyId || null,
          fingerprint: entry.fingerprint,
          agentName: entry.agentName,
          method: entry.method,
          toolName,
          status: entry.status as AuditStatus,
          latencyMs: entry.latencyMs,
          costCredits: entry.costCredits,
          creditsRemaining: entry.creditsRemaining,
          timestampDriftMs: entry.timestampDriftMs,
          nonce: entry.nonce,
          ipAddress: entry.ipAddress || null,
          errorMessage: entry.errorMessage || null,
          signatureValid: entry.signatureValid ?? false
        }
      });
    } catch (err) {
      console.error("[TelemetryStore] Failed to persist audit log:", err);
      return null;
    }
  }

  /**
   * Alias for addLog
   */
  public async record(entry: CreateRequestLogParams | RequestLogEntry): Promise<AuditLogRecord | null> {
    return this.addLog(entry);
  }

  /**
   * Query recent audit logs with pagination and filters
   */
  public async getLogs(options: {
    take?: number;
    skip?: number;
    fingerprint?: string;
    status?: AuditStatus;
  } = {}): Promise<RequestLogEntry[]> {
    try {
      const where: any = {};
      if (options.fingerprint) where.fingerprint = options.fingerprint;
      if (options.status) where.status = options.status;

      const records = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: options.take ?? 100,
        skip: options.skip ?? 0
      });

      return records.map((r: AuditLogRecord) => ({
        id: r.id,
        timestamp: r.createdAt instanceof Date ? r.createdAt.toISOString() : new Date(r.createdAt).toISOString(),
        createdAt: r.createdAt,
        method: r.method,
        tool: r.toolName,
        toolName: r.toolName,
        fingerprint: r.fingerprint,
        agentName: r.agentName,
        signatureValid: r.signatureValid,
        timestampDriftMs: r.timestampDriftMs,
        nonce: r.nonce,
        costCredits: r.costCredits,
        creditsRemaining: r.creditsRemaining,
        latencyMs: r.latencyMs,
        status: r.status,
        errorMessage: r.errorMessage,
        agentKeyId: r.agentKeyId,
        ipAddress: r.ipAddress
      }));
    } catch (err) {
      console.error("[TelemetryStore] Failed to query audit logs:", err);
      return [];
    }
  }

  /**
   * Clear all audit logs (for testing and administrative maintenance)
   */
  public async clear(): Promise<void> {
    try {
      await prisma.auditLog.deleteMany();
    } catch (err) {
      console.error("[TelemetryStore] Failed to clear audit logs:", err);
    }
  }
}

export const telemetryStore = new TelemetryStore();
