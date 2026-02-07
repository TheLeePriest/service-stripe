import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendQuantityChangeToStripe } from "./SendQuantityChangeToStripe";
import type { SendQuantityChangeToStripeDependencies } from "./SendQuantityChangeToStripe.types";

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

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const deps: SendQuantityChangeToStripeDependencies = {
  stripeClient: mockStripe as SendQuantityChangeToStripeDependencies["stripeClient"],
  logger: mockLogger as SendQuantityChangeToStripeDependencies["logger"],
};

const makeEvent = (detailType: "LicenseCancelled" | "LicenseUncancelled") => ({
  id: "evt-1",
  source: "service.license",
  "detail-type": detailType,
  detail: {
    itemId: "si_123",
    stripeSubscriptionId: "sub_123",
  },
  time: "2025-01-01T00:00:00Z",
  region: "eu-west-2",
  account: "123456789",
  version: "0",
  resources: [],
});

describe("sendQuantityChangeToStripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_123",
      items: {
        data: [{ id: "si_123", quantity: 5 }],
      },
    });
    mockStripe.subscriptions.update.mockResolvedValue({});
  });

  it("increments quantity for LicenseUncancelled", async () => {
    await sendQuantityChangeToStripe(deps)(makeEvent("LicenseUncancelled") as any);

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      { items: [{ id: "si_123", quantity: 6 }] },
      { idempotencyKey: "quantity-change-sub_123-si_123-LicenseUncancelled-5" },
    );
  });

  it("decrements quantity for LicenseCancelled", async () => {
    await sendQuantityChangeToStripe(deps)(makeEvent("LicenseCancelled") as any);

    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_123",
      { items: [{ id: "si_123", quantity: 4 }] },
      { idempotencyKey: "quantity-change-sub_123-si_123-LicenseCancelled-5" },
    );
  });

  it("throws when subscription item not found", async () => {
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_123",
      items: { data: [{ id: "si_other", quantity: 5 }] },
    });

    await expect(
      sendQuantityChangeToStripe(deps)(makeEvent("LicenseUncancelled") as any),
    ).rejects.toThrow("Failed to process LicenseUncancelled");
  });

  it("throws and logs when Stripe update fails", async () => {
    mockStripe.subscriptions.update.mockRejectedValue(new Error("Rate limit"));

    await expect(
      sendQuantityChangeToStripe(deps)(makeEvent("LicenseCancelled") as any),
    ).rejects.toThrow("Failed to process LicenseCancelled");

    expect(mockLogger.error).toHaveBeenCalledWith(
      "Error processing license quantity change",
      expect.objectContaining({ error: "Rate limit" }),
    );
  });
});
