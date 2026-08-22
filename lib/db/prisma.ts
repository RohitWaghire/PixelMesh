/**
 * PixelMesh Phase 1 - Relational Database Client & Singleton Architecture
 * 
 * Features:
 * 1. Global singleton instance with globalThis caching (Next.js Fast Refresh safe).
 * 2. Multi-mode engine: Real PrismaClient when DATABASE_URL is configured,
 *    In-Memory Mock Adapter when DATABASE_URL is absent or in test mode.
 * 3. Full ACID transaction simulation with async mutex serialization queue and snapshot rollback in mock mode.
 * 4. Atomic array batch transactions with deferred query execution and rollback on failure.
 * 5. Unique constraint enforcement (@unique on slug, email, fingerprint) throwing Prisma P2002 error.
 * 6. Relational lifecycle hooks (onDelete: SetNull / Cascade).
 * 7. Graceful connection handling, logging, and health checking.
 */

// ============================================================================
// 1. Entity Interfaces & Types (Prisma Model Definitions)
// ============================================================================

export type UserRole = "ADMIN" | "MEMBER" | "VIEWER";
export type KeyAlgorithm = "ed25519" | "rsa";
export type KeyStatus = "active" | "revoked";
export type TransactionType = "FREE_GRANT" | "USAGE_DEDUCTION" | "TOP_UP" | "REFUND" | "ADMIN_ADJUSTMENT";
export type AuditStatus = "success" | "auth_error" | "tool_error" | "rate_limited";

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
  users?: UserRecord[];
  agentKeys?: AgentKeyRecord[];
}

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  organization?: OrganizationRecord | null;
  agentKeys?: AgentKeyRecord[];
}

export interface AgentKeyRecord {
  id: string;
  fingerprint: string;
  agentName: string;
  publicKeyPem: string;
  algorithm: KeyAlgorithm;
  creditsBalance: number;
  scopes: string[];
  totalInvocations: number;
  status: KeyStatus;
  organizationId: string | null;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
  organization?: OrganizationRecord | null;
  user?: UserRecord | null;
  creditTransactions?: CreditTransactionRecord[];
  auditLogs?: AuditLogRecord[];
}

export interface CreditTransactionRecord {
  id: string;
  agentKeyId: string;
  amount: number;
  balanceAfter: number;
  type: TransactionType;
  referenceId: string | null;
  createdAt: Date;
  agentKey?: AgentKeyRecord;
}

export interface AuditLogRecord {
  id: string;
  agentKeyId: string | null;
  fingerprint: string;
  agentName: string;
  method: string;
  toolName: string | null;
  status: AuditStatus;
  latencyMs: number;
  costCredits: number;
  creditsRemaining: number;
  timestampDriftMs: number;
  nonce: string;
  ipAddress: string | null;
  errorMessage: string | null;
  signatureValid: boolean;
  createdAt: Date;
  agentKey?: AgentKeyRecord | null;
}

// ============================================================================
// 2. Query Options & Filter Helpers
// ============================================================================

export interface FindArgs<T> {
  where?: Partial<Record<keyof T, any>> & Record<string, any>;
  orderBy?: Partial<Record<keyof T, "asc" | "desc">> | Array<Partial<Record<keyof T, "asc" | "desc">>>;
  take?: number;
  skip?: number;
  include?: Record<string, boolean>;
  select?: Record<string, boolean>;
}

export interface CreateArgs<T> {
  data: Partial<T> & Record<string, any>;
  include?: Record<string, boolean>;
  select?: Record<string, boolean>;
}

export interface CreateManyArgs<T> {
  data: Array<Partial<T> & Record<string, any>>;
}

export interface UpdateArgs<T> {
  where: Partial<Record<keyof T, any>> & Record<string, any>;
  data: Partial<Record<keyof T, any>> & Record<string, any>;
  include?: Record<string, boolean>;
  select?: Record<string, boolean>;
}

export interface UpdateManyArgs<T> {
  where?: Partial<Record<keyof T, any>> & Record<string, any>;
  data: Partial<Record<keyof T, any>> & Record<string, any>;
}

