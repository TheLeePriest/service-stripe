import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleUncancellation } from "./handleUncancellation";
import {
  DeleteScheduleCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-scheduler";
import type Stripe from "stripe";
import type { SubscriptionUpdatedEvent } from "../../SubscriptionUpdated.types";

vi.mock("@aws-sdk/client-scheduler", async () => {
  const actual = await vi.importActual<
    typeof import("@aws-sdk/client-scheduler")
  >("@aws-sdk/client-scheduler");
  return {
    ...actual,
    DeleteScheduleCommand: vi.fn().mockImplementation((args) => ({ ...args })),
    ResourceNotFoundException: { name: "ResourceNotFoundException" },
  };
});

const mockSend = vi.fn();

const mockSchedulerClient = {
  send: mockSend,
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const makeSubscription = (itemIds: string[]): SubscriptionUpdatedEvent => ({
  id: "sub_123",
  customer: "cus_123",
  status: "active",
  cancel_at_period_end: false,
  createdAt: 1234567890,
  items: {
    data: itemIds.map((id) => ({
      id,
      price: { product: "prod_123", id: "price_123" },
      quantity: 1,
      current_period_end: 1234567890,
      current_period_start: 1234567890,
      metadata: {} as Record<string, unknown>,
    })),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleUncancellation", () => {
  it("deletes the schedule for the subscription", async () => {
    mockSend.mockResolvedValueOnce({});
    const subscription = makeSubscription(["item_1", "item_2"]);

    await handleUncancellation(subscription, mockSchedulerClient, mockLogger);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(DeleteScheduleCommand).toHaveBeenCalledWith({
      Name: "subscription-cancel-sub_123",
    });
  });

  it("logs and skips if schedule not found", async () => {
    const error = { name: ResourceNotFoundException.name };
    mockSend.mockRejectedValueOnce(error);
    const subscription = makeSubscription(["item_1", "item_2"]);

    await handleUncancellation(subscription, mockSchedulerClient, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith("Schedule not found, skipping", {
      scheduleName: "subscription-cancel-sub_123",
    });
  });

  it("throws and logs error for other exceptions", async () => {
    const error = new Error("fail");
    mockSend.mockRejectedValueOnce(error);
    const subscription = makeSubscription(["item_1"]);

    await expect(
      handleUncancellation(subscription, mockSchedulerClient, mockLogger),
    ).rejects.toEqual(error);
    expect(mockLogger.error).toHaveBeenCalledWith("Error deleting schedule", {
      scheduleName: "subscription-cancel-sub_123",
      error: "fail",
    });
  });
});
