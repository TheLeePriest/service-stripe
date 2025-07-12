import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleCancellation } from "./handleCancellation";
import type { SubscriptionUpdatedEvent } from "../../SubscriptionUpdated.types";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const mockEvent = {
  id: "sub_123",
  cancel_at: 1234567890,
  cancel_at_period_end: true,
  status: "active",
  customer: "cus_123",
  createdAt: 1234567890,

  items: {
    data: [
      {
        id: "item_1",
        price: {
          id: "price_123",
          product: "prod_123",
        },
        quantity: 1,
        current_period_end: 1234567890,
        current_period_start: 1234567890,
        metadata: {} as Record<string, unknown>,
      },
    ],
  },
} satisfies SubscriptionUpdatedEvent;

const eventBusName = "test-event-bus";
const mockIdempotencyTableName = "test-idempotency-table";

describe("handleCancellation", () => {
  const sendMock = vi.fn();
  const mockDynamoDBSend = vi.fn();
  const mockEventBridgeClient = {
    send: sendMock,
  };
  const dynamoDBClientMock = { send: mockDynamoDBSend } as unknown as DynamoDBClient;

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    logUsageEvent: vi.fn(),
    logStripeEvent: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("sends event for LicenseCancelled", async () => {
    sendMock.mockResolvedValueOnce({});
    // Mock DynamoDB responses for idempotency
    mockDynamoDBSend.mockResolvedValueOnce({}); // PutItem - store new item
    vi.setSystemTime(1134567890 * 1000);
    await handleCancellation({
      subscription: mockEvent,
      eventBridgeClient: mockEventBridgeClient,
      eventBusName,
      dynamoDBClient: dynamoDBClientMock,
      idempotencyTableName: mockIdempotencyTableName,
      logger: mockLogger,
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith("Sent SubscriptionCancelled event", {
      subscriptionId: "sub_123",
    });
  });

  it("does nothing if all items are in the past", async () => {
    const subscription = {
      id: "sub_123",
      cancel_at: 1234567890,
      cancel_at_period_end: false,
      status: "active",
      customer: "cus_123",
      createdAt: 1234567890,
      items: {
        data: [
          {
            id: "item_1",
            price: {
              id: "price_123",
              product: "prod_123", // ✅ must be a string
            },
            quantity: 1,
            current_period_end: 1234567890,
            current_period_start: 1234567890,
            metadata: {} as Record<string, unknown>,
          },
        ],
      },
    } satisfies SubscriptionUpdatedEvent;
    // Set system time to well after current_period_end
    vi.setSystemTime((1234567890 + 100000) * 1000);

    await handleCancellation({
      subscription,
      eventBridgeClient: mockEventBridgeClient,
      dynamoDBClient: dynamoDBClientMock,
      idempotencyTableName: mockIdempotencyTableName,
      eventBusName,
      logger: mockLogger,
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith("Skipping subscription cancellation, subscription has already ended", {
      subscriptionId: "sub_123",
    });
  });
});
