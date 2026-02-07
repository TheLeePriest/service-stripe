import type { HandleRenewal } from "./handleRenewal.types";
import { sendEvent } from "../../../lib/sendEvent";
import { ensureIdempotency, generateEventId } from "../../../lib/idempotency";

export const handleRenewal = async ({
  subscription,
  eventBridgeClient,
  eventBusName,
  logger,
  dynamoDBClient,
  idempotencyTableName,
}: HandleRenewal) => {
  logger.info("Handling renewal for subscription", { subscriptionId: subscription.id });

  const earliestRenewalDate = Math.min(
    ...subscription.items.data.map((item) => item.current_period_start),
  );

  // Generate idempotency key for renewal
  const eventId = generateEventId("subscription-renewed", subscription.id, earliestRenewalDate);
  
  // Check idempotency
  const idempotencyResult = await ensureIdempotency(
    { dynamoDBClient, tableName: idempotencyTableName, logger },
    eventId,
    { 
      subscriptionId: subscription.id, 
      customerId: subscription.customer,
      earliestRenewalDate,
      cancelAtPeriodEnd: subscription.cancel_at_period_end
    }
  );

  if (idempotencyResult.isDuplicate) {
    logger.info("Subscription renewal already processed, skipping", { 
      subscriptionId: subscription.id,
      eventId 
    });
    return;
  }

  try {
    await sendEvent(
      eventBridgeClient,
      [
        {
          EventBusName: eventBusName,
          Source: "service.stripe",
          DetailType: "SubscriptionRenewed",
          Detail: JSON.stringify({
            stripeSubscriptionId: subscription.id,
            stripeCustomerId: subscription.customer,
            earliestRenewalDate: earliestRenewalDate,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            items: subscription.items.data.map((item) => ({
              itemId: item.id,
              quantity: item.quantity,
              started: item.current_period_start,
              expiresAt: item.current_period_end,
              productId: item.price.product,
              priceId: item.price.id,
              metadata: {
                ...(item.price.metadata || {}),
                ...(item.price.recurring?.usage_type === 'metered' ? { metered: 'true', usage_type: 'metered' } : {}),
              },
            })),
          }),
        },
      ],
      logger,
    );

    logger.info("Sent SubscriptionRenewed event", { subscriptionId: subscription.id });
  } catch (err) {
    logger.error("Error sending SubscriptionRenewed event", {
      subscriptionId: subscription.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};
