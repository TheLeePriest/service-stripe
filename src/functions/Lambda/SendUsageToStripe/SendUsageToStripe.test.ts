import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendUsageToStripe } from "./SendUsageToStripe";
import type { SendUsageToStripeDependencies } from "./SendUsageToStripe.types";

const mockStripe = {
  customers: { retrieve: vi.fn(), update: vi.fn() },
  products: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn(), update: vi.fn(), list: vi.fn(), cancel: vi.fn() },
  prices: { retrieve: vi.fn() },
  billing: { meterEvents: { create: vi.fn() } },
  paymentMethods: { attach: vi.fn() },
  refunds: { list: vi.fn() },
  checkout: { sessions: { retrieve: vi.fn() } },
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const deps: SendUsageToStripeDependencies = {
  stripeClient: mockStripe as SendUsageToStripeDependencies["stripeClient"],
  logger: mockLogger as SendUsageToStripeDependencies["logger"],
  config: { enterpriseUsagePriceId: "price_enterprise" },
};

const makeRecord = (detail: Record<string, unknown>) => ({
  messageId: "msg-1",
  body: JSON.stringify({ detail }),
  receiptHandle: "rh-1",
  attributes: {} as any,
  messageAttributes: {},
  md5OfBody: "",
  eventSource: "aws:sqs",
  eventSourceARN: "arn:aws:sqs:eu-west-2:123:queue",
  awsRegion: "eu-west-2",
});

describe("sendUsageToStripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStripe.billing.meterEvents.create.mockResolvedValue({});
  });

  it("sends meter event for PRO subscription", async () => {
    const event = {
      Records: [
        makeRecord({
          stripeCustomerId: "cus_123",
          resourcesAnalyzed: 5,
          subscriptionType: "PRO",
          meteredPriceId: "price_pro",
        }),
      ],
    };

    await sendUsageToStripe(deps)(event as any);

    expect(mockStripe.billing.meterEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: "cdk_insights_usage",
        payload: expect.objectContaining({
          stripe_customer_id: "cus_123",
          value: "5",
          price_id: "price_pro",
        }),
      }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining("usage-msg-1") }),
    );
  });

  it("uses enterprise price for TEAM subscription", async () => {
    const event = {
      Records: [
        makeRecord({
          stripeCustomerId: "cus_123",
          resourcesAnalyzed: 10,
          subscriptionType: "TEAM",
        }),
      ],
    };

    await sendUsageToStripe(deps)(event as any);

    const call = mockStripe.billing.meterEvents.create.mock.calls[0][0];
    expect(call.payload.price_id).toBe("price_enterprise");
  });

  it("skips records with missing required fields", async () => {
    const event = {
      Records: [makeRecord({ stripeCustomerId: null, resourcesAnalyzed: null })],
    };

    await sendUsageToStripe(deps)(event as any);

    expect(mockStripe.billing.meterEvents.create).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Missing required fields, skipping record",
      expect.any(Object),
    );
  });

  it("handles parse errors gracefully", async () => {
    const event = {
      Records: [{ ...makeRecord({}), body: "not-json" }],
    };

    await sendUsageToStripe(deps)(event as any);

    expect(mockStripe.billing.meterEvents.create).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to parse record body",
      expect.any(Object),
    );
  });

  it("throws when a meter event fails", async () => {
    mockStripe.billing.meterEvents.create.mockRejectedValue(new Error("Stripe error"));

    const event = {
      Records: [
        makeRecord({
          stripeCustomerId: "cus_123",
          resourcesAnalyzed: 5,
          subscriptionType: "PRO",
          meteredPriceId: "price_pro",
        }),
      ],
    };

    await expect(sendUsageToStripe(deps)(event as any)).rejects.toThrow(
      "Some meter events failed to send to Stripe",
    );
  });

  it("processes multiple records in a batch", async () => {
    const event = {
      Records: [
        makeRecord({ stripeCustomerId: "cus_1", resourcesAnalyzed: 3, subscriptionType: "PRO", meteredPriceId: "p1" }),
        makeRecord({ stripeCustomerId: "cus_2", resourcesAnalyzed: 7, subscriptionType: "ENTERPRISE" }),
      ],
    };

    await sendUsageToStripe(deps)(event as any);

    expect(mockStripe.billing.meterEvents.create).toHaveBeenCalledTimes(2);
  });
});
