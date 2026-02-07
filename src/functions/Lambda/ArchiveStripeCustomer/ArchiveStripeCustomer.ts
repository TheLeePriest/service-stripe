import type {
  ArchiveStripeCustomerEvent,
  ArchiveStripeCustomerDependencies,
} from "./ArchiveStripeCustomer.types";
import { sendEvent } from "../lib/sendEvent";

export const archiveStripeCustomer =
  ({
    stripeClient,
    eventBridgeClient,
    eventBusName,
    logger,
  }: ArchiveStripeCustomerDependencies) =>
  async (event: ArchiveStripeCustomerEvent): Promise<void> => {
    const { stripeCustomerId, deletionRequestId } = event.detail;

    logger.info("Archiving Stripe customer", {
      stripeCustomerId,
      deletionRequestId,
    });

    try {
      // Cancel all active subscriptions in Stripe (if any remain)
      const subscriptions = await stripeClient.subscriptions.list({
        customer: stripeCustomerId,
        status: "active",
      });

      for (const subscription of subscriptions.data) {
        await stripeClient.subscriptions.cancel(subscription.id, {
          prorate: true,
        });

        logger.info("Cancelled Stripe subscription", {
          subscriptionId: subscription.id,
        });
      }

      // Archive the customer (don't delete for billing compliance)
      // Stripe recommends keeping customer records for tax/audit purposes
      await stripeClient.customers.update(stripeCustomerId, {
        metadata: {
          deleted_at: new Date().toISOString(),
          deletion_request_id: deletionRequestId,
          gdpr_deletion: "true",
        },
        // Clear PII from Stripe
        name: "Deleted Customer",
        email: `deleted-${deletionRequestId}@anonymized.local`,
        phone: "",
        description: "Customer data deleted per GDPR request",
      });

      logger.info("Stripe customer archived successfully", {
        stripeCustomerId,
        deletionRequestId,
      });

      // Emit completion event
      await sendEvent(
        eventBridgeClient,
        [
          {
            Source: "service.stripe",
            DetailType: "StripeCustomerArchived",
            Detail: JSON.stringify({
              stripeCustomerId,
              deletionRequestId,
              archivedAt: Math.floor(Date.now() / 1000),
            }),
            EventBusName: eventBusName,
          },
        ],
        logger,
      );
    } catch (error: unknown) {
      // Handle case where customer doesn't exist
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "resource_missing"
      ) {
        logger.warn("Stripe customer not found, may already be deleted", {
          stripeCustomerId,
          deletionRequestId,
        });
        return;
      }

      logger.error("Failed to archive Stripe customer", {
        stripeCustomerId,
        deletionRequestId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