export interface UpsertArgs<T> {
  where: Partial<Record<keyof T, any>> & Record<string, any>;
  create: Partial<T> & Record<string, any>;
  update: Partial<Record<keyof T, any>> & Record<string, any>;
  include?: Record<string, boolean>;
  select?: Record<string, boolean>;
}

export interface DeleteArgs<T> {
  where: Partial<Record<keyof T, any>> & Record<string, any>;
}

export interface DeleteManyArgs<T> {
  where?: Partial<Record<keyof T, any>> & Record<string, any>;
}

export interface DeferredOp<T = any> {
  readonly _isDeferredOp: true;
  execute: (client: InMemoryPrismaClient) => Promise<T>;
}

export type PrismaPromise<T> = Promise<T> & DeferredOp<T>;

export interface ModelDelegate<T extends { id: string }> {
  findUnique(args: { where: Partial<Record<keyof T, any>> & Record<string, any>; include?: Record<string, boolean>; select?: Record<string, boolean> }): PrismaPromise<T | null>;
  findUniqueOrThrow(args: { where: Partial<Record<keyof T, any>> & Record<string, any>; include?: Record<string, boolean>; select?: Record<string, boolean> }): PrismaPromise<T>;
  findFirst(args?: FindArgs<T>): PrismaPromise<T | null>;
  findMany(args?: FindArgs<T>): PrismaPromise<T[]>;
  create(args: CreateArgs<T>): PrismaPromise<T>;
  createMany(args: CreateManyArgs<T>): PrismaPromise<{ count: number }>;
  update(args: UpdateArgs<T>): PrismaPromise<T>;
  updateMany(args: UpdateManyArgs<T>): PrismaPromise<{ count: number }>;
  upsert(args: UpsertArgs<T>): PrismaPromise<T>;
  delete(args: DeleteArgs<T>): PrismaPromise<T>;
  deleteMany(args?: DeleteManyArgs<T>): PrismaPromise<{ count: number }>;
  count(args?: { where?: Partial<Record<keyof T, any>> & Record<string, any> }): PrismaPromise<number>;
}

export interface PrismaClientLike {
  organization: ModelDelegate<OrganizationRecord>;
  user: ModelDelegate<UserRecord>;
  agentKey: ModelDelegate<AgentKeyRecord>;
  creditTransaction: ModelDelegate<CreditTransactionRecord>;
  auditLog: ModelDelegate<AuditLogRecord>;
  $transaction<R>(fn: (tx: PrismaClientLike) => Promise<R>): Promise<R>;
  $transaction<R>(promises: Array<Promise<R>> | Array<PrismaPromise<R>>): Promise<R[]>;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $queryRaw<T = any>(query: any, ...values: any[]): Promise<T>;
  $executeRaw(query: any, ...values: any[]): Promise<number>;
}

export class PrismaClientKnownRequestError extends Error {
  public code: string;
  public meta?: Record<string, any>;
  public clientVersion: string;

  constructor(
    message: string,
    { code, clientVersion = "6.4.1", meta }: { code: string; clientVersion?: string; meta?: Record<string, any> }
  ) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
    this.code = code;
    this.clientVersion = clientVersion;
    this.meta = meta;
  }
}

function throwUniqueConstraintError(field: string, modelName?: string): never {
  throw new PrismaClientKnownRequestError(
    `Unique constraint failed on the fields: (\`${field}\`)`,
    {
      code: "P2002",
      clientVersion: "6.4.1",
      meta: { target: [field], modelName }
    }
  );
}

// ============================================================================
// 3. In-Memory Mock Implementation Engine
// ============================================================================

