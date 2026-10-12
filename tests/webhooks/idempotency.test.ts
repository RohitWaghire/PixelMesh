import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { webhookIdempotency } from "@/lib/webhooks/idempotency";
import { resetMockRedis } from "@/lib/redis/client";

beforeEach(async () => {
  resetMockRedis();
  await webhookIdempotency.clear();
});

test("idempotency: records newly observed delivery ID successfully", async () => {
  const deliveryId = "uuid-delivery-001";
  const recorded = await webhookIdempotency.checkAndRecordDelivery(deliveryId, "pull_request", 60);

  assert.equal(recorded, true, "First observation of delivery ID must return true");
  const isProcessed = await webhookIdempotency.isDeliveryProcessed(deliveryId);
  assert.equal(isProcessed, true, "Delivery ID must now be marked as processed");
});

test("idempotency: rejects duplicate delivery ID within TTL window", async () => {
  const deliveryId = "uuid-delivery-duplicate";
  const first = await webhookIdempotency.checkAndRecordDelivery(deliveryId, "push", 60);
  assert.equal(first, true);

  const duplicate = await webhookIdempotency.checkAndRecordDelivery(deliveryId, "push", 60);
  assert.equal(duplicate, false, "Second observation of identical delivery ID must return false");
});

test("idempotency: handles empty delivery ID gracefully", async () => {
  const recorded = await webhookIdempotency.checkAndRecordDelivery("", "ping");
  assert.equal(recorded, false);

  const processed = await webhookIdempotency.isDeliveryProcessed("");
  assert.equal(processed, false);
});
