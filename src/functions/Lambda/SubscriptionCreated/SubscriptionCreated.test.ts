import { describe, it, expect, vi, beforeEach } from "vitest";
import { subscriptionCreated } from "./SubscriptionCreated";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type Stripe from "stripe";
import type { SubscriptionCreatedEvent } from "./SubscriptionCreated.types";

describe("subscriptionCreated", () => {
  const mockUuid = "uuid-123";
  const mockEventBusName = "test-bus";
  const mockIdempotencyTableName = "test-idempotency-table";
  const mockSend = vi.fn();
  const mockRetrieveCustomer = vi.fn();
  const mockRetrieveProduct = vi.fn();
  const mockDynamoDBSend = vi.fn();

  const mockRetrievePrice = vi.fn();
  const stripeMock = {
    customers: { retrieve: mockRetrieveCustomer },
    products: { retrieve: mockRetrieveProduct },
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
    prices: { list: vi.fn(), retrieve: mockRetrievePrice },
    billing: {
      meterEvents: {
        create: vi.fn(),
      },
    },
  };

  const eventBridgeClientMock = { send: mockSend };
  const dynamoDBClientMock = { send: mockDynamoDBSend } as unknown as DynamoDBClient;

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    logUsageEvent: vi.fn(),
    logStripeEvent: vi.fn(),
  };

  const dependencies = {
    stripe: stripeMock,
    uuidv4: () => mockUuid,
    eventBridgeClient: eventBridgeClientMock,
    eventBusName: mockEventBusName,
    dynamoDBClient: dynamoDBClientMock,
    idempotencyTableName: mockIdempotencyTableName,
    logger: mockLogger,
  };

  const baseEvent: SubscriptionCreatedEvent = {
    items: {
      data: [
        {
          id: "item_123",
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
    mockRetrieveCustomer.mockResolvedValue(mockStripeCustomer);
    // Use mockImplementation to return the correct id for each call
    mockRetrieveProduct.mockImplementation(async (id) => ({ id, name: "Test Product" }));
    mockRetrievePrice.mockImplementation(async (id) => ({
      id,
      unit_amount: 1000,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: {},
    }));
    mockSend.mockResolvedValue({});
    // Mock DynamoDB responses for idempotency - PutItem succeeds (no existing item)
    mockDynamoDBSend.mockResolvedValueOnce({});

    await subscriptionCreated(dependencies)(baseEvent);

    expect(mockRetrieveCustomer).toHaveBeenCalledWith("cus_123");
    expect(mockRetrieveProduct).toHaveBeenCalledWith("prod_123");
    expect(mockRetrievePrice).toHaveBeenCalledWith("price_123");
    
    // We now send SubscriptionCreated + LicenseCreated events (2 licenses for quantity=2)
    expect(mockSend).toHaveBeenCalledTimes(2);

    // First call should be SubscriptionCreated
    const subscriptionCommand = mockSend.mock.calls[0][0];
    expect(subscriptionCommand).toBeInstanceOf(PutEventsCommand);

    const subscriptionEntries = subscriptionCommand.input.Entries;
    expect(subscriptionEntries).toHaveLength(1);
    expect(subscriptionEntries[0]).toMatchObject({
      Source: "service.stripe",
      DetailType: "SubscriptionCreated",
      EventBusName: mockEventBusName,
    });

    // Second call should be LicenseCreated events (batch of 2)
    const licenseCommand = mockSend.mock.calls[1][0];
    expect(licenseCommand).toBeInstanceOf(PutEventsCommand);

    const licenseEntries = licenseCommand.input.Entries;
    expect(licenseEntries).toHaveLength(2); // 2 licenses for quantity=2
    expect(licenseEntries[0]).toMatchObject({
      Source: "service.stripe",
      DetailType: "LicenseCreated",
      EventBusName: mockEventBusName,
    });
    expect(licenseEntries[1]).toMatchObject({
      Source: "service.stripe",
      DetailType: "LicenseCreated",
      EventBusName: mockEventBusName,
    });

    const detail = JSON.parse(subscriptionEntries[0].Detail);
    expect(detail).toMatchObject({
      stripeSubscriptionId: "sub_123",
      stripeCustomerId: "cus_123",
      customerEmail: "test@example.com",
      items: [
        {
          itemId: "item_123",
          productId: "prod_123",
          productName: "Test Product",
          priceId: "price_123",
          priceData: {
            unitAmount: 1000,
            currency: "usd",
            recurring: { interval: "month" },
            metadata: {},
          },
          quantity: 2,
          expiresAt: 1625097600,
          metadata: { test: "ing" },
        },
      ],
      status: "active",
      createdAt: 3333333333,
      cancelAtPeriodEnd: false,
      trialStart: 1111111111,
      trialEnd: 2222222222,
    });
  });

  it("should throw if stripe.customers.retrieve fails", async () => {
    mockRetrieveCustomer.mockRejectedValue(new Error("Customer not found"));
    // Mock DynamoDB responses for idempotency - PutItem succeeds (no existing item)
    mockDynamoDBSend.mockResolvedValueOnce({});

    await expect(subscriptionCreated(dependencies)(baseEvent)).rejects.toThrow(
      "Customer not found",
    );
  });

  it("should throw if stripe.products.retrieve fails", async () => {
    mockRetrieveCustomer.mockResolvedValue({ email: "test@example.com" });
    mockRetrieveProduct.mockRejectedValue(new Error("Product not found"));
    // Mock DynamoDB responses for idempotency - PutItem succeeds (no existing item)
    mockDynamoDBSend.mockResolvedValueOnce({});

    await expect(subscriptionCreated(dependencies)(baseEvent)).rejects.toThrow(
      "Product not found",
    );
  });

  it("should throw if eventBridgeClient.send fails", async () => {
    mockRetrieveCustomer.mockResolvedValue({ email: "test@example.com" });
    mockRetrieveProduct.mockImplementation(async (id) => ({ id, name: "Test Product" }));
    mockRetrievePrice.mockImplementation(async (id) => ({
      id,
      unit_amount: 1000,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: {},
    }));
    mockSend.mockRejectedValue(new Error("EventBridge error"));
    // Mock DynamoDB responses for idempotency - PutItem succeeds (no existing item)
    mockDynamoDBSend.mockResolvedValueOnce({});

    await expect(subscriptionCreated(dependencies)(baseEvent)).rejects.toThrow(
      "EventBridge error",
    );
  });
});
