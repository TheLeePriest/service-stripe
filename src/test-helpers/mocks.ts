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
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

/**
 * Create a mock Stripe subscriptions list response
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createSubscriptionsListResponse = (subscriptions: Array<{ id: string; status: string }> = []): any => ({
  data: subscriptions,
  has_more: false,
  object: "list",
  url: "/v1/subscriptions",
});

/**
 * Create a mock EventBridge put events response
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createPutEventsResponse = (): any => ({
  FailedEntryCount: 0,
  Entries: [{ EventId: "test-event-id" }],
  $metadata: {},
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
