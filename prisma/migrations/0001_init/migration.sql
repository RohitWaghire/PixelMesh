-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "KeyAlgorithm" AS ENUM ('ed25519', 'rsa');

-- CreateEnum
CREATE TYPE "KeyStatus" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('FREE_GRANT', 'USAGE_DEDUCTION', 'TOP_UP', 'REFUND', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('success', 'auth_error', 'tool_error', 'rate_limited');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_keys" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "publicKeyPem" TEXT NOT NULL,
    "algorithm" "KeyAlgorithm" NOT NULL DEFAULT 'ed25519',
    "creditsBalance" INTEGER NOT NULL DEFAULT 100,
    "scopes" TEXT[] DEFAULT ARRAY['all-tools']::TEXT[],
    "totalInvocations" INTEGER NOT NULL DEFAULT 0,
    "status" "KeyStatus" NOT NULL DEFAULT 'active',
    "organizationId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "agent_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" TEXT NOT NULL,
    "agentKeyId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" "TransactionType" NOT NULL,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "agentKeyId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "toolName" TEXT,
    "status" "AuditStatus" NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "costCredits" INTEGER NOT NULL DEFAULT 0,
    "creditsRemaining" INTEGER NOT NULL DEFAULT 0,
    "timestampDriftMs" INTEGER NOT NULL DEFAULT 0,
    "nonce" TEXT NOT NULL,
    "ipAddress" TEXT,
    "errorMessage" TEXT,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");
CREATE UNIQUE INDEX "agent_keys_fingerprint_key" ON "agent_keys"("fingerprint");
CREATE INDEX "agent_keys_organizationId_idx" ON "agent_keys"("organizationId");
CREATE INDEX "agent_keys_userId_idx" ON "agent_keys"("userId");
CREATE INDEX "agent_keys_status_idx" ON "agent_keys"("status");
CREATE INDEX "credit_transactions_agentKeyId_idx" ON "credit_transactions"("agentKeyId");
CREATE INDEX "credit_transactions_createdAt_idx" ON "credit_transactions"("createdAt");
CREATE INDEX "credit_transactions_type_idx" ON "credit_transactions"("type");
CREATE INDEX "credit_transactions_referenceId_idx" ON "credit_transactions"("referenceId");
CREATE INDEX "audit_logs_fingerprint_idx" ON "audit_logs"("fingerprint");
CREATE INDEX "audit_logs_agentKeyId_idx" ON "audit_logs"("agentKeyId");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX "audit_logs_status_idx" ON "audit_logs"("status");
CREATE INDEX "audit_logs_toolName_idx" ON "audit_logs"("toolName");
CREATE INDEX "audit_logs_nonce_idx" ON "audit_logs"("nonce");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_agentKeyId_fkey" FOREIGN KEY ("agentKeyId") REFERENCES "agent_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_agentKeyId_fkey" FOREIGN KEY ("agentKeyId") REFERENCES "agent_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
