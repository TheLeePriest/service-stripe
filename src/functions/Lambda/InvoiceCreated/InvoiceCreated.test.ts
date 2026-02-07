import { describe, it, expect, vi, beforeEach } from "vitest";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { invoiceCreated } from "./InvoiceCreated";
import type { InvoiceCreatedDependencies } from "./InvoiceCreated.types";

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

const deps: InvoiceCreatedDependencies = {
  stripe: mockStripe as unknown as InvoiceCreatedDependencies["stripe"],
  eventBridgeClient: mockEventBridge as unknown as InvoiceCreatedDependencies["eventBridgeClient"],
  eventBusName: "test-bus",
  dynamoDBClient: mockDynamoDB as unknown as InvoiceCreatedDependencies["dynamoDBClient"],
  idempotencyTableName: "test-table",
  logger: mockLogger as InvoiceCreatedDependencies["logger"],
};

const makeEvent = (invoice: Record<string, unknown> = {}) => ({
  id: "evt-1",
  source: "aws.partner/stripe.com",
  "detail-type": "invoice.created",
  detail: {
    id: "evt_stripe_1",
    type: "invoice.created",
    data: {
      object: {
        id: "inv_123",
        customer: "cus_123",
        status: "draft",
        amount_due: 2999,
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

describe("invoiceCreated", () => {
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

  it("emits InvoiceCreated event with invoice and customer data", async () => {
    await invoiceCreated(deps)(makeEvent() as any);

    expect(mockEventBridge.send).toHaveBeenCalledTimes(1);
    const command = mockEventBridge.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutEventsCommand);
    expect(command.input.Entries[0].DetailType).toBe("InvoiceCreated");
    const detail = JSON.parse(command.input.Entries[0].Detail);
    expect(detail.stripeInvoiceId).toBe("inv_123");
    expect(detail.stripeCustomerId).toBe("cus_123");
    expect(detail.customerEmail).toBe("test@example.com");
    expect(detail.status).toBe("draft");
    expect(detail.amountDue).toBe(2999);
    expect(detail.currency).toBe("gbp");
  });

  it("retrieves customer details from Stripe", async () => {
    await invoiceCreated(deps)(makeEvent() as any);

    expect(mockStripe.customers.retrieve).toHaveBeenCalledWith("cus_123");
    const detail = JSON.parse(mockEventBridge.send.mock.calls[0][0].input.Entries[0].Detail);
    expect(detail.customerData.name).toBe("Test User");
  });

  it("skips duplicate events via idempotency", async () => {
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: true });

    await invoiceCreated(deps)(makeEvent() as any);

    expect(mockEventBridge.send).not.toHaveBeenCalled();
    expect(mockStripe.customers.retrieve).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Invoice already processed, skipping",
      expect.objectContaining({ invoiceId: "inv_123" }),
    );
  });

  it("throws on missing data.object", async () => {
    const event = {
      ...makeEvent(),
      detail: { id: "evt_1", type: "invoice.created", data: {} },
    };

    await expect(invoiceCreated(deps)(event as any)).rejects.toThrow(
      "Invalid Stripe event structure: missing data.object",
    );
  });

  it("throws when invoice missing required fields", async () => {
    await expect(
      invoiceCreated(deps)(makeEvent({ id: null, customer: null }) as any),
    ).rejects.toThrow("Invoice missing required fields");
  });

  it("throws when amount_due is undefined", async () => {
    await expect(
      invoiceCreated(deps)(makeEvent({ amount_due: undefined }) as any),
    ).rejects.toThrow("Invoice missing required fields");
  });

  it("throws when customer retrieval fails", async () => {
    mockStripe.customers.retrieve.mockRejectedValue(new Error("Stripe API error"));

    await expect(invoiceCreated(deps)(makeEvent() as any)).rejects.toThrow("Stripe API error");
  });
});
