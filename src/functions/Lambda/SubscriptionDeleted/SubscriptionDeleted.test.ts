import { describe, it, expect, vi, beforeEach } from "vitest";
import { subscriptionDeleted } from "./SubscriptionDeleted";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type Stripe from "stripe";

describe("subscriptionDeleted", () => {
  const mockRetrieve = vi.fn();
  const mockEventBridgeSend = vi.fn();
  const mockDynamoDBSend = vi.fn();
  const eventBusName = "test-bus";
  const mockIdempotencyTableName = "test-idempotency-table";
  const mockStripe = {
    customers: {
      retrieve: mockRetrieve,
      update: vi.fn(),
    },
    products: {
      retrieve: vi.fn(),
    },
    subscriptions: { retrieve: vi.fn(), update: vi.fn(), list: vi.fn(), cancel: vi.fn() },
    prices: { list: vi.fn(), retrieve: vi.fn() },
    billing: { meterEvents: { create: vi.fn() } },
    paymentMethods: { attach: vi.fn() },
    refunds: { list: vi.fn() },
    checkout: { sessions: { retrieve: vi.fn() } },
  };
  const mockEventBridgeClient = {
    send: mockEventBridgeSend,
  };
  const dynamoDBClientMock = { send: mockDynamoDBSend } as unknown as DynamoDBClient;

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const dependencies = {
    stripe: mockStripe,
    eventBridgeClient: mockEventBridgeClient,
    eventBusName,
    dynamoDBClient: dynamoDBClientMock,
    idempotencyTableName: mockIdempotencyTableName,
    logger: mockLogger,
  };

  const baseEvent = {
    id: "sub_123",
    status: "canceled",
    ended_at: 1234567890,
    canceled_at: 1234567891,
    customer: "cus_123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send event to EventBridge when subscription is canceled", async () => {
    mockRetrieve.mockResolvedValue({ email: "user@example.com" });
    mockEventBridgeSend.mockResolvedValue({});
    // Mock DynamoDB responses for idempotency
    mockDynamoDBSend.mockResolvedValueOnce({}); // PutItem - store new item

    await subscriptionDeleted(dependencies)(baseEvent);

    expect(mockRetrieve).toHaveBeenCalledWith("cus_123");
    expect(mockEventBridgeSend).toHaveBeenCalledWith(
      expect.any(PutEventsCommand),
    );
    const commandArg = mockEventBridgeSend.mock.calls[0][0] as PutEventsCommand;
    const input = commandArg.input;
    const entries = (input as { Entries: Array<{ [key: string]: unknown }> })
      .Entries;
    expect(entries[0].Source).toBe("service.stripe");
    expect(entries[0].DetailType).toBe("SubscriptionDeleted");
    expect(entries[0].EventBusName).toBe(eventBusName);
    const detail = JSON.parse(entries[0].Detail as string);
    expect(detail).toMatchObject({
      userEmail: "user@example.com",
      stripeSubscriptionId: "sub_123",
      status: "canceled",
      endedAt: 1234567890,
      canceledAt: 1234567891,
    });
  });

  it("should not send event if subscription is not canceled", async () => {
    const event = {
      ...baseEvent,
      status: "active",
    };
    mockRetrieve.mockResolvedValue({ email: "user@example.com" });

    await subscriptionDeleted(dependencies)(event);

    expect(mockEventBridgeSend).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Subscription is not canceled, skipping",
      { status: "active" },
    );
  });

  it("should log and throw error if stripe.customer.retrieve fails", async () => {
    const error = new Error("Stripe error");
    mockRetrieve.mockRejectedValue(error);

    await expect(subscriptionDeleted(dependencies)(baseEvent)).rejects.toThrow(
      "Stripe error",
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Error processing subscription deletion",
      {
        error: "Stripe error",
        subscriptionId: "sub_123",
      },
    );
  });

  it("should log and throw error if eventBridgeClient.send fails", async () => {
    mockRetrieve.mockResolvedValue({ email: "user@example.com" });
    const error = new Error("EventBridge error");
    mockEventBridgeSend.mockRejectedValue(error);
    // Mock DynamoDB responses for idempotency
    mockDynamoDBSend.mockResolvedValueOnce({}); // PutItem - store new item

    await expect(subscriptionDeleted(dependencies)(baseEvent)).rejects.toThrow(
      "EventBridge error",
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Error processing subscription deletion",
      {
        error: "EventBridge error",
        subscriptionId: "sub_123",
      },
    );
  });
});
