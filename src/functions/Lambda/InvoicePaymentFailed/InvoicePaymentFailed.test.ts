import { describe, it, expect, vi, beforeEach } from "vitest";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { invoicePaymentFailed } from "./InvoicePaymentFailed";
import type { InvoicePaymentFailedDependencies } from "./InvoicePaymentFailed.types";

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

const deps: InvoicePaymentFailedDependencies = {
  stripe: mockStripe as InvoicePaymentFailedDependencies["stripe"],
  eventBridgeClient: mockEventBridge as unknown as InvoicePaymentFailedDependencies["eventBridgeClient"],
  eventBusName: "test-bus",
  dynamoDBClient: mockDynamoDB as unknown as InvoicePaymentFailedDependencies["dynamoDBClient"],
  idempotencyTableName: "test-table",
  logger: mockLogger as InvoicePaymentFailedDependencies["logger"],
};

const makeEvent = (invoice: Record<string, unknown> = {}) => ({
  id: "evt-1",
  source: "aws.partner/stripe.com",
  "detail-type": "invoice.payment_failed",
  detail: {
    id: "evt_stripe_1",
    type: "invoice.payment_failed",
    data: {
      object: {
        id: "inv_123",
        customer: "cus_123",
        subscription: "sub_123",
        status: "open",
        amount_due: 2000,
        currency: "gbp",
        attempt_count: 1,
        created: 1700000000,
        ...invoice,
      },
    },
  },
  time: "2025-01-01T00:00:00Z",
  region: "eu-west-2",
  account: "123456789",
  version: "0",
  resources: [],
});

describe("invoicePaymentFailed", () => {
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

  it("sends InvoicePaymentFailed and email events", async () => {
    await invoicePaymentFailed(deps)(makeEvent());

    // Main event + email event
    expect(mockEventBridge.send).toHaveBeenCalledTimes(2);

    const mainCommand = mockEventBridge.send.mock.calls[0][0];
    expect(mainCommand).toBeInstanceOf(PutEventsCommand);
    expect(mainCommand.input.Entries[0].DetailType).toBe("InvoicePaymentFailed");
    const mainDetail = JSON.parse(mainCommand.input.Entries[0].Detail);
    expect(mainDetail.stripeInvoiceId).toBe("inv_123");
    expect(mainDetail.amountDue).toBe(2000);

    const emailCommand = mockEventBridge.send.mock.calls[1][0];
    expect(emailCommand.input.Entries[0].DetailType).toBe("SendPaymentFailedEmail");
    const emailDetail = JSON.parse(emailCommand.input.Entries[0].Detail);
    expect(emailDetail.customerEmail).toBe("test@example.com");
    expect(emailDetail.retryDate).toBeTruthy();
    expect(emailDetail.updatePaymentUrl).toContain("update_payment=true");
  });

  it("uses correct failure reason for multiple attempts", async () => {
    await invoicePaymentFailed(deps)(makeEvent({ attempt_count: 3 }));

    const emailDetail = JSON.parse(
      mockEventBridge.send.mock.calls[1][0].input.Entries[0].Detail,
    );
    expect(emailDetail.failureReason).toBe("Payment failed after 3 attempts");
  });

  it("uses generic failure reason for first attempt", async () => {
    await invoicePaymentFailed(deps)(makeEvent({ attempt_count: 1 }));

    const emailDetail = JSON.parse(
      mockEventBridge.send.mock.calls[1][0].input.Entries[0].Detail,
    );
    expect(emailDetail.failureReason).toBe("Your payment could not be processed");
  });

  it("skips email event when customer has no email", async () => {
    mockStripe.customers.retrieve.mockResolvedValue({
      id: "cus_123",
      email: null,
      name: "Test User",
    });

    await invoicePaymentFailed(deps)(makeEvent());

    // Only the main event, no email
    expect(mockEventBridge.send).toHaveBeenCalledTimes(1);
    expect(mockEventBridge.send.mock.calls[0][0].input.Entries[0].DetailType).toBe(
      "InvoicePaymentFailed",
    );
  });

  it("skips duplicate events via idempotency", async () => {
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: true });

    await invoicePaymentFailed(deps)(makeEvent());

    expect(mockStripe.customers.retrieve).not.toHaveBeenCalled();
    expect(mockEventBridge.send).not.toHaveBeenCalled();
  });

  it("throws on missing required fields", async () => {
    const event = makeEvent({ id: null, customer: null });

    await expect(invoicePaymentFailed(deps)(event)).rejects.toThrow(
      "Invoice missing required fields",
    );
  });
});
