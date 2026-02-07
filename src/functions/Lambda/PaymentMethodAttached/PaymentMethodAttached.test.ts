import { describe, it, expect, vi, beforeEach } from "vitest";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { paymentMethodAttached } from "./PaymentMethodAttached";
import type { PaymentMethodAttachedDependencies } from "./PaymentMethodAttached.types";

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

const deps: PaymentMethodAttachedDependencies = {
  stripe: mockStripe as PaymentMethodAttachedDependencies["stripe"],
  eventBridgeClient: mockEventBridge as unknown as PaymentMethodAttachedDependencies["eventBridgeClient"],
  eventBusName: "test-bus",
  dynamoDBClient: mockDynamoDB as unknown as PaymentMethodAttachedDependencies["dynamoDBClient"],
  idempotencyTableName: "test-table",
  logger: mockLogger as PaymentMethodAttachedDependencies["logger"],
};

const makeEvent = (pm: Record<string, unknown> = {}) => ({
  id: "evt-1",
  source: "aws.partner/stripe.com",
  "detail-type": "payment_method.attached",
  detail: {
    id: "evt_stripe_1",
    type: "payment_method.attached",
    data: {
      object: {
        id: "pm_123",
        customer: "cus_123",
        type: "card",
        card: { brand: "visa", last4: "4242" },
        created: 1700000000,
        ...pm,
      },
    },
  },
  time: "2025-01-01T00:00:00Z",
  region: "eu-west-2",
  account: "123456789",
  version: "0",
  resources: [],
});

describe("paymentMethodAttached", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: false });
    mockEventBridge.send.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: "e1" }] });
    mockStripe.customers.retrieve.mockResolvedValue({
      id: "cus_123",
      email: "test@example.com",
      name: "Test User",
    });
  });

  it("sends PaymentMethodAttached event", async () => {
    await paymentMethodAttached(deps)(makeEvent());

    expect(mockEventBridge.send).toHaveBeenCalledTimes(1);
    const command = mockEventBridge.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutEventsCommand);
    expect(command.input.Entries[0].DetailType).toBe("PaymentMethodAttached");
    const detail = JSON.parse(command.input.Entries[0].Detail);
    expect(detail.stripePaymentMethodId).toBe("pm_123");
    expect(detail.stripeCustomerId).toBe("cus_123");
    expect(detail.type).toBe("card");
    expect(detail.card).toEqual({ brand: "visa", last4: "4242" });
  });

  it("skips duplicate events via idempotency", async () => {
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: true });

    await paymentMethodAttached(deps)(makeEvent());

    expect(mockStripe.customers.retrieve).not.toHaveBeenCalled();
    expect(mockEventBridge.send).not.toHaveBeenCalled();
  });

  it("throws on missing required fields", async () => {
    const event = makeEvent({ id: null, customer: null, type: null });

    await expect(paymentMethodAttached(deps)(event)).rejects.toThrow(
      "Payment method missing required fields",
    );
  });
});