function matchesFilter(item: any, where: Record<string, any>): boolean {
  if (!where || Object.keys(where).length === 0) return true;

  for (const [key, filterVal] of Object.entries(where)) {
    if (key === "OR" && Array.isArray(filterVal)) {
      if (!filterVal.some(subWhere => matchesFilter(item, subWhere))) return false;
      continue;
    }
    if (key === "AND" && Array.isArray(filterVal)) {
      if (!filterVal.every(subWhere => matchesFilter(item, subWhere))) return false;
      continue;
    }
    if (key === "NOT") {
      if (Array.isArray(filterVal)) {
        if (filterVal.some(subWhere => matchesFilter(item, subWhere))) return false;
      } else if (typeof filterVal === "object" && filterVal !== null) {
        if (matchesFilter(item, filterVal)) return false;
      }
      continue;
    }

    const itemVal = item[key];

    if (filterVal !== null && typeof filterVal === "object" && !(filterVal instanceof Date)) {
      if ("equals" in filterVal && itemVal !== filterVal.equals) return false;
      if ("not" in filterVal && itemVal === filterVal.not) return false;
      if ("gte" in filterVal) {
        const valToCompare = itemVal instanceof Date ? itemVal.getTime() : itemVal;
        const targetVal = filterVal.gte instanceof Date ? filterVal.gte.getTime() : filterVal.gte;
        if (typeof valToCompare !== typeof targetVal || valToCompare < targetVal) return false;
      }
      if ("gt" in filterVal) {
        const valToCompare = itemVal instanceof Date ? itemVal.getTime() : itemVal;
        const targetVal = filterVal.gt instanceof Date ? filterVal.gt.getTime() : filterVal.gt;
        if (typeof valToCompare !== typeof targetVal || valToCompare <= targetVal) return false;
      }
      if ("lte" in filterVal) {
        const valToCompare = itemVal instanceof Date ? itemVal.getTime() : itemVal;
        const targetVal = filterVal.lte instanceof Date ? filterVal.lte.getTime() : filterVal.lte;
        if (typeof valToCompare !== typeof targetVal || valToCompare > targetVal) return false;
      }
      if ("lt" in filterVal) {
        const valToCompare = itemVal instanceof Date ? itemVal.getTime() : itemVal;
        const targetVal = filterVal.lt instanceof Date ? filterVal.lt.getTime() : filterVal.lt;
        if (typeof valToCompare !== typeof targetVal || valToCompare >= targetVal) return false;
      }
      if ("in" in filterVal && Array.isArray(filterVal.in) && !filterVal.in.includes(itemVal)) return false;
      if ("notIn" in filterVal && Array.isArray(filterVal.notIn) && filterVal.notIn.includes(itemVal)) return false;
      if ("contains" in filterVal && (typeof itemVal !== "string" || !itemVal.includes(filterVal.contains))) return false;
      if ("startsWith" in filterVal && (typeof itemVal !== "string" || !itemVal.startsWith(filterVal.startsWith))) return false;
      if ("endsWith" in filterVal && (typeof itemVal !== "string" || !itemVal.endsWith(filterVal.endsWith))) return false;
    } else {
      if (itemVal instanceof Date && filterVal instanceof Date) {
        if (itemVal.getTime() !== filterVal.getTime()) return false;
      } else if (itemVal !== filterVal) {
        return false;
      }
    }
  }

  return true;
}

function applyDataMutations(target: any, data: Record<string, any>): any {
  const result = { ...target };

  for (const [key, val] of Object.entries(data)) {
    if (val !== null && typeof val === "object" && !(val instanceof Date) && !Array.isArray(val)) {
      if ("increment" in val && typeof val.increment === "number") {
        result[key] = (typeof result[key] === "number" ? result[key] : 0) + val.increment;
      } else if ("decrement" in val && typeof val.decrement === "number") {
        result[key] = (typeof result[key] === "number" ? result[key] : 0) - val.decrement;
      } else if ("set" in val) {
        result[key] = val.set;
      } else {
        result[key] = val;
      }
    } else {
      result[key] = val;
    }
  }

  if ("updatedAt" in target || "updatedAt" in result) {
    result.updatedAt = new Date();
  }

  return result;
}

export class InMemoryStore {
  public organizations = new Map<string, OrganizationRecord>();
  public users = new Map<string, UserRecord>();
  public agentKeys = new Map<string, AgentKeyRecord>();
  public creditTransactions = new Map<string, CreditTransactionRecord>();
  public auditLogs = new Map<string, AuditLogRecord>();
  public txMutex: Promise<void> = Promise.resolve();

