import { describe, it, expect, vi, beforeEach } from "vitest";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { subscriptionCreated } from "./SubscriptionCreated";
import type { SubscriptionCreatedEvent, SubscriptionCreatedDependencies } from "./SubscriptionCreated.types";

// Mock the idempotency functions
vi.mock("../lib/idempotency", () => ({
  ensureIdempotency: vi.fn(),
  generateEventId: vi.fn(() => "test-event-id"),
}));

import { ensureIdempotency } from "../lib/idempotency";
const mockEnsureIdempotency = vi.mocked(ensureIdempotency);

// Create mocks using vi.fn() pattern that works in other tests
const mockStripe = {
  customers: { retrieve: vi.fn() },
  products: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn(), update: vi.fn() },
  prices: { retrieve: vi.fn() },
  billing: { meterEvents: { create: vi.fn() } }
};

const mockEventBridge = {
  send: vi.fn()
};

const mockDynamoDB = {
  send: vi.fn()
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  logUsageEvent: vi.fn(),
  logStripeEvent: vi.fn()
};

const dependencies: SubscriptionCreatedDependencies = {
  stripe: mockStripe as SubscriptionCreatedDependencies['stripe'],
  eventBridgeClient: mockEventBridge as SubscriptionCreatedDependencies['eventBridgeClient'],
  eventBusName: "test-bus",
  dynamoDBClient: mockDynamoDB as unknown as SubscriptionCreatedDependencies['dynamoDBClient'],
  idempotencyTableName: "test-table",
  logger: mockLogger as SubscriptionCreatedDependencies['logger']
};

const baseEvent: SubscriptionCreatedEvent = {
  items: {
    data: [
      {
        id: "item_123",
        price: { product: "prod_123", id: "price_123" },
        quantity: 1, // Single quantity to avoid team detection
        current_period_end: 1625097600,
        metadata: { test: "ing" }
      }
    ]
  },
  customer: "cus_123",
  id: "sub_123",
  status: "active",
  cancel_at_period_end: false,
  created: 3333333333,
  metadata: {}
};

describe("subscriptionCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default successful responses
    mockDynamoDB.send.mockResolvedValue({ Item: undefined }); // No existing item
    mockEventBridge.send.mockResolvedValue({});
    mockEnsureIdempotency.mockResolvedValue({ isDuplicate: false });
  });

  it("should process standard subscription successfully", async () => {
    // Arrange
    mockStripe.products.retrieve.mockResolvedValue({ 
      id: "prod_123", 
      name: "Standard Product",
      metadata: {} // No tier = standard subscription
    });
    mockStripe.prices.retrieve.mockResolvedValue({
      id: "price_123",
      unit_amount: 1000,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: {}
    });

    // Act
    const result = await subscriptionCreated(dependencies)(baseEvent);

    // Assert
    expect(result).toEqual({
      success: true,
      subscriptionId: "sub_123",
      customerId: "cus_123",
      isTeamSubscription: false
    });

    // Check EventBridge event was sent
    expect(mockEventBridge.send).toHaveBeenCalledTimes(1);
    const command = mockEventBridge.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutEventsCommand);
    expect(command.input.Entries[0].DetailType).toBe("SubscriptionCreated");
  });

  it("should detect team subscription correctly", async () => {
    // Arrange
    const teamEvent = {
      ...baseEvent,
      items: {
        data: [
          {
            id: "item_123",
            price: { product: "prod_123", id: "price_123" },
            quantity: 2, // Multiple quantity for team detection
            current_period_end: 1625097600,
            metadata: { test: "ing" }
          }
        ]
      }
    };

    mockStripe.products.retrieve.mockResolvedValue({ 
      id: "prod_123", 
      name: "Team Product",
      metadata: { tier: "enterprise" } // Team subscription
    });
    mockStripe.prices.retrieve.mockResolvedValue({
      id: "price_123",
      unit_amount: 1000,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: {}
    });

    // Act
    const result = await subscriptionCreated(dependencies)(teamEvent);

    // Assert
    expect(result).toEqual({
      success: true,
      subscriptionId: "sub_123",
      customerId: "cus_123",
      isTeamSubscription: true,
      teamSize: 2
    });
  });

  it("should handle idempotency correctly", async () => {
    // Arrange - already processed
    mockEnsureIdempotency.mockResolvedValueOnce({ isDuplicate: true });

    // Act
    const result = await subscriptionCreated(dependencies)(baseEvent);

    // Assert
    expect(result).toEqual({
      success: true,
      subscriptionId: "sub_123",
      customerId: "cus_123",
      isTeamSubscription: false,
      alreadyProcessed: true
    });

    // Should not send event or call Stripe APIs
    expect(mockEventBridge.send).not.toHaveBeenCalled();
    expect(mockStripe.products.retrieve).not.toHaveBeenCalled();
    expect(mockStripe.prices.retrieve).not.toHaveBeenCalled();
  });

  it("should handle product retrieval failure", async () => {
    // Arrange
    mockStripe.products.retrieve.mockRejectedValue(new Error("Product not found"));

    // Act & Assert
    await expect(subscriptionCreated(dependencies)(baseEvent))
      .rejects.toThrow("Product not found");
  });

  it("should handle price retrieval failure", async () => {
    // Arrange
    mockStripe.products.retrieve.mockResolvedValue({ 
      id: "prod_123", 
      name: "Test Product",
      metadata: {}
    });
    mockStripe.prices.retrieve.mockRejectedValue(new Error("Price not found"));

    // Act & Assert
    await expect(subscriptionCreated(dependencies)(baseEvent))
      .rejects.toThrow("Price not found");
  });

  it("should handle EventBridge failure", async () => {
    // Arrange
    mockStripe.products.retrieve.mockResolvedValue({ 
      id: "prod_123", 
      name: "Test Product",
      metadata: {}
    });
    mockStripe.prices.retrieve.mockResolvedValue({
      id: "price_123",
      unit_amount: 1000,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: {}
    });
    mockEventBridge.send.mockRejectedValue(new Error("EventBridge error"));

    // Act & Assert
    await expect(subscriptionCreated(dependencies)(baseEvent))
      .rejects.toThrow("EventBridge error");
  });
});
