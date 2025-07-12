import { describe, it, expect } from "vitest";
import { determineSubscriptionState } from "./determineSubscriptionState";
import type {
  SubscriptionUpdatedEvent,
  SubscriptionState,
} from "../../SubscriptionUpdated.types";

// 1. Use `satisfies` to ensure baseEvent matches the shape exactly
const baseEvent = {
  id: "sub_123",
  customer: "cus_123",
  status: "active",
  cancel_at_period_end: false,
  cancel_at: null,
  createdAt: 1234567890,
  previousAttributes: {},
  items: {
    data: [
      {
        id: "item_1",
        price: { product: "prod_123", id: "price_123" },
        quantity: 2,
        current_period_end: 1234567890,
        current_period_start: 1234567890,
        metadata: {},
      },
    ],
  },
} satisfies SubscriptionUpdatedEvent;

describe("determineSubscriptionState", () => {
  it("returns QUANTITY_CHANGED when quantity changes", () => {
    const event = {
      ...baseEvent,
      items: {
        data: [
          {
            id: "item_1",
            price: { product: "prod_123", id: "price_123" },
            quantity: 2,
            current_period_end: 1234567890,
            current_period_start: 1234567890,
            metadata: {},
          },
        ],
      },
      previousAttributes: {
        items: {
          object: "list",
          data: [
            {
              id: "item_1",
              price: { product: "prod_123", id: "price_123" },
              quantity: 1,
              current_period_end: 1234567890,
              current_period_start: 1234567890,
              metadata: {},
            },
          ],
          has_more: false,
          url: "/v1/subscription_items",
        },
      },
    } as SubscriptionUpdatedEvent;
    expect(determineSubscriptionState(event)).toBe("QUANTITY_CHANGED");
  });

  it("returns CANCELLING when cancel_at_period_end is true and status is active", () => {
    const event = {
      ...baseEvent,
      cancel_at_period_end: true,
      status: "active",
      previousAttributes: {},
    } as SubscriptionUpdatedEvent;
    expect(determineSubscriptionState(event)).toBe("CANCELLING");
  });

  it("returns UNCANCELLING when cancel_at is removed", () => {
    const event = {
      ...baseEvent,
      cancel_at: null,
      previousAttributes: { cancel_at: 123456789 },
    } as SubscriptionUpdatedEvent;
    expect(determineSubscriptionState(event)).toBe("UNCANCELLING");
  });

  it("returns UNCANCELLING when cancel_at_period_end changes from true to false", () => {
    const event = {
      ...baseEvent,
      cancel_at_period_end: false,
      previousAttributes: { cancel_at_period_end: true },
    } as SubscriptionUpdatedEvent;
    expect(determineSubscriptionState(event)).toBe("UNCANCELLING");
  });

  it("returns OTHER_UPDATE for unrelated changes", () => {
    const event = {
      ...baseEvent,
      items: {
        data: [
          {
            id: "item_1",
            price: { product: "prod_123", id: "price_123" },
            quantity: 1,
            current_period_end: 1234567890,
            current_period_start: 1234567890,
            metadata: {},
          },
        ],
      },
      previousAttributes: {},
    } as SubscriptionUpdatedEvent;
    expect(determineSubscriptionState(event)).toBe("OTHER_UPDATE");
  });

  it("returns OTHER_UPDATE when previousQuantity is undefined", () => {
    const event = {
      ...baseEvent,
      items: {
        data: [
          {
            id: "item_1",
            price: { product: "prod_123", id: "price_123" },
            quantity: 1,
            current_period_end: 1234567890,
            current_period_start: 1234567890,
            metadata: {},
          },
        ],
      },
      previousAttributes: {},
    } as SubscriptionUpdatedEvent;
    expect(determineSubscriptionState(event)).toBe("OTHER_UPDATE");
  });
});
