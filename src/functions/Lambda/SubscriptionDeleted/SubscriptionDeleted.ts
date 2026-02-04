import type Stripe from "stripe";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type {
  SubscriptionDeletedDependencies,
  SubscriptionDeletedEvent,
} from "./SubscriptionDeleted.types";
import type { Logger } from "../types/utils.types";
import { ensureIdempotency, generateEventId } from "../lib/idempotency";

export const subscriptionDeleted =
  ({
    stripe,
    eventBridgeClient,
    eventBusName,
    logger,
    dynamoDBClient,
    idempotencyTableName,
  }: SubscriptionDeletedDependencies & { 
    logger: Logger;
    dynamoDBClient: DynamoDBClient;
    idempotencyTableName: string;
  }) =>
  async (event: SubscriptionDeletedEvent) => {
    const {
      id: stripeSubscriptionId,
      status,
      ended_at,
      canceled_at,
      customer,
    } = event;
    
    logger.logStripeEvent("customer.subscription.deleted", event as unknown as Record<string, unknown>);
    logger.debug("Received subscriptionDeleted event", { event });
    
    try {
      const stripeCustomer = (await stripe.customers.retrieve(
        customer as string,
      )) as Stripe.Customer;
      logger.debug("stripeCustomer retrieved", { stripeCustomer });
      const { email } = stripeCustomer;
      logger.debug("subscription status", { status });
      
      if (status !== "canceled") {
        logger.warn("Subscription is not canceled, skipping", { status });
        return;
      }

      // Generate idempotency key for subscription deletion
      const eventId = generateEventId("subscription-deleted", stripeSubscriptionId);
      
      // Check idempotency
      const idempotencyResult = await ensureIdempotency(
        { dynamoDBClient, tableName: idempotencyTableName, logger },
        eventId,
        { 
          subscriptionId: stripeSubscriptionId, 
          customerId: customer,
          status,
          endedAt: ended_at,
          canceledAt: canceled_at
        }
      );

      if (idempotencyResult.isDuplicate) {
        logger.info("Subscription deletion already processed, skipping", { 
          subscriptionId: stripeSubscriptionId,
          eventId 
        });
        return;
      }

      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "SubscriptionDeleted",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                userEmail: email,
                stripeSubscriptionId,
                status,
                endedAt: ended_at,
                canceledAt: canceled_at,
              }),
            },
          ],
        }),
      );

      logger.info("SubscriptionDeleted event sent", {
        subscriptionId: stripeSubscriptionId,
        customerEmail: email,
      });

      // Send email notification for subscription cancellation
      if (email) {
        // Determine if this was a trial expiration or a paid subscription cancellation
        // We check if the subscription ever had a paid invoice
        let isTrialExpiration = false;

        try {
          // Fetch the full subscription to check trial status
          const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

          // A subscription is considered a trial expiration if:
          // 1. It had a trial_end date
          // 2. The trial_end is close to (within 1 day) or after the ended_at date
          // 3. No payment was ever made (we can check if there was a trial and it ended)
          if (subscription.trial_end && ended_at) {
            const trialEndTime = subscription.trial_end;
            const endedTime = ended_at;
            const oneDayInSeconds = 24 * 60 * 60;

            // If trial end is within 1 day of subscription end, it's likely a trial expiration
            // (Stripe sets ended_at to trial_end when trial expires without conversion)
            if (Math.abs(trialEndTime - endedTime) < oneDayInSeconds) {
              isTrialExpiration = true;
              logger.info("Detected trial expiration", {
                subscriptionId: stripeSubscriptionId,
                trialEnd: new Date(trialEndTime * 1000).toISOString(),
                endedAt: new Date(endedTime * 1000).toISOString(),
              });
            }
          }
        } catch (subscriptionFetchError) {
          // If we can't fetch the subscription, default to cancellation email
          logger.warn("Failed to fetch subscription for trial detection", {
            subscriptionId: stripeSubscriptionId,
            error: subscriptionFetchError instanceof Error ? subscriptionFetchError.message : String(subscriptionFetchError),
          });
        }

        if (isTrialExpiration) {
          // Send trial expired email instead of cancellation email
          await eventBridgeClient.send(
            new PutEventsCommand({
              Entries: [
                {
                  Source: "service.stripe",
                  DetailType: "SendTrialExpiredEmail",
                  EventBusName: eventBusName,
                  Detail: JSON.stringify({
                    stripeSubscriptionId,
                    stripeCustomerId: customer,
                    customerEmail: email,
                    customerName: stripeCustomer.name || undefined,
                    upgradeUrl: `https://cdkinsights.dev/pricing?upgrade=true&email=${encodeURIComponent(email)}`,
                  }),
                },
              ],
            }),
          );

          logger.info("SendTrialExpiredEmail event sent", {
            subscriptionId: stripeSubscriptionId,
            customerEmail: email,
          });
        } else {
          // Format the access end date
          const accessEndDate = ended_at
            ? new Date(ended_at * 1000).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })
            : new Date().toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              });

          // Check if there was a recent refund for this subscription
          // (within the last 5 minutes - accounts for processing time)
          let refundInfo: {
            refundProcessed: boolean;
            refundAmount?: number;
            refundCurrency?: string;
            overageAmountNotRefunded?: number;
          } | undefined;

          try {
            const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
            const refunds = await stripe.refunds.list({
              limit: 5,
              created: { gte: fiveMinutesAgo },
            });

            // Find refund for this subscription by checking metadata
            const matchingRefund = refunds.data.find(
              (refund) => refund.metadata?.subscription_id === stripeSubscriptionId
            );

            if (matchingRefund) {
              refundInfo = {
                refundProcessed: true,
                refundAmount: matchingRefund.amount,
                refundCurrency: matchingRefund.currency,
                overageAmountNotRefunded: matchingRefund.metadata?.overage_amount_not_refunded
                  ? parseInt(matchingRefund.metadata.overage_amount_not_refunded, 10)
                  : undefined,
              };
              logger.info("Found recent refund for subscription", {
                subscriptionId: stripeSubscriptionId,
                refundId: matchingRefund.id,
                refundAmount: matchingRefund.amount,
              });
            }
          } catch (refundCheckError) {
            // Log but don't fail - we can still send the email without refund info
            logger.warn("Failed to check for recent refunds", {
              subscriptionId: stripeSubscriptionId,
              error: refundCheckError instanceof Error ? refundCheckError.message : String(refundCheckError),
            });
          }

          await eventBridgeClient.send(
            new PutEventsCommand({
              Entries: [
                {
                  Source: "service.stripe",
                  DetailType: "SendSubscriptionCancelledEmail",
                  EventBusName: eventBusName,
                  Detail: JSON.stringify({
                    stripeSubscriptionId,
                    stripeCustomerId: customer,
                    customerEmail: email,
                    customerName: stripeCustomer.name || undefined,
                    accessEndDate,
                    reactivateUrl: `https://cdkinsights.dev/pricing?reactivate=true&email=${encodeURIComponent(email)}`,
                    // Include refund info if present
                    ...(refundInfo && {
                      refundProcessed: refundInfo.refundProcessed,
                      refundAmount: refundInfo.refundAmount,
                      refundCurrency: refundInfo.refundCurrency,
                      overageAmountNotRefunded: refundInfo.overageAmountNotRefunded,
                    }),
                  }),
                },
              ],
            }),
          );

          logger.info("SendSubscriptionCancelledEmail event sent", {
            subscriptionId: stripeSubscriptionId,
            customerEmail: email,
            refundProcessed: refundInfo?.refundProcessed || false,
          });
        }
      }
    } catch (error) {
      logger.error("Error processing subscription deletion", {
        subscriptionId: stripeSubscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
