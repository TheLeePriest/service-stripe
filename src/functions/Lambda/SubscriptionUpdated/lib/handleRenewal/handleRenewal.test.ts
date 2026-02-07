import { describe, it, expect, vi, beforeEach } from "vitest";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { handleRenewal } from "./handleRenewal";

vi.mock("../../../lib/idempotency", () => ({
  ensureIdempotency: vi.fn(),
  generateEventId: vi.fn(() => "test-event-id"),
}));

import { ensureIdempotency } from "../../../lib/idempotency";
const mockEnsureIdempotency = vi.mocked(ensureIdempotency);

const mockEventBridge = { send: vi.fn() };
const mockDynamoDB = { send: vi.fn() };
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const baseSubscription = {
  id: "sub_123",
  customer: "cus_123",
  cancel_at_period_end: false,
  items: {
    data: [
      {
        id: "si_1",
        quantity: 1,
        current_period_start: 1700000000,
        current_period_end: 1702678400,
        price: {
          id: "price_123",
          product: "prod_123",
          metadata: {},
          recurring: { usage_type: "licensed" },
        },
      },
    ],
  },
};

describe("handleRenewal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: false });
    mockEventBridge.send.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: "e1" }] });
  });

  it("sends SubscriptionRenewed event", async () => {
    await handleRenewal({
      subscription: baseSubscription as any,
      eventBridgeClient: mockEventBridge as any,
      eventBusName: "test-bus",
      stripe: {} as any,
      logger: mockLogger as any,
      dynamoDBClient: mockDynamoDB as any,
      idempotencyTableName: "test-table",
    });

    expect(mockEventBridge.send).toHaveBeenCalledTimes(1);
    const command = mockEventBridge.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutEventsCommand);
    expect(command.input.Entries[0].DetailType).toBe("SubscriptionRenewed");
    const detail = JSON.parse(command.input.Entries[0].Detail);
    expect(detail.stripeSubscriptionId).toBe("sub_123");
    expect(detail.earliestRenewalDate).toBe(1700000000);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].productId).toBe("prod_123");
  });

  it("includes metered metadata for metered items", async () => {
    const meteredSub = {
      ...baseSubscription,
      items: {
        data: [
          {
            ...baseSubscription.items.data[0],
            price: {
              ...baseSubscription.items.data[0].price,
              recurring: { usage_type: "metered" },
            },
          },
        ],
      },
    };

    await handleRenewal({
      subscription: meteredSub as any,
      eventBridgeClient: mockEventBridge as any,
      eventBusName: "test-bus",
      stripe: {} as any,
      logger: mockLogger as any,
      dynamoDBClient: mockDynamoDB as any,
      idempotencyTableName: "test-table",
    });

    const detail = JSON.parse(mockEventBridge.send.mock.calls[0][0].input.Entries[0].Detail);
    expect(detail.items[0].metadata.metered).toBe("true");
  });

  it("skips duplicate renewals via idempotency", async () => {
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: true });

    await handleRenewal({
      subscription: baseSubscription as any,
      eventBridgeClient: mockEventBridge as any,
      eventBusName: "test-bus",
      stripe: {} as any,
      logger: mockLogger as any,
      dynamoDBClient: mockDynamoDB as any,
      idempotencyTableName: "test-table",
    });

    expect(mockEventBridge.send).not.toHaveBeenCalled();
  });

  it("throws when EventBridge send fails", async () => {
    mockEventBridge.send.mockRejectedValue(new Error("EB error"));

    await expect(
      handleRenewal({
        subscription: baseSubscription as any,
        eventBridgeClient: mockEventBridge as any,
        eventBusName: "test-bus",
        stripe: {} as any,
        logger: mockLogger as any,
        dynamoDBClient: mockDynamoDB as any,
        idempotencyTableName: "test-table",
      }),
    ).rejects.toThrow("EB error");
  });
});
