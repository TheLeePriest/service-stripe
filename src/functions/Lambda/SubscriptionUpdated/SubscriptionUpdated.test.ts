import { describe, it, expect, vi, beforeEach } from "vitest";
import { subscriptionUpdated } from "./SubscriptionUpdated";
import type Stripe from "stripe";
import { handleCancellation } from "./lib/handleCancellation/handleCancellation";
import { handleUncancellation } from "./lib/handleUncancellation/handleUncancellation";

vi.mock("./lib/handleCancellation/handleCancellation");
vi.mock("./lib/handleUncancellation/handleUncancellation");

const mockHandleCancellation = vi.mocked(handleCancellation);
const mockHandleUncancellation = vi.mocked(handleUncancellation);

const eventBusArn = "arn:aws:events:region:account:event-bus/test";
const eventBusSchedulerRoleArn = "arn:aws:iam::account:role/test";

type SubscriptionEvent = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  previous_attributes: Record<string, unknown>;
};

const makeEvent = ({
  id = "sub_123",
  status = "active",
  cancel_at_period_end = false,
  cancel_at = null,
  previous_attributes = {},
}: Partial<SubscriptionEvent> = {}) => {
  return {
    object: {
      id,
      status,
      cancel_at_period_end,
      cancel_at,
    },
    previous_attributes,
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

  it("calls handleCancellation if cancel_at_period_end is true", async () => {
    const event = makeEvent({ cancel_at_period_end: true });
    await subscriptionUpdated(dependencies)(
      event as Stripe.CustomerSubscriptionUpdatedEvent.Data,
    );
    expect(mockHandleCancellation).toHaveBeenCalledWith(
      event.object,
      schedulerClient,
      eventBusArn,
      eventBusSchedulerRoleArn,
    );
    expect(mockHandleUncancellation).not.toHaveBeenCalled();
  });

  it("calls handleCancellation if status is 'canceled'", async () => {
    const event = makeEvent({ status: "canceled" });
    await subscriptionUpdated(dependencies)(
      event as Stripe.CustomerSubscriptionUpdatedEvent.Data,
    );
    expect(mockHandleCancellation).toHaveBeenCalledWith(
      event.object,
      schedulerClient,
      eventBusArn,
      eventBusSchedulerRoleArn,
    );
    expect(mockHandleUncancellation).not.toHaveBeenCalled();
  });

  it("calls handleUncancellation if cancel_at changed from value to null", async () => {
    const event = makeEvent({
      cancel_at: null,
      previous_attributes: { cancel_at: 1234567890 },
    });
    await subscriptionUpdated(dependencies)(
      event as Stripe.CustomerSubscriptionUpdatedEvent.Data,
    );
    expect(mockHandleUncancellation).toHaveBeenCalledWith(
      event.object,
      schedulerClient,
    );
    expect(mockHandleCancellation).not.toHaveBeenCalled();
  });

  it("calls handleUncancellation if cancel_at_period_end changed from true to false", async () => {
    const event = makeEvent({
      cancel_at_period_end: false,
      previous_attributes: { cancel_at_period_end: true },
    });
    await subscriptionUpdated(dependencies)(
      event as Stripe.CustomerSubscriptionUpdatedEvent.Data,
    );
    expect(mockHandleUncancellation).toHaveBeenCalledWith(
      event.object,
      schedulerClient,
    );
    expect(mockHandleCancellation).not.toHaveBeenCalled();
  });

  it("logs update if no cancellation or uncancellation", async () => {
    const event = makeEvent();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await subscriptionUpdated(dependencies)(
      event as Stripe.CustomerSubscriptionUpdatedEvent.Data,
    );
    expect(mockHandleCancellation).not.toHaveBeenCalled();
    expect(mockHandleUncancellation).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      `Subscription ${event.object.id} updated with status: ${event.object.status}`,
    );
    logSpy.mockRestore();
  });

  it("logs and throws on error", async () => {
    const event = makeEvent({ cancel_at_period_end: true });
    mockHandleCancellation.mockRejectedValueOnce(new Error("fail!"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      subscriptionUpdated(dependencies)(
        event as Stripe.CustomerSubscriptionUpdatedEvent.Data,
      ),
    ).rejects.toThrow("fail!");
    expect(errorSpy).toHaveBeenCalledWith(
      `Error processing subscription ${event.object.id}:`,
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