  public clone(): InMemoryStore {
    const copy = new InMemoryStore();
    for (const [k, v] of this.organizations) copy.organizations.set(k, { ...v });
    for (const [k, v] of this.users) copy.users.set(k, { ...v });
    for (const [k, v] of this.agentKeys) copy.agentKeys.set(k, { ...v, scopes: Array.isArray(v.scopes) ? [...v.scopes] : v.scopes });
    for (const [k, v] of this.creditTransactions) copy.creditTransactions.set(k, { ...v });
    for (const [k, v] of this.auditLogs) copy.auditLogs.set(k, { ...v });
    copy.txMutex = Promise.resolve();
    return copy;
  }

  public restoreFrom(source: InMemoryStore) {
    this.organizations = new Map(source.organizations);
    this.users = new Map(source.users);
    this.agentKeys = new Map(source.agentKeys);
    this.creditTransactions = new Map(source.creditTransactions);
    this.auditLogs = new Map(source.auditLogs);
  }

  public clear() {
    this.organizations.clear();
    this.users.clear();
    this.agentKeys.clear();
    this.creditTransactions.clear();
    this.auditLogs.clear();
    this.txMutex = Promise.resolve();
  }
}

function resolveIncludes<T extends { id: string }>(
  item: T,
  include: Record<string, boolean> | undefined,
  store: InMemoryStore
): T {
  if (!include || Object.keys(include).length === 0) return { ...item };
  const enriched: any = { ...item };

  // Organization relations
  if ("slug" in item) {
    if (include.users) {
      enriched.users = Array.from(store.users.values()).filter(u => u.organizationId === item.id);
    }
    if (include.agentKeys) {
      enriched.agentKeys = Array.from(store.agentKeys.values()).filter(a => a.organizationId === item.id);
    }
  }

  // User relations
  if ("email" in item) {
    const u = item as unknown as UserRecord;
    if (include.organization) {
      enriched.organization = u.organizationId ? (store.organizations.get(u.organizationId) || null) : null;
    }
    if (include.agentKeys) {
      enriched.agentKeys = Array.from(store.agentKeys.values()).filter(a => a.userId === item.id);
    }
  }

  // AgentKey relations
  if ("fingerprint" in item) {
    const a = item as unknown as AgentKeyRecord;
    if (include.organization) {
      enriched.organization = a.organizationId ? (store.organizations.get(a.organizationId) || null) : null;
    }
    if (include.user) {
      enriched.user = a.userId ? (store.users.get(a.userId) || null) : null;
    }
    if (include.creditTransactions) {
      enriched.creditTransactions = Array.from(store.creditTransactions.values()).filter(c => c.agentKeyId === item.id);
    }
    if (include.auditLogs) {
      enriched.auditLogs = Array.from(store.auditLogs.values()).filter(l => l.agentKeyId === item.id || l.fingerprint === a.fingerprint);
    }
  }

  // CreditTransaction relations
  if ("balanceAfter" in item) {
    const c = item as unknown as CreditTransactionRecord;
    if (include.agentKey) {
      enriched.agentKey = c.agentKeyId ? (store.agentKeys.get(c.agentKeyId) || null) : null;
    }
  }

  // AuditLog relations
  if ("latencyMs" in item) {
    const l = item as unknown as AuditLogRecord;
    if (include.agentKey) {
      enriched.agentKey = l.agentKeyId ? (store.agentKeys.get(l.agentKeyId) || null) : null;
    }
  }

  return enriched;
}

function generateId(prefix = "cm"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "").substring(0, 20)}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

