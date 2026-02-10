import { describe, it, expect, vi, beforeEach } from "vitest";
import { subscriptionPauseRequested } from "./SubscriptionPauseRequested";
import type { SubscriptionPauseRequestedDependencies } from "./SubscriptionPauseRequested.types";

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

const deps: SubscriptionPauseRequestedDependencies = {
  stripeClient: mockStripe as SubscriptionPauseRequestedDependencies["stripeClient"],
  logger: mockLogger as SubscriptionPauseRequestedDependencies["logger"],
};

const makeEvent = (detail: Record<string, unknown> = {}) => ({
  id: "evt-1",
  source: "service.license",
  "detail-type": "SubscriptionPauseRequested",
  detail: {
    stripeSubscriptionId: "sub_123",
    reason: "usage_limit",
    ...detail,
  },
  time: "2025-01-01T00:00:00Z",
  region: "eu-west-2",
  account: "123456789",
  version: "0",
  resources: [],
});

describe("subscriptionPauseRequested", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_123",
      status: "trialing",
      cancel_at_period_end: false,
      metadata: {},
    });
    mockStripe.subscriptions.update.mockResolvedValue({});
  });

  it("cancels a trialing subscription at period end", async () => {
    await subscriptionPauseRequested(deps)(makeEvent() as any);

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_123", {
      cancel_at_period_end: true,
    }, {
      idempotencyKey: "pause-cancel-sub_123-evt-1",
    });
  });

  it("skips when subscription already set to cancel", async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_123",
      status: "trialing",
      cancel_at_period_end: true,
      metadata: {},
    });

    await subscriptionPauseRequested(deps)(makeEvent() as any);

    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Subscription already set to cancel at period end; skipping",
      expect.any(Object),
    );
  });

  it("skips when subscription is not trialing", async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_123",
      status: "active",
      cancel_at_period_end: false,
      metadata: {},
    });

    await subscriptionPauseRequested(deps)(makeEvent() as any);

    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Subscription not trialing; skipping cancellation",
      expect.any(Object),
    );
  });

  it("skips when subscription is marked as upgrade", async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_123",
      status: "trialing",
      cancel_at_period_end: false,
      metadata: { is_upgrade: "true" },
    });

    await subscriptionPauseRequested(deps)(makeEvent() as any);

    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Subscription marked as upgrade; skipping cancellation",
      expect.any(Object),
    );
  });

  it("throws on invalid event schema", async () => {
    const event = makeEvent({ stripeSubscriptionId: undefined });

    await expect(subscriptionPauseRequested(deps)(event as any)).rejects.toThrow(
      "Invalid SubscriptionPauseRequested event",
    );
  });
});
