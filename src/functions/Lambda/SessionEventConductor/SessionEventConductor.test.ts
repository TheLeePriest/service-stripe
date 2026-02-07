import { describe, it, expect, vi, beforeEach } from "vitest";
import { sessionEventConductor } from "./SessionEventConductor";
import type { SessionEventConductorDependencies } from "./SessionEventConductor.types";

vi.mock("../SessionCompleted/SessionCompleted", () => ({
  sessionCompleted: vi.fn(() => vi.fn()),
}));

import { sessionCompleted } from "../SessionCompleted/SessionCompleted";
const mockSessionCompleted = vi.mocked(sessionCompleted);
const mockSessionCompletedHandler = vi.fn();

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

const deps: SessionEventConductorDependencies = {
  stripe: mockStripe as unknown as SessionEventConductorDependencies["stripe"],
  eventBridgeClient: mockEventBridge as unknown as SessionEventConductorDependencies["eventBridgeClient"],
  eventBusName: "test-bus",
  dynamoDBClient: mockDynamoDB as unknown as SessionEventConductorDependencies["dynamoDBClient"],
  idempotencyTableName: "test-table",
  logger: mockLogger as SessionEventConductorDependencies["logger"],
};

const makeEvent = (sessionOverrides: Record<string, unknown> = {}) => ({
  id: "evt-1",
  source: "aws.partner/stripe.com",
  "detail-type": "checkout.session.completed",
  detail: {
    id: "evt_stripe_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_123",
        mode: "subscription",
        customer: "cus_123",
        customer_details: { email: "test@example.com", name: "Test User" },
        subscription: "sub_123",
        metadata: {},
        ...sessionOverrides,
      },
    },
  },
  time: "2025-01-01T00:00:00Z",
  region: "eu-west-2",
  account: "123456789",
  version: "0",
  resources: [],
});

describe("sessionEventConductor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionCompleted.mockReturnValue(mockSessionCompletedHandler);
    mockSessionCompletedHandler.mockResolvedValue(undefined);
  });

  it("delegates to sessionCompleted with session data", async () => {
    await sessionEventConductor(deps)(makeEvent() as any);

    expect(mockSessionCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        stripe: deps.stripe,
        eventBridgeClient: deps.eventBridgeClient,
        eventBusName: "test-bus",
        dynamoDBClient: deps.dynamoDBClient,
        idempotencyTableName: "test-table",
        logger: deps.logger,
      }),
    );
    expect(mockSessionCompletedHandler).toHaveBeenCalledTimes(1);
    expect(mockSessionCompletedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        object: expect.objectContaining({ id: "cs_123" }),
      }),
    );
  });

  it("parses resourcesAnalyzed from metadata", async () => {
    await sessionEventConductor(deps)(makeEvent({ metadata: { resourcesAnalyzed: "5" } }) as any);

    expect(mockSessionCompletedHandler).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Extracted session event detail",
      expect.objectContaining({ resourcesAnalyzed: 5 }),
    );
  });

  it("defaults resourcesAnalyzed to 1 when not in metadata", async () => {
    await sessionEventConductor(deps)(makeEvent() as any);

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Extracted session event detail",
      expect.objectContaining({ resourcesAnalyzed: 1 }),
    );
  });

  it("throws when session missing customer_details email", async () => {
    const event = makeEvent({ customer_details: { email: null } });

    await expect(sessionEventConductor(deps)(event as any)).rejects.toThrow(
      "Session event missing required fields",
    );
  });

  it("throws when session missing customer", async () => {
    const event = makeEvent({ customer: null });

    await expect(sessionEventConductor(deps)(event as any)).rejects.toThrow(
      "Session event missing required fields",
    );
  });

  it("re-throws errors from sessionCompleted", async () => {
    mockSessionCompletedHandler.mockRejectedValue(new Error("downstream failure"));

    await expect(sessionEventConductor(deps)(makeEvent() as any)).rejects.toThrow(
      "downstream failure",
    );
  });

  it("handles NaN resourcesAnalyzed gracefully", async () => {
    await sessionEventConductor(deps)(makeEvent({ metadata: { resourcesAnalyzed: "not-a-number" } }) as any);

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Extracted session event detail",
      expect.objectContaining({ resourcesAnalyzed: 1 }),
    );
  });
});
