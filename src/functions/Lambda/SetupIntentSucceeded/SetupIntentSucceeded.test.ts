import { describe, it, expect, vi, beforeEach } from "vitest";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { setupIntentSucceeded } from "./SetupIntentSucceeded";
import type { SetupIntentSucceededDependencies } from "./SetupIntentSucceeded.types";

vi.mock("../lib/idempotency", () => ({
  ensureIdempotency: vi.fn(),
  generateEventId: vi.fn(() => "test-event-id"),
}));

import { ensureIdempotency } from "../lib/idempotency";
const mockEnsureIdempotency = vi.mocked(ensureIdempotency);

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

const mockEventBridge = { send: vi.fn() };
const mockDynamoDB = { send: vi.fn() };
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const deps: SetupIntentSucceededDependencies = {
  stripe: mockStripe as SetupIntentSucceededDependencies["stripe"],
  eventBridgeClient: mockEventBridge as unknown as SetupIntentSucceededDependencies["eventBridgeClient"],
  eventBusName: "test-bus",
  dynamoDBClient: mockDynamoDB as unknown as SetupIntentSucceededDependencies["dynamoDBClient"],
  idempotencyTableName: "test-table",
  logger: mockLogger as SetupIntentSucceededDependencies["logger"],
};

const makeEvent = (setupIntent: Record<string, unknown>) => ({
  id: "evt-1",
  source: "aws.partner/stripe.com",
  "detail-type": "setup_intent.succeeded",
  detail: {
    id: "evt_stripe_1",
    type: "setup_intent.succeeded",
    data: {
      object: {
        id: "seti_123",
        customer: "cus_123",
        payment_method: "pm_123",
        status: "succeeded",
        created: 1700000000,
        metadata: {
          subscription_id: "sub_123",
          requires_upgrade: "true",
        },
        ...setupIntent,
      },
    },
  },
  time: "2025-01-01T00:00:00Z",
  region: "eu-west-2",
  account: "123456789",
  version: "0",
  resources: [],
});

const trialingSubscription = {
  id: "sub_123",
  customer: "cus_123",
  status: "trialing",
  trial_end: 1700100000,
  cancel_at_period_end: false,
  metadata: {},
  items: {
    data: [
      {
        id: "si_123",
        price: {
          id: "price_123",
          product: "prod_123",
          recurring: { usage_type: "licensed" },
        },
        quantity: 1,
      },
    ],
  },
};

describe("setupIntentSucceeded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: false });
    mockEventBridge.send.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: "e1" }] });
    mockStripe.subscriptions.retrieve.mockResolvedValue(trialingSubscription);
    mockStripe.paymentMethods.attach.mockResolvedValue({});
    mockStripe.customers.update.mockResolvedValue({});
    mockStripe.subscriptions.update.mockResolvedValue({ ...trialingSubscription, status: "active", trial_end: null });
  });

  it("processes a valid trial upgrade end-to-end", async () => {
    await setupIntentSucceeded(deps)(makeEvent({}));

    expect(mockStripe.paymentMethods.attach).toHaveBeenCalledWith("pm_123", { customer: "cus_123" });
    expect(mockStripe.customers.update).toHaveBeenCalledWith("cus_123", {
      invoice_settings: { default_payment_method: "pm_123" },
    });
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        default_payment_method: "pm_123",
        trial_end: "now",
        metadata: expect.objectContaining({
          upgrade_type: "trial_to_paid",
          is_upgrade: "true",
        }),
      }),
    );

    expect(mockEventBridge.send).toHaveBeenCalledTimes(1);
    const command = mockEventBridge.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutEventsCommand);
    expect(command.input.Entries[0].DetailType).toBe("SetupIntentSucceeded");
    const detail = JSON.parse(command.input.Entries[0].Detail);
    expect(detail.upgradeType).toBe("trial_to_paid");
    expect(detail.stripeSubscriptionId).toBe("sub_123");
  });

  it("skips when setup intent is not for upgrade", async () => {
    const event = makeEvent({ metadata: {} });

    await setupIntentSucceeded(deps)(event);

    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mockStripe.paymentMethods.attach).not.toHaveBeenCalled();
    expect(mockEventBridge.send).not.toHaveBeenCalled();
  });

  it("skips when subscription is not trialing", async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      ...trialingSubscription,
      status: "active",
      trial_end: null,
    });

    await setupIntentSucceeded(deps)(makeEvent({}));

    expect(mockStripe.paymentMethods.attach).not.toHaveBeenCalled();
    expect(mockEventBridge.send).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Subscription is not a trial, skipping upgrade",
      expect.objectContaining({ subscriptionId: "sub_123" }),
    );
  });

  it("throws when customer ID mismatches", async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      ...trialingSubscription,
      customer: "cus_different",
    });

    await expect(setupIntentSucceeded(deps)(makeEvent({}))).rejects.toThrow(
      "Customer ID does not match subscription",
    );
  });

  it("skips duplicate events via idempotency", async () => {
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: true });

    await setupIntentSucceeded(deps)(makeEvent({}));

    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mockStripe.paymentMethods.attach).not.toHaveBeenCalled();
    expect(mockEventBridge.send).not.toHaveBeenCalled();
  });

  it("throws on missing data.object", async () => {
    const event = {
      ...makeEvent({}),
      detail: { id: "evt_1", type: "setup_intent.succeeded", data: {} },
    };

    await expect(setupIntentSucceeded(deps)(event)).rejects.toThrow(
      "Invalid Stripe event structure: missing data.object",
    );
  });

  it("throws on missing required fields", async () => {
    const event = makeEvent({ id: null, customer: null, payment_method: null });

    await expect(setupIntentSucceeded(deps)(event)).rejects.toThrow(
      "Setup intent missing required fields",
    );
  });

  it("updates base price when target_price_id is provided", async () => {
    const event = makeEvent({
      metadata: {
        subscription_id: "sub_123",
        requires_upgrade: "true",
        target_price_id: "price_new",
      },
    });

    await setupIntentSucceeded(deps)(event);

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      expect.objectContaining({
        items: [{ id: "si_123", price: "price_new", quantity: 1 }],
      }),
    );
  });
});
