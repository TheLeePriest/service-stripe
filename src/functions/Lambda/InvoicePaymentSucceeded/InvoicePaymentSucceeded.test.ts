import { describe, it, expect, vi, beforeEach } from "vitest";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { invoicePaymentSucceeded } from "./InvoicePaymentSucceeded";
import type { InvoicePaymentSucceededDependencies } from "./InvoicePaymentSucceeded.types";

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

const deps: InvoicePaymentSucceededDependencies = {
  stripe: mockStripe as InvoicePaymentSucceededDependencies["stripe"],
  eventBridgeClient: mockEventBridge as unknown as InvoicePaymentSucceededDependencies["eventBridgeClient"],
  eventBusName: "test-bus",
  dynamoDBClient: mockDynamoDB as unknown as InvoicePaymentSucceededDependencies["dynamoDBClient"],
  idempotencyTableName: "test-table",
  logger: mockLogger as InvoicePaymentSucceededDependencies["logger"],
};

const makeEvent = (invoice: Record<string, unknown> = {}) => ({
  id: "evt-1",
  source: "aws.partner/stripe.com",
  "detail-type": "invoice.payment_succeeded",
  detail: {
    id: "evt_stripe_1",
    type: "invoice.payment_succeeded",
    data: {
      object: {
        id: "inv_123",
        customer: "cus_123",
        subscription: "sub_123",
        status: "paid",
        amount_paid: 2000,
        currency: "gbp",
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

const customerData = {
  id: "cus_123",
  email: "test@example.com",
  name: "Test User",
};

describe("invoicePaymentSucceeded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: false });
    mockEventBridge.send.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: "e1" }] });
    mockStripe.customers.retrieve.mockResolvedValue(customerData);
  });

  it("sends InvoicePaymentSucceeded event for a standard payment", async () => {
    // Subscription period doesn't match invoice time = not a renewal
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_123",
      status: "active",
      cancel_at_period_end: false,
      items: {
        data: [{ current_period_start: 1690000000, current_period_end: 1692678400 }],
      },
    });

    await invoicePaymentSucceeded(deps)(makeEvent());

    expect(mockEventBridge.send).toHaveBeenCalledTimes(1);
    const command = mockEventBridge.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutEventsCommand);
    expect(command.input.Entries[0].DetailType).toBe("InvoicePaymentSucceeded");
    const detail = JSON.parse(command.input.Entries[0].Detail);
    expect(detail.isRenewal).toBe(false);
    expect(detail.stripeInvoiceId).toBe("inv_123");
    expect(detail.customerEmail).toBe("test@example.com");
  });

  it("detects renewal and sends email event", async () => {
    // Period start matches invoice created time = renewal
    mockStripe.subscriptions.retrieve
      .mockResolvedValueOnce({
        id: "sub_123",
        status: "active",
        cancel_at_period_end: false,
        items: {
          data: [{ current_period_start: 1700000000, current_period_end: 1702678400 }],
        },
      })
      .mockResolvedValueOnce({
        id: "sub_123",
        items: {
          data: [{
            price: {
              product: { name: "Pro Plan" },
            },
          }],
        },
      });

    await invoicePaymentSucceeded(deps)(makeEvent());

    // Main event + email event
    expect(mockEventBridge.send).toHaveBeenCalledTimes(2);

    const mainCommand = mockEventBridge.send.mock.calls[0][0];
    const mainDetail = JSON.parse(mainCommand.input.Entries[0].Detail);
    expect(mainDetail.isRenewal).toBe(true);
    expect(mainDetail.renewalData).toBeTruthy();

    const emailCommand = mockEventBridge.send.mock.calls[1][0];
    expect(emailCommand.input.Entries[0].DetailType).toBe("SendSubscriptionRenewedEmail");
    const emailDetail = JSON.parse(emailCommand.input.Entries[0].Detail);
    expect(emailDetail.planName).toBe("Pro Plan");
    expect(emailDetail.currency).toBe("\u00a3"); // £
    expect(emailDetail.amount).toBe("20.00");
  });

  it("skips duplicate events via idempotency", async () => {
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: true });

    await invoicePaymentSucceeded(deps)(makeEvent());

    expect(mockStripe.customers.retrieve).not.toHaveBeenCalled();
    expect(mockEventBridge.send).not.toHaveBeenCalled();
  });

  it("continues without renewal data when subscription fetch fails", async () => {
    mockStripe.subscriptions.retrieve.mockRejectedValue(new Error("Not found"));

    await invoicePaymentSucceeded(deps)(makeEvent());

    expect(mockEventBridge.send).toHaveBeenCalledTimes(1);
    const detail = JSON.parse(mockEventBridge.send.mock.calls[0][0].input.Entries[0].Detail);
    expect(detail.isRenewal).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Failed to fetch subscription details for renewal check, proceeding without renewal detection",
      expect.objectContaining({ subscriptionId: "sub_123" }),
    );
  });

  it("throws on missing required invoice fields", async () => {
    const event = makeEvent({ id: null, customer: null });

    await expect(invoicePaymentSucceeded(deps)(event)).rejects.toThrow(
      "Invoice missing required fields",
    );
  });

  it("handles invoice with no subscription", async () => {
    await invoicePaymentSucceeded(deps)(makeEvent({ subscription: undefined }));

    // Should not attempt subscription retrieval
    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mockEventBridge.send).toHaveBeenCalledTimes(1);
    const detail = JSON.parse(mockEventBridge.send.mock.calls[0][0].input.Entries[0].Detail);
    expect(detail.isRenewal).toBe(false);
  });
});