function checkUniqueConstraint(
  modelName: string,
  map: Map<string, any>,
  data: Record<string, any>,
  excludeId?: string
) {
  const uniqueFields: Record<string, string[]> = {
    Organization: ["slug"],
    User: ["email"],
    AgentKey: ["fingerprint"]
  };

  const fieldsToCheck = uniqueFields[modelName];
  if (!fieldsToCheck) return;

  for (const field of fieldsToCheck) {
    let val = data[field];
    if (val !== null && typeof val === "object" && !(val instanceof Date) && !Array.isArray(val) && "set" in val) {
      val = val.set;
    }
    if (val !== undefined && val !== null) {
      for (const [id, item] of map.entries()) {
        if (excludeId && id === excludeId) continue;
        if (item[field] === val) {
          throwUniqueConstraintError(field, modelName);
        }
      }
    }
  }
}

function handleRelationalDeletes(modelName: string, id: string, store: InMemoryStore) {
  if (modelName === "Organization") {
    for (const [userId, user] of store.users.entries()) {
      if (user.organizationId === id) {
        store.users.set(userId, { ...user, organizationId: null, updatedAt: new Date() });
      }
    }
    for (const [keyId, key] of store.agentKeys.entries()) {
      if (key.organizationId === id) {
        store.agentKeys.set(keyId, { ...key, organizationId: null, updatedAt: new Date() });
      }
    }
  } else if (modelName === "User") {
    for (const [keyId, key] of store.agentKeys.entries()) {
      if (key.userId === id) {
        store.agentKeys.set(keyId, { ...key, userId: null, updatedAt: new Date() });
      }
    }
  } else if (modelName === "AgentKey") {
    for (const [txId, tx] of store.creditTransactions.entries()) {
      if (tx.agentKeyId === id) {
        store.creditTransactions.delete(txId);
      }
    }
    for (const [logId, log] of store.auditLogs.entries()) {
      if (log.agentKeyId === id) {
        store.auditLogs.set(logId, { ...log, agentKeyId: null });
      }
    }
  }
}

function createDeferredPromise<T>(
  executor: (client: InMemoryPrismaClient) => Promise<T>,
  getClient: () => InMemoryPrismaClient
): PrismaPromise<T> {
  let executedPromise: Promise<T> | null = null;

  function getPromise(): Promise<T> {
    if (!executedPromise) {
      executedPromise = executor(getClient());
    }
    return executedPromise;
  }

  const deferred: any = {
    _isDeferredOp: true,
    execute: (client: InMemoryPrismaClient) => executor(client),
    then(onFulfilled?: any, onRejected?: any) {
      return getPromise().then(onFulfilled, onRejected);
    },
    catch(onRejected?: any) {
      return getPromise().catch(onRejected);
    },
    finally(onFinally?: any) {
      return getPromise().finally(onFinally);
    },
    [Symbol.toStringTag]: "PrismaPromise"
  };

  return deferred as PrismaPromise<T>;
}

