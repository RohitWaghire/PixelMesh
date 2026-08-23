/**
 * PixelMesh Server Startup Preflight (Next.js Instrumentation Hook)
 * 
 * Runs on server boot to ensure production deployments fail closed
 * if persistent database, Redis, or storage backends are unconfigured.
 */

export async function register() {
  // Only execute validation in Node.js server runtime environment
  if (process.env.NEXT_RUNTIME === "nodejs" || !process.env.NEXT_RUNTIME) {
    validateProductionEnvironment();
  }
}

export function validateProductionEnvironment(exitOnFailure: boolean = true): { valid: boolean; missing: string[] } {
  const isProduction = process.env.NODE_ENV === "production";
  const allowMock = process.env.ALLOW_MOCK_IN_PRODUCTION === "true";
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build" || process.env.BUILD_PHASE === "true";

  if (!isProduction || allowMock || isBuildPhase) {
    return { valid: true, missing: [] };
  }

  const missing: string[] = [];

  // 1. Database Validation
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.startsWith("mock:") || dbUrl.startsWith("memory:") || dbUrl.startsWith("test:")) {
    missing.push("DATABASE_URL (PostgreSQL connection string required in production)");
  }

  // 2. Redis Validation
  const redisUrl = process.env.REDIS_URL;
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const hasValidRedis = (redisUrl && !redisUrl.startsWith("mock:") && !redisUrl.startsWith("memory:")) ||
    (upstashUrl && upstashToken && !upstashUrl.startsWith("mock:") && !upstashUrl.startsWith("memory:"));

  if (!hasValidRedis) {
    missing.push("Redis Backend (REDIS_URL or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN required in production)");
  }

  // 3. Storage Validation
  const hasS3 = Boolean(process.env.S3_BUCKET && (process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID));
  const hasLocalStorage = Boolean(process.env.LOCAL_STORAGE_DIR);
  const explicitDriver = process.env.STORAGE_DRIVER?.toLowerCase();

  if (explicitDriver === "memory" || (!hasS3 && !hasLocalStorage)) {
    missing.push("Persistent Storage (S3_BUCKET with credentials or LOCAL_STORAGE_DIR required in production)");
  }

  if (missing.length > 0) {
    console.error("================================================================================");
    console.error("⛔ [PixelMesh FATAL] Production Environment Preflight Failed");
    console.error("PixelMesh refuses to boot with ephemeral mock backends in NODE_ENV=production.");
    console.error("Missing or unconfigured production subsystems:");
    missing.forEach((item, idx) => console.error(`  ${idx + 1}. ${item}`));
    console.error("\nTo override for testing, set ALLOW_MOCK_IN_PRODUCTION=true.");
    console.error("================================================================================");

    if (exitOnFailure && typeof process !== "undefined" && typeof process.exit === "function") {
      process.exit(1);
    }
    return { valid: false, missing };
  }

  return { valid: true, missing: [] };
}
