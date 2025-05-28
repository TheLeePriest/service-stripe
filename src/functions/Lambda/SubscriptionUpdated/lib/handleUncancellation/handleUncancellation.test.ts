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

const makeSubscription = (itemIds: string[]): SubscriptionUpdatedEvent => ({
  id: "sub_123",
  customer: "cus_123",
  status: "active",
  cancel_at_period_end: false,
  items: {
    data: itemIds.map((id) => ({
      id,
      price: { product: "prod_123", id: "price_123" },
      quantity: 1,
      current_period_end: 1234567890,
      metadata: {},
    })),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleUncancellation", () => {
  it("deletes all schedules for subscription items", async () => {
    mockSend.mockResolvedValue({});
    const subscription = makeSubscription(["item_1", "item_2"]);

    await handleUncancellation(subscription, mockSchedulerClient);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(DeleteScheduleCommand).toHaveBeenCalledWith({
      Name: "subscription-cancel-sub_123",
    });
    expect(DeleteScheduleCommand).toHaveBeenCalledWith({
      Name: "subscription-cancel-sub_123",
    });
  });

  it("logs and skips if schedule not found", async () => {
    const error = { name: ResourceNotFoundException.name };
    mockSend.mockRejectedValueOnce(error);
    mockSend.mockResolvedValueOnce({});
    const subscription = makeSubscription(["item_1", "item_2"]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleUncancellation(subscription, mockSchedulerClient);

    expect(logSpy).toHaveBeenCalledWith(
      "Schedule subscription-cancel-sub_123 not found; skipping.",
    );
    logSpy.mockRestore();
  });

  it("throws and logs error for other exceptions", async () => {
    const error = { name: "OtherError", message: "fail" };
    mockSend.mockRejectedValueOnce(error);
    const subscription = makeSubscription(["item_1"]);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      handleUncancellation(subscription, mockSchedulerClient),
    ).rejects.toEqual(error);
    expect(errorSpy).toHaveBeenCalledWith(
      "Error deleting schedule subscription-cancel-sub_123:",
      error,
    );

    errorSpy.mockRestore();
  });
});
