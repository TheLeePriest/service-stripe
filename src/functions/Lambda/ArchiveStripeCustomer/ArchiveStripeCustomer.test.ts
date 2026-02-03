import { describe, it, expect, vi, beforeEach } from "vitest";
import { archiveStripeCustomer } from "./ArchiveStripeCustomer";
import type {
  ArchiveStripeCustomerDependencies,
  ArchiveStripeCustomerEvent,
} from "./ArchiveStripeCustomer.types";
import {
  createMockStripeClient,
  createMockEventBridgeClient,
  createMockLogger,
  createSubscriptionsListResponse,
  createPutEventsResponse,
  createStripeNotFoundError,
} from "../../../test-helpers/mocks";

describe("ArchiveStripeCustomer", () => {
  let handler: ReturnType<typeof archiveStripeCustomer>;
  let mockDependencies: ArchiveStripeCustomerDependencies;

  const createEvent = (overrides: Partial<ArchiveStripeCustomerEvent["detail"]> = {}): ArchiveStripeCustomerEvent => ({
    detail: {
      stripeCustomerId: "cus_test123",
      deletionRequestId: "del_req_123",
      ...overrides,
    },
  });

  beforeEach(() => {
    mockDependencies = {
      stripeClient: createMockStripeClient() as unknown as ArchiveStripeCustomerDependencies["stripeClient"],
      eventBridgeClient: createMockEventBridgeClient(),
      eventBusName: "test-event-bus",
      logger: createMockLogger(),
    };

    handler = archiveStripeCustomer(mockDependencies);
  });

  describe("Successful archival", () => {
    it("should archive customer with no active subscriptions", async () => {
      vi.mocked(mockDependencies.stripeClient.subscriptions.list).mockResolvedValue(
        createSubscriptionsListResponse([]),
      );
      vi.mocked(mockDependencies.stripeClient.customers.update).mockResolvedValue({});
      vi.mocked(mockDependencies.eventBridgeClient.send).mockResolvedValue(createPutEventsResponse());

      await handler(createEvent());

      // Should update customer with anonymized data
      expect(mockDependencies.stripeClient.customers.update).toHaveBeenCalledWith(
        "cus_test123",
        expect.objectContaining({
          name: "Deleted Customer",
          email: expect.stringContaining("deleted-"),
          phone: "",
          description: "Customer data deleted per GDPR request",
          metadata: expect.objectContaining({
            gdpr_deletion: "true",
            deletion_request_id: "del_req_123",
          }),
        }),
      );

      // Should emit completion event
      expect(mockDependencies.eventBridgeClient.send).toHaveBeenCalledTimes(1);
    });

    it("should cancel active subscriptions before archiving", async () => {
      const activeSubscriptions = [
        { id: "sub_1", status: "active" },
        { id: "sub_2", status: "active" },
      ];

      vi.mocked(mockDependencies.stripeClient.subscriptions.list).mockResolvedValue(
        createSubscriptionsListResponse(activeSubscriptions),
      );
      vi.mocked(mockDependencies.stripeClient.subscriptions.cancel).mockResolvedValue({});
      vi.mocked(mockDependencies.stripeClient.customers.update).mockResolvedValue({});
      vi.mocked(mockDependencies.eventBridgeClient.send).mockResolvedValue(createPutEventsResponse());

      await handler(createEvent());

      // Should cancel each subscription
      expect(mockDependencies.stripeClient.subscriptions.cancel).toHaveBeenCalledTimes(2);
      expect(mockDependencies.stripeClient.subscriptions.cancel).toHaveBeenCalledWith(
        "sub_1",
        { prorate: true },
      );
      expect(mockDependencies.stripeClient.subscriptions.cancel).toHaveBeenCalledWith(
        "sub_2",
        { prorate: true },
      );

      // Should still archive customer after cancellations
      expect(mockDependencies.stripeClient.customers.update).toHaveBeenCalled();
    });

    it("should emit StripeCustomerArchived event on success", async () => {
      vi.mocked(mockDependencies.stripeClient.subscriptions.list).mockResolvedValue(
        createSubscriptionsListResponse([]),
      );
      vi.mocked(mockDependencies.stripeClient.customers.update).mockResolvedValue({});
      vi.mocked(mockDependencies.eventBridgeClient.send).mockResolvedValue(createPutEventsResponse());

      await handler(createEvent());

      expect(mockDependencies.eventBridgeClient.send).toHaveBeenCalledTimes(1);
      // Verify the event was sent to the correct event bus
      const call = vi.mocked(mockDependencies.eventBridgeClient.send).mock.calls[0][0];
      expect(call).toBeDefined();
    });
  });

  describe("Customer not found handling", () => {
    it("should handle resource_missing error gracefully", async () => {
      vi.mocked(mockDependencies.stripeClient.subscriptions.list).mockRejectedValue(
        createStripeNotFoundError(),
      );

      // Should not throw
      await expect(handler(createEvent())).resolves.not.toThrow();

      // Should log warning
      expect(mockDependencies.logger.warn).toHaveBeenCalledWith(
        "Stripe customer not found, may already be deleted",
        expect.objectContaining({
          stripeCustomerId: "cus_test123",
        }),
      );

      // Should not emit completion event
      expect(mockDependencies.eventBridgeClient.send).not.toHaveBeenCalled();
    });
  });

  describe("Error handling", () => {
    it("should throw on Stripe API error", async () => {
      vi.mocked(mockDependencies.stripeClient.subscriptions.list).mockRejectedValue(
        new Error("Stripe API error"),
      );

      await expect(handler(createEvent())).rejects.toThrow("Stripe API error");

      expect(mockDependencies.logger.error).toHaveBeenCalledWith(
        "Failed to archive Stripe customer",
        expect.objectContaining({
          stripeCustomerId: "cus_test123",
        }),
      );
    });

    it("should throw on subscription cancellation error", async () => {
      vi.mocked(mockDependencies.stripeClient.subscriptions.list).mockResolvedValue(
        createSubscriptionsListResponse([{ id: "sub_1", status: "active" }]),
      );
      vi.mocked(mockDependencies.stripeClient.subscriptions.cancel).mockRejectedValue(
        new Error("Cancellation failed"),
      );

      await expect(handler(createEvent())).rejects.toThrow("Cancellation failed");
    });

    it("should throw on customer update error", async () => {
      vi.mocked(mockDependencies.stripeClient.subscriptions.list).mockResolvedValue(
        createSubscriptionsListResponse([]),
      );
      vi.mocked(mockDependencies.stripeClient.customers.update).mockRejectedValue(
        new Error("Update failed"),
      );

      await expect(handler(createEvent())).rejects.toThrow("Update failed");
    });
  });

  describe("Logging", () => {
    it("should log start and success", async () => {
      vi.mocked(mockDependencies.stripeClient.subscriptions.list).mockResolvedValue(
        createSubscriptionsListResponse([]),
      );
      vi.mocked(mockDependencies.stripeClient.customers.update).mockResolvedValue({});
      vi.mocked(mockDependencies.eventBridgeClient.send).mockResolvedValue(createPutEventsResponse());

      await handler(createEvent());

      expect(mockDependencies.logger.info).toHaveBeenCalledWith(
        "Archiving Stripe customer",
        expect.objectContaining({
          stripeCustomerId: "cus_test123",
        }),
      );

      expect(mockDependencies.logger.info).toHaveBeenCalledWith(
        "Stripe customer archived successfully",
        expect.any(Object),
      );
    });

    it("should log each subscription cancellation", async () => {
      vi.mocked(mockDependencies.stripeClient.subscriptions.list).mockResolvedValue(
        createSubscriptionsListResponse([{ id: "sub_1", status: "active" }]),
      );
      vi.mocked(mockDependencies.stripeClient.subscriptions.cancel).mockResolvedValue({});
      vi.mocked(mockDependencies.stripeClient.customers.update).mockResolvedValue({});
      vi.mocked(mockDependencies.eventBridgeClient.send).mockResolvedValue(createPutEventsResponse());

      await handler(createEvent());

      expect(mockDependencies.logger.info).toHaveBeenCalledWith(
        "Cancelled Stripe subscription",
        expect.objectContaining({
          subscriptionId: "sub_1",
        }),
      );
    });
  });

  describe("GDPR compliance", () => {
    it("should set GDPR metadata on customer", async () => {
      vi.mocked(mockDependencies.stripeClient.subscriptions.list).mockResolvedValue(
        createSubscriptionsListResponse([]),
      );
      vi.mocked(mockDependencies.stripeClient.customers.update).mockResolvedValue({});
      vi.mocked(mockDependencies.eventBridgeClient.send).mockResolvedValue(createPutEventsResponse());

      await handler(createEvent());

      expect(mockDependencies.stripeClient.customers.update).toHaveBeenCalledWith(
        "cus_test123",
        expect.objectContaining({
          metadata: expect.objectContaining({
            gdpr_deletion: "true",
            deleted_at: expect.any(String),
          }),
        }),
      );
    });

    it("should anonymize customer email with deletion request ID", async () => {
      vi.mocked(mockDependencies.stripeClient.subscriptions.list).mockResolvedValue(
        createSubscriptionsListResponse([]),
      );
      vi.mocked(mockDependencies.stripeClient.customers.update).mockResolvedValue({});
      vi.mocked(mockDependencies.eventBridgeClient.send).mockResolvedValue(createPutEventsResponse());

      await handler(createEvent({ deletionRequestId: "unique-del-req" }));

      expect(mockDependencies.stripeClient.customers.update).toHaveBeenCalledWith(
        "cus_test123",
        expect.objectContaining({
          email: "deleted-unique-del-req@anonymized.local",
        }),
      );
    });
  });
});
