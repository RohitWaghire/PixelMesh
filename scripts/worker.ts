import { queueWorker } from "../lib/queue/worker";

async function main(): Promise<void> {
  await queueWorker.start();
  console.log("[PixelMesh Worker] BullMQ worker started");
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[PixelMesh Worker] Received ${signal}; shutting down`);
  await queueWorker.stop();
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

main().catch((error) => {
  console.error("[PixelMesh Worker] Failed to start", error);
  process.exit(1);
});
