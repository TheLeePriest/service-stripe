import { describe, it, expect, vi, beforeEach } from "vitest";
import { subscriptionCreated } from "./SubscriptionCreated";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type Stripe from "stripe";
import type { SubscriptionCreatedEvent } from "./SubscriptionCreated.types";

describe("subscriptionCreated", () => {
  const mockUuid = "uuid-123";
  const mockEventBusName = "test-bus";
  const mockSend = vi.fn();
  const mockRetrieveCustomer = vi.fn();
  const mockRetrieveProduct = vi.fn();

  const stripeMock = {
    customers: { retrieve: mockRetrieveCustomer },
    products: { retrieve: mockRetrieveProduct },
  };

  const eventBridgeClientMock = { send: mockSend };

  const dependencies = {
    stripe: stripeMock,
    uuidv4: () => mockUuid,
    eventBridgeClient: eventBridgeClientMock,
    eventBusName: mockEventBusName,
  };

  const baseEvent: SubscriptionCreatedEvent = {
    items: {
      data: [
        {
          price: { product: "prod_123", id: "price_123" },
          quantity: 2,
          current_period_end: 1625097600,
          metadata: { test: "ing" } as Stripe.Metadata,
        },
      ],
    },
    customer: "cus_123",
    id: "sub_123",
    status: "active",
    cancel_at_period_end: false,
    trial_start: 1111111111,
    trial_end: 2222222222,
    created: 3333333333,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should retrieve customer and product, and send event for each item", async () => {
    const mockStripeCustomer = { email: "test@example.com" };
    const mockProduct = { id: "prod_123", name: "Test Product" };

    mockRetrieveCustomer.mockResolvedValue(mockStripeCustomer);
    mockRetrieveProduct.mockResolvedValue(mockProduct);
    mockSend.mockResolvedValue({});

    await subscriptionCreated(dependencies)(baseEvent);

    expect(mockRetrieveCustomer).toHaveBeenCalledWith("cus_123");
    expect(mockRetrieveProduct).toHaveBeenCalledWith("prod_123");
    expect(mockSend).toHaveBeenCalledTimes(1);

    const sentCommand = mockSend.mock.calls[0][0];
    expect(sentCommand).toBeInstanceOf(PutEventsCommand);

    const entries = sentCommand.input.Entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      Source: "service.stripe",
      DetailType: "SubscriptionCreated",
      EventBusName: mockEventBusName,
    });

    const detail = JSON.parse(entries[0].Detail);
    expect(detail).toMatchObject({
      licenseKey: mockUuid,
      stripeSubscriptionId: "sub_123",
      customerEmail: "test@example.com",
      productId: "prod_123",
      productName: "Test Product",
      priceId: "price_123",
      quantity: 2,
      status: "active",
      createdAt: 3333333333,
      cancelAtPeriodEnd: false,
      trialStart: 1111111111,
      trialEnd: 2222222222,
      expiresAt: 1625097600,
      metadata: { test: "ing" },
    });
  });

  it("should throw if stripe.customers.retrieve fails", async () => {
    mockRetrieveCustomer.mockRejectedValue(new Error("Customer not found"));

    await expect(subscriptionCreated(dependencies)(baseEvent)).rejects.toThrow(
      "Failed to retrieve customer: Customer not found",
    );
  });

  it("should throw if stripe.products.retrieve fails", async () => {
    mockRetrieveCustomer.mockResolvedValue({ email: "test@example.com" });
    mockRetrieveProduct.mockRejectedValue(new Error("Product not found"));

    await expect(subscriptionCreated(dependencies)(baseEvent)).rejects.toThrow(
      "Failed to retrieve product: Product not found",
    );
  });

  it("should throw if eventBridgeClient.send fails", async () => {
    mockRetrieveCustomer.mockResolvedValue({ email: "test@example.com" });
    mockRetrieveProduct.mockResolvedValue({
      id: "prod_123",
      name: "Test Product",
    });
    mockSend.mockRejectedValue(new Error("EventBridge error"));

    await expect(subscriptionCreated(dependencies)(baseEvent)).rejects.toThrow(
      "Failed to send event to EventBridge: EventBridge error",
    );
  });
});