function createModelDelegate<T extends { id: string }>(
  modelName: string,
  getMap: (store: InMemoryStore) => Map<string, T>,
  defaultsFactory: () => Partial<T>,
  getClient: () => InMemoryPrismaClient
): ModelDelegate<T> {
  return {
    findUnique(args: { where: Partial<Record<keyof T, any>> & Record<string, any>; include?: Record<string, boolean>; select?: Record<string, boolean> }): PrismaPromise<T | null> {
      return createDeferredPromise(async (client) => {
        const map = getMap(client.store);
        for (const item of map.values()) {
          if (matchesFilter(item, args.where)) {
            return resolveIncludes(item, args.include, client.store);
          }
        }
        return null;
      }, getClient);
    },

    findUniqueOrThrow(args: { where: Partial<Record<keyof T, any>> & Record<string, any>; include?: Record<string, boolean>; select?: Record<string, boolean> }): PrismaPromise<T> {
      return createDeferredPromise(async (client) => {
        const map = getMap(client.store);
        for (const item of map.values()) {
          if (matchesFilter(item, args.where)) {
            return resolveIncludes(item, args.include, client.store);
          }
        }
        throw new Error(`Record not found in database for query: ${JSON.stringify(args.where)}`);
      }, getClient);
    },

    findFirst(args: FindArgs<T> = {}): PrismaPromise<T | null> {
      return createDeferredPromise(async (client) => {
        const delegate = (client as any)[modelName.charAt(0).toLowerCase() + modelName.slice(1)] as ModelDelegate<T>;
        const list = await delegate.findMany(args);
        return list.length > 0 ? list[0] : null;
      }, getClient);
    },

    findMany(args: FindArgs<T> = {}): PrismaPromise<T[]> {
      return createDeferredPromise(async (client) => {
        const map = getMap(client.store);
        let results: T[] = [];

        for (const item of map.values()) {
          if (!args.where || matchesFilter(item, args.where)) {
            results.push(resolveIncludes(item, args.include, client.store));
          }
        }

        if (args.orderBy) {
          const orderSpecs = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
          results.sort((a: any, b: any) => {
            for (const spec of orderSpecs) {
              for (const [field, dir] of Object.entries(spec)) {
                const valA = a[field];
                const valB = b[field];
                const compA = valA instanceof Date ? valA.getTime() : valA;
                const compB = valB instanceof Date ? valB.getTime() : valB;
                if (compA < compB) return dir === "asc" ? -1 : 1;
                if (compA > compB) return dir === "asc" ? 1 : -1;
              }
            }
            return 0;
          });
        }

        if (args.skip) {
          results = results.slice(args.skip);
        }
        if (args.take !== undefined) {
          results = results.slice(0, args.take);
        }

        return results;
      }, getClient);
    },

    create(args: CreateArgs<T>): PrismaPromise<T> {
      return createDeferredPromise(async (client) => {
        const map = getMap(client.store);
        const id = args.data.id || generateId();

        if (args.data.id && map.has(args.data.id)) {
          throwUniqueConstraintError("id", modelName);
        }

        checkUniqueConstraint(modelName, map, args.data);

        const now = new Date();
        const item = {
          ...defaultsFactory(),
          createdAt: now,
          updatedAt: now,
          ...args.data,
          id
        } as unknown as T;

        map.set(id, item);
        return resolveIncludes(item, args.include, client.store);
      }, getClient);
    },

    createMany(args: CreateManyArgs<T>): PrismaPromise<{ count: number }> {
      return createDeferredPromise(async (client) => {
        let count = 0;
        const delegate = (client as any)[modelName.charAt(0).toLowerCase() + modelName.slice(1)] as ModelDelegate<T>;
        for (const data of args.data) {
          await delegate.create({ data });
          count++;
        }
        return { count };
      }, getClient);
    },

    update(args: UpdateArgs<T>): PrismaPromise<T> {
      return createDeferredPromise(async (client) => {
        const map = getMap(client.store);
        let target: T | null = null;
        let targetId: string | null = null;

        for (const [id, item] of map.entries()) {
          if (matchesFilter(item, args.where)) {
            target = item;
            targetId = id;
            break;
          }
        }

        if (!target || !targetId) {
          throw new Error(`Record to update not found for query: ${JSON.stringify(args.where)}`);
        }

        checkUniqueConstraint(modelName, map, args.data, targetId);

        const updated = applyDataMutations(target, args.data) as unknown as T;
        map.set(targetId, updated);
        return resolveIncludes(updated, args.include, client.store);
      }, getClient);
    },

    updateMany(args: UpdateManyArgs<T>): PrismaPromise<{ count: number }> {
      return createDeferredPromise(async (client) => {
        const map = getMap(client.store);
        let count = 0;
        const matchingEntries: [string, T][] = [];

        for (const [id, item] of map.entries()) {
          if (!args.where || matchesFilter(item, args.where)) {
            matchingEntries.push([id, item]);
          }
        }

        if (matchingEntries.length > 1) {
          checkUniqueConstraint(modelName, map, args.data);
        } else if (matchingEntries.length === 1) {
          checkUniqueConstraint(modelName, map, args.data, matchingEntries[0][0]);
        }

        for (const [id, item] of matchingEntries) {
          const updated = applyDataMutations(item, args.data) as unknown as T;
          map.set(id, updated);
          count++;
        }

        return { count };
      }, getClient);
    },

    upsert(args: UpsertArgs<T>): PrismaPromise<T> {
      return createDeferredPromise(async (client) => {
        const delegate = (client as any)[modelName.charAt(0).toLowerCase() + modelName.slice(1)] as ModelDelegate<T>;
        const existing = await delegate.findUnique({ where: args.where });
        if (existing) {
          return delegate.update({ where: args.where, data: args.update, include: args.include, select: args.select });
        } else {
          return delegate.create({ data: { ...args.where, ...args.create }, include: args.include, select: args.select });
        }
      }, getClient);
    },

    delete(args: DeleteArgs<T>): PrismaPromise<T> {
      return createDeferredPromise(async (client) => {
        const map = getMap(client.store);
        for (const [id, item] of map.entries()) {
          if (matchesFilter(item, args.where)) {
            map.delete(id);
            handleRelationalDeletes(modelName, id, client.store);
            return { ...item };
          }
        }
        throw new Error(`Record to delete not found for query: ${JSON.stringify(args.where)}`);
      }, getClient);
    },

    deleteMany(args: DeleteManyArgs<T> = {}): PrismaPromise<{ count: number }> {
      return createDeferredPromise(async (client) => {
        const map = getMap(client.store);
        let count = 0;
        for (const [id, item] of map.entries()) {
          if (!args.where || matchesFilter(item, args.where)) {
            map.delete(id);
            handleRelationalDeletes(modelName, id, client.store);
            count++;
          }
        }
        return { count };
      }, getClient);
    },

    count(args: { where?: any } = {}): PrismaPromise<number> {
      return createDeferredPromise(async (client) => {
        const delegate = (client as any)[modelName.charAt(0).toLowerCase() + modelName.slice(1)] as ModelDelegate<T>;
        const list = await delegate.findMany({ where: args.where });
        return list.length;
      }, getClient);
    }
  };
}

