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
          metadata: {},
        },
      ],
    },
    customer: "cus_123",
    id: id,
    status,
    cancel_at_period_end,
    cancel_at,
    previousAttributes,
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

  const dependencies = {
    eventBusArn,
    eventBusSchedulerRoleArn,
    schedulerClient,
    eventBusName: "test-event-bus",
    eventBridgeClient,
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
    );
    expect(mockHandleCancellation).not.toHaveBeenCalled();
  });

  it("logs update if no cancellation or uncancellation", async () => {
    const event = makeEvent();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await subscriptionUpdated(dependencies)(event);
    expect(mockHandleCancellation).not.toHaveBeenCalled();
    expect(mockHandleUncancellation).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      `Subscription ${event.id} updated with status: ${event.status}`,
    );
    logSpy.mockRestore();
  });

  it("logs and throws on error", async () => {
    const event = makeEvent({ cancel_at_period_end: true });
    mockHandleCancellation.mockRejectedValueOnce(new Error("fail!"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(subscriptionUpdated(dependencies)(event)).rejects.toThrow(
      "fail!",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      `Error processing subscription ${event.id}:`,
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
