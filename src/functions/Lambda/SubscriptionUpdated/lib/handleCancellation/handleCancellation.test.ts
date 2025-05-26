import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleCancellation } from "./handleCancellation";
import { ConflictException } from "@aws-sdk/client-scheduler";
import type Stripe from "stripe";

const mockSubscription = (overrides: Partial<Stripe.Subscription> = {}) => ({
  id: "sub_123",
  customer: "cus_456",
  status: "active",
  cancel_at_period_end: true,
  items: {
    data: [
      {
        id: "item_1",
        current_period_end: Math.floor(Date.now() / 1000) + 3600, // 1 hour in future
      },
      {
        id: "item_2",
        current_period_end: Math.floor(Date.now() / 1000) - 3600, // 1 hour in past
      },
    ],
  },
  ...overrides,
});

const eventBusArn = "arn:aws:events:region:account:event-bus/test";
const roleArn = "arn:aws:iam::account:role/test";

describe("handleCancellation", () => {
  const sendMock = vi.fn();
  const mockSchedulerClient = {
    send: sendMock,
  };

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  it("schedules cancellation for future period_end and skips past ones", async () => {
    sendMock.mockResolvedValueOnce({});
    const subscription = mockSubscription();
    await handleCancellation(
      subscription as Stripe.Subscription,
      mockSchedulerClient,
      eventBusArn,
      roleArn,
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input.Name).toBe(
      `subscription-cancel-${subscription.id}-item_1`,
    );
    expect(console.warn).toHaveBeenCalledWith(
      `Skipping ${subscription.id}/item_2: period end already passed`,
    );
  });

  it("updates schedule if ConflictException is thrown", async () => {
    sendMock
      .mockRejectedValueOnce({ name: ConflictException.name })
      .mockResolvedValueOnce({});
    const subscription = mockSubscription({
      items: {
        object: "list",
        has_more: false,
        url: "/v1/subscription_items?subscription=sub_123",
        data: [
          {
            id: "item_1",
            object: "subscription_item",
            created: Math.floor(Date.now() / 1000),
            current_period_start: Math.floor(Date.now() / 1000) - 3600,
            current_period_end: Math.floor(Date.now() / 1000) + 3600,
            plan: {} as Stripe.Plan,
            price: {} as Stripe.Price,
            quantity: 1,
            subscription: "sub_123",
            metadata: {},
            tax_rates: [],
            discounts: [],
          },
        ],
      },
    });

    await handleCancellation(
      subscription as Stripe.Subscription,
      mockSchedulerClient,
      eventBusArn,
      roleArn,
    );

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(console.info).toHaveBeenCalledWith(
      `Schedule subscription-cancel-${subscription.id}-item_1 exists, updating…`,
    );
    expect(console.info).toHaveBeenCalledWith(
      `Updated subscription-cancel-${subscription.id}-item_1`,
    );
  });

  it("throws if scheduling fails for any item", async () => {
    sendMock.mockRejectedValueOnce(new Error("Some AWS error"));
    const subscription = mockSubscription({
      items: {
        object: "list",
        has_more: false,
        url: "/v1/subscription_items?subscription=sub_123",
        data: [
          {
            id: "item_1",
            object: "subscription_item",
            created: Math.floor(Date.now() / 1000),
            current_period_start: Math.floor(Date.now() / 1000) - 3600,
            current_period_end: Math.floor(Date.now() / 1000) + 3600,
            plan: {} as Stripe.Plan,
            price: {} as Stripe.Price,
            quantity: 1,
            subscription: "sub_123",
            metadata: {},
            tax_rates: [],
            discounts: [],
          },
        ],
      },
    });

    await expect(
      handleCancellation(
        subscription as Stripe.Subscription,
        mockSchedulerClient,
        eventBusArn,
        roleArn,
      ),
    ).rejects.toThrow("1 subscription schedules failed");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Error scheduling"),
      expect.any(Error),
    );
  });

  it("does nothing if all items are in the past", async () => {
    const subscription = mockSubscription({
      items: {
        object: "list",
        has_more: false,
        url: "/v1/subscription_items?subscription=sub_123",
        data: [
          {
            id: "item_1",
            object: "subscription_item",
            created: Math.floor(Date.now() / 1000) - 200,
            current_period_start: Math.floor(Date.now() / 1000) - 200,
            current_period_end: Math.floor(Date.now() / 1000) - 100,
            plan: {} as Stripe.Plan,
            price: {} as Stripe.Price,
            quantity: 1,
            subscription: "sub_123",
            metadata: {},
            tax_rates: [],
            discounts: [],
          },
          {
            id: "item_2",
            object: "subscription_item",
            created: Math.floor(Date.now() / 1000) - 300,
            current_period_start: Math.floor(Date.now() / 1000) - 300,
            current_period_end: Math.floor(Date.now() / 1000) - 200,
            plan: {} as Stripe.Plan,
            price: {} as Stripe.Price,
            quantity: 1,
            subscription: "sub_123",
            metadata: {},
            tax_rates: [],
            discounts: [],
          },
        ],
      },
    });

    await handleCancellation(
      subscription as Stripe.Subscription,
      mockSchedulerClient,
      eventBusArn,
      roleArn,
    );

    expect(sendMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
