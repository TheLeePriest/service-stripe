import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleCancellation } from "./handleCancellation";
import type { SubscriptionUpdatedEvent } from "../../SubscriptionUpdated.types";

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
        metadata: {},
      },
    ],
  },
} satisfies SubscriptionUpdatedEvent;

const eventBusName = "test-event-bus";

describe("handleCancellation", () => {
  const sendMock = vi.fn();
  const mockEventBridgeClient = {
    send: sendMock,
  };

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("sends event for LicenseCancelled", async () => {
    sendMock.mockResolvedValueOnce({});
    vi.setSystemTime(1134567890 * 1000);
    await handleCancellation({
      subscription: mockEvent,
      eventBridgeClient: mockEventBridgeClient,
      eventBusName,
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
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
            metadata: {},
          },
        ],
      },
    } satisfies SubscriptionUpdatedEvent;
    vi.setSystemTime(1334567890 * 1000);

    await handleCancellation({
      subscription,
      eventBridgeClient: mockEventBridgeClient,
      eventBusName,
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
