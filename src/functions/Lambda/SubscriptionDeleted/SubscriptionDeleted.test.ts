import { describe, it, expect, vi, beforeEach } from "vitest";
import { subscriptionDeleted } from "./SubscriptionDeleted";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type Stripe from "stripe";

describe("subscriptionDeleted", () => {
  const mockRetrieve = vi.fn();
  const mockEventBridgeSend = vi.fn();
  const eventBusName = "test-bus";
  const mockStripe = {
    customers: {
      retrieve: mockRetrieve,
    },
  };
  const mockEventBridgeClient = {
    send: mockEventBridgeSend,
  };

  const dependencies = {
    stripe: mockStripe,
    eventBridgeClient: mockEventBridgeClient,
    eventBusName,
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

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await subscriptionDeleted(dependencies)(event);

    expect(mockEventBridgeSend).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "Subscription is not canceled, skipping",
    );

    warnSpy.mockRestore();
  });

  it("should log and throw error if stripe.customer.retrieve fails", async () => {
    const error = new Error("Stripe error");
    mockRetrieve.mockRejectedValue(error);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(subscriptionDeleted(dependencies)(baseEvent)).rejects.toThrow(
      "Stripe error",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Error processing subscription cancellation:",
      error,
    );

    errorSpy.mockRestore();
  });

  it("should log and throw error if eventBridgeClient.send fails", async () => {
    mockRetrieve.mockResolvedValue({ email: "user@example.com" });
    const error = new Error("EventBridge error");
    mockEventBridgeSend.mockRejectedValue(error);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(subscriptionDeleted(dependencies)(baseEvent)).rejects.toThrow(
      "EventBridge error",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Error processing subscription cancellation:",
      error,
    );

    errorSpy.mockRestore();
  });
});
