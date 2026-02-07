import { describe, it, expect, vi, beforeEach } from "vitest";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { customerCreated } from "./CustomerCreated";
import type { CustomerCreatedDependencies } from "./CustomerCreated.types";

vi.mock("../lib/idempotency", () => ({
  ensureIdempotency: vi.fn(),
  generateEventId: vi.fn(() => "test-event-id"),
}));

import { ensureIdempotency } from "../lib/idempotency";
const mockEnsureIdempotency = vi.mocked(ensureIdempotency);

const mockEventBridge = { send: vi.fn() };
const mockDynamoDB = { send: vi.fn() };
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const deps: CustomerCreatedDependencies = {
  eventBridgeClient: mockEventBridge as unknown as CustomerCreatedDependencies["eventBridgeClient"],
  eventBusName: "test-bus",
  stripeClient: {} as any,
  dynamoDBClient: mockDynamoDB as unknown as CustomerCreatedDependencies["dynamoDBClient"],
  idempotencyTableName: "test-table",
  logger: mockLogger as CustomerCreatedDependencies["logger"],
};

const makeEvent = (customer: Record<string, unknown> = {}) => ({
  id: "evt-1",
  source: "aws.partner/stripe.com",
  "detail-type": "Stripe Event",
  detail: {
    id: "evt_stripe_1",
    type: "customer.created",
    data: {
      object: {
        id: "cus_123",
        email: "test@example.com",
        name: "Test User",
        created: 1700000000,
        metadata: {},
        ...customer,
      },
    },
  },
  time: "2025-01-01T00:00:00Z",
  region: "eu-west-2",
  account: "123456789",
  version: "0",
  resources: [],
});

describe("customerCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: false });
    mockEventBridge.send.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: "e1" }] });
  });

  it("emits CustomerCreated event with customer data", async () => {
    await customerCreated(deps)(makeEvent() as any);

    expect(mockEventBridge.send).toHaveBeenCalledTimes(1);
    const command = mockEventBridge.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutEventsCommand);
    expect(command.input.Entries[0].DetailType).toBe("CustomerCreated");
    const detail = JSON.parse(command.input.Entries[0].Detail);
    expect(detail.stripeCustomerId).toBe("cus_123");
    expect(detail.customerEmail).toBe("test@example.com");
    expect(detail.customerName).toBe("Test User");
  });

  it("resolves name from metadata when customer.name is null", async () => {
    await customerCreated(deps)(makeEvent({
      name: null,
      metadata: { customer_name: "Metadata Name" },
    }) as any);

    const detail = JSON.parse(mockEventBridge.send.mock.calls[0][0].input.Entries[0].Detail);
    expect(detail.customerName).toBe("Metadata Name");
  });

  it("uses empty string when no name available", async () => {
    await customerCreated(deps)(makeEvent({ name: null, metadata: {} }) as any);

    const detail = JSON.parse(mockEventBridge.send.mock.calls[0][0].input.Entries[0].Detail);
    expect(detail.customerName).toBe("");
  });

  it("ignores non customer.created events", async () => {
    const event = makeEvent();
    (event.detail as any).type = "customer.updated";

    await customerCreated(deps)(event as any);

    expect(mockEventBridge.send).not.toHaveBeenCalled();
  });

  it("throws on missing data.object", async () => {
    const event = {
      ...makeEvent(),
      detail: { id: "evt_1", type: "customer.created", data: {} },
    };

    await expect(customerCreated(deps)(event as any)).rejects.toThrow(
      "Invalid Stripe event structure: missing data.object",
    );
  });

  it("throws when customer missing id or email", async () => {
    await expect(
      customerCreated(deps)(makeEvent({ id: null, email: null }) as any),
    ).rejects.toThrow("Customer missing required fields");
  });

  it("skips duplicate events via idempotency", async () => {
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: true });

    await customerCreated(deps)(makeEvent() as any);

    expect(mockEventBridge.send).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Customer creation already processed, skipping",
      expect.objectContaining({ customerId: "cus_123" }),
    );
  });
});
