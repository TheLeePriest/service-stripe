import { describe, it, expect, vi, beforeEach } from "vitest";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { sessionCompleted } from "./SessionCompleted";
import type { SessionCompletedDependencies } from "./SessionCompleted.types";

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

const deps: SessionCompletedDependencies = {
  stripe: mockStripe as unknown as SessionCompletedDependencies["stripe"],
  eventBridgeClient: mockEventBridge as unknown as SessionCompletedDependencies["eventBridgeClient"],
  eventBusName: "test-bus",
  dynamoDBClient: mockDynamoDB as unknown as SessionCompletedDependencies["dynamoDBClient"],
  idempotencyTableName: "test-table",
  logger: mockLogger as SessionCompletedDependencies["logger"],
};

const baseSession = {
  id: "cs_123",
  mode: "subscription",
  customer_details: { email: "test@example.com", name: "Jane Doe" },
  customer: {
    id: "cus_123",
    email: "test@example.com",
    name: null,
  },
  subscription: {
    id: "sub_123",
    status: "trialing",
    currency: "gbp",
    start_date: 1700000000,
    trial_end: 1700604800,
    cancel_at_period_end: false,
    metadata: {},
    items: {
      data: [
        {
          plan: { product: "prod_123" },
          price: { id: "price_123" },
          current_period_end: 1700604800,
        },
      ],
    },
  },
  payment_intent: null,
  custom_fields: [],
  metadata: {},
};

describe("sessionCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: false });
    mockEventBridge.send.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: "e1" }] });
    mockStripe.checkout.sessions.retrieve.mockResolvedValue(baseSession);
    mockStripe.customers.update.mockResolvedValue({});
    mockStripe.subscriptions.update.mockResolvedValue({});
  });

  it("processes a standard checkout and sends CustomerCreated event", async () => {
    await sessionCompleted(deps)({ object: { id: "cs_123" } } as any);

    // Should update customer name since customer.name is null
    expect(mockStripe.customers.update).toHaveBeenCalledWith("cus_123", { name: "Jane Doe" });

    expect(mockEventBridge.send).toHaveBeenCalledTimes(1);
    const command = mockEventBridge.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutEventsCommand);
    expect(command.input.Entries[0].DetailType).toBe("CustomerCreated");
    const detail = JSON.parse(command.input.Entries[0].Detail);
    expect(detail.stripeCustomerId).toBe("cus_123");
    expect(detail.firstName).toBe("Jane");
    expect(detail.lastName).toBe("Doe");
    expect(detail.customerEmail).toBe("test@example.com");
    expect(detail.stripeSubscriptionId).toBe("sub_123");
  });

  it("skips setup mode sessions", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      ...baseSession,
      mode: "setup",
    });

    await sessionCompleted(deps)({ object: { id: "cs_123" } } as any);

    expect(mockEventBridge.send).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Skipping setup mode session - handled by complete-upgrade API endpoint",
      expect.any(Object),
    );
  });

  it("skips when customer or subscription is missing", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      ...baseSession,
      customer: null,
      subscription: null,
    });

    await sessionCompleted(deps)({ object: { id: "cs_123" } } as any);

    expect(mockEventBridge.send).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Missing customer or subscription data, skipping",
      expect.any(Object),
    );
  });

  it("falls back through name extraction chain", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      ...baseSession,
      customer_details: { email: "test@example.com", name: null },
      payment_intent: null,
      custom_fields: [
        { key: "full_name", text: { value: "Custom Field Name" } },
      ],
    });

    await sessionCompleted(deps)({ object: { id: "cs_123" } } as any);

    const detail = JSON.parse(mockEventBridge.send.mock.calls[0][0].input.Entries[0].Detail);
    expect(detail.name).toBe("Custom Field Name");
    expect(detail.firstName).toBe("Custom");
    expect(detail.lastName).toBe("Field Name");
  });

  it("does not update customer name if already set", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      ...baseSession,
      customer: { ...baseSession.customer, name: "Existing Name" },
    });

    await sessionCompleted(deps)({ object: { id: "cs_123" } } as any);

    expect(mockStripe.customers.update).not.toHaveBeenCalled();
  });

  it("skips duplicate events via idempotency", async () => {
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: true });

    await sessionCompleted(deps)({ object: { id: "cs_123" } } as any);

    expect(mockEventBridge.send).not.toHaveBeenCalled();
  });

  it("sets beta tester flag on subscription when present", async () => {
    mockStripe.checkout.sessions.retrieve.mockResolvedValue({
      ...baseSession,
      metadata: { is_beta_tester: "true" },
    });

    await sessionCompleted(deps)({ object: { id: "cs_123" } } as any);

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_123", {
      metadata: { is_beta_tester: "true" },
    });
    const detail = JSON.parse(mockEventBridge.send.mock.calls[0][0].input.Entries[0].Detail);
    expect(detail.isBetaTester).toBe(true);
  });

  it("continues when customer name update fails", async () => {
    mockStripe.customers.update.mockRejectedValue(new Error("API error"));

    await sessionCompleted(deps)({ object: { id: "cs_123" } } as any);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Failed to update Stripe customer name",
      expect.objectContaining({ customerId: "cus_123" }),
    );
    // Should still send the event
    expect(mockEventBridge.send).toHaveBeenCalledTimes(1);
  });

  it("returns early when session data is missing", async () => {
    await sessionCompleted(deps)({ object: null } as any);

    expect(mockStripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mockEventBridge.send).not.toHaveBeenCalled();
  });
});
