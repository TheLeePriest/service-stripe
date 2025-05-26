import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleUncancellation } from "./handleUncancellation";
import {
  DeleteScheduleCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-scheduler";
import type Stripe from "stripe";

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

const makeSubscription = (itemIds: string[]): Stripe.Subscription =>
  ({
    id: "sub_123",
    items: {
      data: itemIds.map((id) => ({ id }) as Partial<Stripe.SubscriptionItem>),
    },
  }) as Stripe.Subscription;

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
      Name: "subscription-cancel-sub_123-item_1",
    });
    expect(DeleteScheduleCommand).toHaveBeenCalledWith({
      Name: "subscription-cancel-sub_123-item_2",
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
      "Schedule subscription-cancel-sub_123-item_1 not found; skipping.",
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
      "Error deleting schedule subscription-cancel-sub_123-item_1:",
      error,
    );

    errorSpy.mockRestore();
  });
});
