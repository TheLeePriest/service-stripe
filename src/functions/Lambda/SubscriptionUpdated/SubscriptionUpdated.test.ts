import { describe, it, expect, vi, beforeEach } from "vitest";
import { subscriptionUpdated } from "./SubscriptionUpdated";
import { handleCancellation } from "./lib/handleCancellation/handleCancellation";
import { handleUncancellation } from "./lib/handleUncancellation/handleUncancellation";
import type { SubscriptionUpdatedEvent } from "./SubscriptionUpdated.types";

vi.mock("./lib/handleCancellation/handleCancellation");
vi.mock("./lib/handleUncancellation/handleUncancellation");

const mockHandleCancellation = vi.mocked(handleCancellation);
const mockHandleUncancellation = vi.mocked(handleUncancellation);

const eventBusArn = "arn:aws:events:region:account:event-bus/test";
const eventBusSchedulerRoleArn = "arn:aws:iam::account:role/test";

const makeEvent = ({
  id = "sub_123",
  status = "active",
  cancel_at_period_end = false,
  cancel_at = 1234567890,
  previousAttributes = {},
}: Partial<SubscriptionUpdatedEvent> = {}) => {
  return {
    items: {
      data: [
        {
          id: "item_123",
          price: { product: "product-1", id: "product-1-id" },
          quantity: 1,
          current_period_end: 1234567890,
          current_period_start: 1234567890,
          metadata: {} as Record<string, unknown>,
        },
      ],
    },
    customer: "cus_123",
    id: id,
    status,
    cancel_at_period_end,
    cancel_at,
    previousAttributes,
    createdAt: 1234567890,
  };
};

describe("subscriptionUpdated", () => {
  const mockSend = vi.fn();
  const mockEventSend = vi.fn();
  const schedulerClient = {
    send: mockSend,
  };
  const eventBridgeClient = {
    send: mockEventSend,
  };
  const eventBusName = "test-event-bus";
  const mockCustomerRetrieve = vi.fn();
  const mockProductRetrieve = vi.fn();
  const mockSubscriptionRetrieve = vi.fn();
  const stripe = {
    customers: { retrieve: mockCustomerRetrieve },
    products: { retrieve: mockProductRetrieve },
    subscriptions: { retrieve: mockSubscriptionRetrieve },
    prices: { list: vi.fn(), retrieve: vi.fn() },
  };

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    logUsageEvent: vi.fn(),
    logStripeEvent: vi.fn(),
  };

  const dependencies = {
    eventBusArn,
    eventBusSchedulerRoleArn,
    schedulerClient,
    eventBusName: "test-event-bus",
    eventBridgeClient,
    stripe,
    logger: mockLogger,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not call handleCancellation if cancel_at_period_end is false", async () => {
    const event = makeEvent({ cancel_at_period_end: false });
    await subscriptionUpdated(dependencies)(event);
    expect(mockHandleCancellation).not.toHaveBeenCalled();
    expect(mockHandleUncancellation).not.toHaveBeenCalled();
  });

  it("calls handleCancellation if status is 'active' and cancel_at_period_end is true", async () => {
    const event = makeEvent({ status: "active", cancel_at_period_end: true });
    await subscriptionUpdated(dependencies)(event);
    expect(mockHandleCancellation).toHaveBeenCalledWith({
      subscription: event,
      eventBridgeClient,
      eventBusName,
      logger: mockLogger,
    });
    expect(mockHandleUncancellation).not.toHaveBeenCalled();
  });

  it("calls handleUncancellation if cancel_at changed from value to null", async () => {
    const event = makeEvent({
      cancel_at: null,
      previousAttributes: { cancel_at: 1234567890 },
    });
    await subscriptionUpdated(dependencies)(event);
    expect(mockHandleUncancellation).toHaveBeenCalledWith(
      event,
      schedulerClient,
      mockLogger,
    );
    expect(mockHandleCancellation).not.toHaveBeenCalled();
  });

  it("calls handleUncancellation if cancel_at_period_end changed from true to false", async () => {
    const event = makeEvent({
      cancel_at_period_end: false,
      previousAttributes: { cancel_at_period_end: true },
    });
    await subscriptionUpdated(dependencies)(event);
    expect(mockHandleUncancellation).toHaveBeenCalledWith(
      event,
      schedulerClient,
      mockLogger,
    );
    expect(mockHandleCancellation).not.toHaveBeenCalled();
  });

  it("logs update if no cancellation or uncancellation", async () => {
    const event = makeEvent();
    await subscriptionUpdated(dependencies)(event);
    expect(mockHandleCancellation).not.toHaveBeenCalled();
    expect(mockHandleUncancellation).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith("Subscription updated (other change)", {
      subscriptionId: event.id,
      status: event.status,
      changes: {
        cancelAtPeriodEndChanged: true,
        currentPeriodEndChanged: true,
        statusChanged: true,
      },
    });
  });

  it("logs and throws on error", async () => {
    const event = makeEvent({ cancel_at_period_end: true });
    mockHandleCancellation.mockRejectedValueOnce(new Error("fail!"));
    await expect(subscriptionUpdated(dependencies)(event)).rejects.toThrow(
      "fail!",
    );
    expect(mockLogger.error).toHaveBeenCalledWith("Error processing subscription", {
      subscriptionId: event.id,
      error: "fail!",
      stack: expect.any(String),
      status: "active",
    });
  });
});
