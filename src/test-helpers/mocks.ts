import { vi } from "vitest";

/**
 * Mock for Stripe client
 */
export const createMockStripeClient = () => ({
  customers: {
    update: vi.fn(),
    retrieve: vi.fn(),
    del: vi.fn(),
  },
  subscriptions: {
    list: vi.fn(),
    cancel: vi.fn(),
    update: vi.fn(),
  },
  invoices: {
    list: vi.fn(),
  },
});

/**
 * Mock for EventBridge client
 */
export const createMockEventBridgeClient = () => ({
  send: vi.fn(),
});

/**
 * Mock for Logger
 */
export const createMockLogger = () => ({
  start: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

/**
 * Create a mock Stripe subscriptions list response
 */
export const createSubscriptionsListResponse = (subscriptions: Array<{ id: string; status: string }> = []) => ({
  data: subscriptions,
  has_more: false,
});

/**
 * Create a mock EventBridge put events response
 */
export const createPutEventsResponse = () => ({
  FailedEntryCount: 0,
  Entries: [{ EventId: "test-event-id" }],
});

/**
 * Create a Stripe resource_missing error
 */
export const createStripeNotFoundError = () => {
  const error = new Error("No such customer: cus_test123") as Error & { code: string };
  error.code = "resource_missing";
  return error;
};

/**
 * Generate timestamp helpers
 */
export const generateTimestamp = () => Math.floor(Date.now() / 1000);