export class InMemoryPrismaClient implements PrismaClientLike {
  public store: InMemoryStore;

  public organization: ModelDelegate<OrganizationRecord>;
  public user: ModelDelegate<UserRecord>;
  public agentKey: ModelDelegate<AgentKeyRecord>;
  public creditTransaction: ModelDelegate<CreditTransactionRecord>;
  public auditLog: ModelDelegate<AuditLogRecord>;

  constructor(store?: InMemoryStore) {
    this.store = store || new InMemoryStore();

    this.organization = createModelDelegate<OrganizationRecord>(
      "Organization",
      (s) => s.organizations,
      () => ({ name: "", slug: "" }),
      () => this
    );

    this.user = createModelDelegate<UserRecord>(
      "User",
      (s) => s.users,
      () => ({ email: "", name: null, role: "MEMBER", organizationId: null }),
      () => this
    );

    this.agentKey = createModelDelegate<AgentKeyRecord>(
      "AgentKey",
      (s) => s.agentKeys,
      () => ({
        fingerprint: "",
        agentName: "Agent",
        publicKeyPem: "",
        algorithm: "ed25519",
        creditsBalance: 100,
        scopes: ["all-tools"],
        totalInvocations: 0,
        status: "active",
        organizationId: null,
        userId: null,
        lastUsedAt: null
      }),
      () => this
    );

    this.creditTransaction = createModelDelegate<CreditTransactionRecord>(
      "CreditTransaction",
      (s) => s.creditTransactions,
      () => ({ agentKeyId: "", amount: 0, balanceAfter: 0, type: "USAGE_DEDUCTION", referenceId: null }),
      () => this
    );

    this.auditLog = createModelDelegate<AuditLogRecord>(
      "AuditLog",
      (s) => s.auditLogs,
      () => ({
        agentKeyId: null,
        fingerprint: "",
        agentName: "",
        method: "",
        toolName: null,
        status: "success",
        latencyMs: 0,
        costCredits: 0,
        creditsRemaining: 0,
        timestampDriftMs: 0,
        nonce: "",
        ipAddress: null,
        errorMessage: null,
        signatureValid: true
      }),
      () => this
    );
  }

