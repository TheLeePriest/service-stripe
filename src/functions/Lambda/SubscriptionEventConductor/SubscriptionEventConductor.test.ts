import { describe, it, expect, vi, beforeEach } from "vitest";
import { subscriptionEventConductor } from "./SubscriptionEventConductor";
import { subscriptionCreated } from "../SubscriptionCreated/SubscriptionCreated";
import { subscriptionUpdated } from "../SubscriptionUpdated/SubscriptionUpdated";
import { subscriptionDeleted } from "../SubscriptionDeleted/SubscriptionDeleted";
import type { EventBridgeEvent } from "aws-lambda";
import type { StripeEventBridgeDetail } from "./SubscriptionEventConductor.types";
import type Stripe from "stripe";

vi.mock("../SubscriptionCreated/SubscriptionCreated");
const mockSubscriptionCreated = vi.mocked(subscriptionCreated);
vi.mock("../SubscriptionUpdated/SubscriptionUpdated");
const mockSubscriptionUpdated = vi.mocked(subscriptionUpdated);
vi.mock("../SubscriptionDeleted/SubscriptionDeleted");
const mockSubscriptionDeleted = vi.mocked(subscriptionDeleted);

const mockCustomerRetrieve = vi.fn();
const mockProductRetrieve = vi.fn();
const mockEventBridgeSend = vi.fn();
const mockSchedulerSend = vi.fn();

const baseDeps = {
  stripe: {
    customers: {
      retrieve: mockCustomerRetrieve,
    },
    products: {
      retrieve: mockProductRetrieve,
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
  },
  eventBridgeClient: {
    send: mockEventBridgeSend,
  },
  uuidv4: vi.fn(),
  eventBusName: "bus",
  eventBusArn: "arn:bus",
  eventBusSchedulerRoleArn: "arn:role",
  schedulerClient: {
    send: mockSchedulerSend,
  },
};

const makeEvent = (
  type: string,
  subscriptionOverride: Record<string, unknown> = {},
): EventBridgeEvent<string, StripeEventBridgeDetail> => {
  const testSub = {
    items: { data: [] },
    created: Math.floor(Date.now() / 1000),
    ...subscriptionOverride,
  };
  return {
    version: "1.0",
    id: "evt_1",
    "detail-type": "Stripe Event",
    source: "stripe",
    account: "",
    time: new Date().toISOString(),
    region: "us-east-1",
    resources: [],
    detail: {
      id: "evt_detail_1",
      object: "event",
      api_version: "2022-11-15",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 1,
      request: { id: "req_1", idempotency_key: null },
      type,
      data: {
        object: testSub as unknown as Stripe.Subscription,
      },
    },
  };
};

describe("subscriptionEventConductor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls subscriptionCreated for customer.subscription.created", async () => {
    const mockHandler = vi.fn();
    mockSubscriptionCreated.mockReturnValueOnce(mockHandler);

    const handler = subscriptionEventConductor(baseDeps);
    const event = makeEvent("customer.subscription.created", {
      id: "sub_123",
      items: { data: [] },
      customer: "cus_123",
      status: "active",
      cancel_at_period_end: false,
      created: Math.floor(Date.now() / 1000),
    });

    await handler(event);

    expect(mockSubscriptionCreated).toHaveBeenCalledWith({
      stripe: baseDeps.stripe,
      uuidv4: baseDeps.uuidv4,
      eventBridgeClient: baseDeps.eventBridgeClient,
      eventBusName: baseDeps.eventBusName,
    });
    expect(mockHandler).toHaveBeenCalledWith({
      cancel_at_period_end: false,
      created: expect.any(Number),
      customer: "cus_123",
      id: "sub_123",
      items: { data: [] },
      status: "active",
    });
  });

  it("calls subscriptionUpdated for customer.subscription.updated", async () => {
    const mockHandler = vi.fn();
    mockSubscriptionUpdated.mockReturnValueOnce(mockHandler);

    const handler = subscriptionEventConductor(baseDeps);
    const subscriptionOverride = {
      id: "sub_123",
      items: { data: [] },
      customer: "cus_123",
      status: "active",
      cancel_at_period_end: false,
      cancel_at: null,
    };
    const event = makeEvent(
      "customer.subscription.updated",
      subscriptionOverride,
    );

    await handler(event);

    expect(mockSubscriptionUpdated).toHaveBeenCalledWith({
      eventBridgeClient: baseDeps.eventBridgeClient,
      eventBusArn: baseDeps.eventBusArn,
      eventBusSchedulerRoleArn: baseDeps.eventBusSchedulerRoleArn,
      eventBusName: baseDeps.eventBusName,
      schedulerClient: baseDeps.schedulerClient,
    });

    expect(mockHandler).toHaveBeenCalledWith({
      cancel_at_period_end: false,
      customer: "cus_123",
      id: "sub_123",
      items: { data: [] },
      status: "active",
    });
  });

  it("calls subscriptionDeleted for customer.subscription.deleted", async () => {
    const mockHandler = vi.fn();
    mockSubscriptionDeleted.mockReturnValueOnce(mockHandler);

    const handler = subscriptionEventConductor(baseDeps);
    const event = makeEvent("customer.subscription.deleted", {
      id: "sub_123",
      customer: "cus_123",
      status: "active",
      cancel_at_period_end: false,
      items: { data: [] },
    });

    await handler(event);

    expect(mockSubscriptionDeleted).toHaveBeenCalledWith({
      stripe: baseDeps.stripe,
      eventBridgeClient: baseDeps.eventBridgeClient,
      eventBusName: baseDeps.eventBusName,
    });

    expect(mockHandler).toHaveBeenCalledWith({
      id: "sub_123",
      customer: "cus_123",
      status: "active",
    });
  });

  it("logs for unhandled event types", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const handler = subscriptionEventConductor(baseDeps);
    const event = makeEvent("unknown.event.type");

    await handler(event);

    expect(logSpy).toHaveBeenCalledWith(
      `Unhandled event type: ${event.detail.type}`,
    );

    logSpy.mockRestore();
  });
});