  public async $transaction<R>(arg: ((tx: PrismaClientLike) => Promise<R>) | Array<Promise<R>> | Array<PrismaPromise<R>>): Promise<any> {
    let releaseLock: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const previousLock = this.store.txMutex;
    this.store.txMutex = currentLock;

    try {
      // Serialized isolation: wait for preceding transactions to complete
      await previousLock;

      // Handle Array Batch Transaction: $transaction([op1, op2, ...])
      if (Array.isArray(arg)) {
        const snapshot = this.store.clone();
        const txClient = new InMemoryPrismaClient(snapshot);
        const results = [];

        try {
          for (const item of arg) {
            if (item && typeof item === "object" && "_isDeferredOp" in item && typeof (item as any).execute === "function") {
              const res = await (item as any).execute(txClient);
              results.push(res);
            } else {
              results.push(await item);
            }
          }
          this.store.restoreFrom(snapshot);
          return results;
        } catch (err) {
          // Rollback on any failure in batch
          throw err;
        }
      }

      // Handle Interactive Transaction: $transaction(async (tx) => { ... })
      if (typeof arg === "function") {
        const snapshot = this.store.clone();
        const txClient = new InMemoryPrismaClient(snapshot);

        try {
          const result = await arg(txClient);
          // Commit changes to main store upon successful callback completion
          this.store.restoreFrom(snapshot);
          return result;
        } catch (err) {
          // Rollback state on error / exception
          throw err;
        }
      }

      throw new Error("Invalid argument passed to prisma.$transaction");
    } finally {
      releaseLock!();
    }
  }

  public async $connect(): Promise<void> {}
  public async $disconnect(): Promise<void> {}
  public async $queryRaw<T = any>(): Promise<T> { return [] as any; }
  public async $executeRaw(): Promise<number> { return 1; }

  public reset(): void {
    this.store.clear();
  }
}

// ============================================================================
// 4. Singleton Instantiation & Global Caching Engine
// ============================================================================

declare global {
  // eslint-disable-next-line no-var
  var __pixelmesh_prisma__: PrismaClientLike | undefined;
  // eslint-disable-next-line no-var
  var __pixelmesh_is_mock_db__: boolean | undefined;
}

function determineIfMockDb(): boolean {
  if (process.env.USE_IN_MEMORY_DB === "true" || process.env.MOCK_DB === "true") {
    return true;
  }
  if (process.env.NODE_ENV === "test" && process.env.TEST_USE_REAL_DB !== "true") {
    return true;
  }
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("mock:") || url.startsWith("memory:") || url.startsWith("test:")) {
    return true;
  }
  return false;
}

function createPrismaInstance(): { client: PrismaClientLike; isMock: boolean } {
  const useMock = determineIfMockDb();

  if (useMock) {
    return { client: new InMemoryPrismaClient(), isMock: true };
  }

  try {
    // Dynamic import to prevent crash when @prisma/client is not yet generated or available
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require("@prisma/client");
    const realClient = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    });
    return { client: realClient as unknown as PrismaClientLike, isMock: false };
  } catch (err) {
    console.warn("[Prisma] @prisma/client not available or initialization failed. Falling back to InMemoryPrismaClient.", err);
    return { client: new InMemoryPrismaClient(), isMock: true };
  }
}

function getSingletonClient(): PrismaClientLike {
  if (globalThis.__pixelmesh_prisma__) {
    return globalThis.__pixelmesh_prisma__;
  }

  const { client, isMock } = createPrismaInstance();
  globalThis.__pixelmesh_prisma__ = client;
  globalThis.__pixelmesh_is_mock_db__ = isMock;

  return client;
}

export const prisma: PrismaClientLike = getSingletonClient();

export function isMockPrisma(): boolean {
  return globalThis.__pixelmesh_is_mock_db__ ?? determineIfMockDb();
}

export function resetMockDb(): void {
  if (prisma instanceof InMemoryPrismaClient) {
    prisma.reset();
  } else if ((prisma as any).store?.clear) {
    (prisma as any).store.clear();
  }
}
