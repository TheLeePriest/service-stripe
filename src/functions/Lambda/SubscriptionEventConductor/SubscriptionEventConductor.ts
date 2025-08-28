import type { EventBridgeEvent } from "aws-lambda";
import { subscriptionCreated } from "../SubscriptionCreated/SubscriptionCreated";
import { subscriptionUpdated } from "../SubscriptionUpdated/SubscriptionUpdated";
import { subscriptionDeleted } from "../SubscriptionDeleted/SubscriptionDeleted";
import type {
  SubscriptionEventConductorDependencies,
  StripeEventBridgeDetail,
} from "./SubscriptionEventConductor.types";
import type { SubscriptionCreatedEvent } from "../SubscriptionCreated/SubscriptionCreated.types";
import type { SubscriptionUpdatedEvent } from "../SubscriptionUpdated/SubscriptionUpdated.types";
import type { SubscriptionDeletedEvent } from "../SubscriptionDeleted/SubscriptionDeleted.types";
import type { Logger } from "../types/utils.types";
import { subscriptionUpgraded } from "../SubscriptionUpgraded/SubscriptionUpgraded";

export const subscriptionEventConductor =
  ({
    stripe,
    eventBridgeClient,
    eventBusName,
    eventBusArn,
    eventBusSchedulerRoleArn,
    schedulerClient,
    logger,
    dynamoDBClient,
    idempotencyTableName,
  }: SubscriptionEventConductorDependencies & { logger: Logger }) =>
  async (event: EventBridgeEvent<string, StripeEventBridgeDetail>) => {
    const stripeEvent = event.detail;
    const subscription = stripeEvent.data.object;
    
    // Check if customer object is available in the webhook event
    const customer = stripeEvent.data.object.customer;
    const customerEmail = customer && typeof customer === 'object' && 'email' in customer ? customer.email || '' : '';
    const customerName = customer && typeof customer === 'object' && 'name' in customer ? customer.name || '' : '';

    logger.info("Processing subscription event", {
      eventType: stripeEvent.type,
      subscriptionId: subscription.id,
      stripeEvent,
    });

    switch (stripeEvent.type) {
      case "customer.subscription.created": {
        // Check if this is an upgrade based on metadata
        const isUpgrade = subscription.metadata?.is_upgrade === "true";
        
        if (isUpgrade) {
          // Route to upgrade handler
          const upgradeEvent = {
            items: {
              data: subscription.items.data.map((item) => {
                const productId =
                  typeof item.price === "string"
                    ? item.price
                    : typeof item.price.product === "string"
                      ? item.price.product
                      : item.price.product.id;
                const quantityValue = item.quantity ?? 1;
                return {
                  id: item.id,
                  price: { product: productId, id: item.price.id },
                  quantity: quantityValue,
                  current_period_end: item.current_period_end,
                  metadata: item.metadata,
                };
              }),
            },
            customer: subscription.customer as string,
            id: subscription.id,
            status: subscription.status,
            cancel_at_period_end: subscription.cancel_at_period_end,
            ...(subscription.trial_start && {
              trial_start: subscription.trial_start,
            }),
            ...(subscription.trial_end && {
              trial_end: subscription.trial_end,
            }),
            created: subscription.created,
            metadata: subscription.metadata || {},
          };

          logger.info("Sending subscription upgraded event", { upgradeEvent });

          await subscriptionUpgraded({
            stripe,
            eventBridgeClient,
            eventBusName,
            logger,
          })(upgradeEvent);
          break;
        }

        // Regular subscription creation
        const createdEvent: SubscriptionCreatedEvent = {
          items: {
            data: subscription.items.data.map((item) => {
              const productId =
                typeof item.price === "string"
                  ? item.price
                  : typeof item.price.product === "string"
                    ? item.price.product
                    : item.price.product.id;
              const quantityValue = item.quantity ?? 1;
              return {
                id: item.id,
                price: { product: productId, id: item.price.id },
                quantity: quantityValue,
                current_period_end: item.current_period_end,
                metadata: item.metadata,
              };
            }),
          },
          customer: subscription.customer as string,
          customerEmail,
          customerName,
          id: subscription.id,
          status: subscription.status,
          cancel_at_period_end: subscription.cancel_at_period_end,
          ...(subscription.trial_start && {
            trial_start: subscription.trial_start,
          }),
          ...(subscription.trial_end && {
            trial_end: subscription.trial_end,
          }),
          created: subscription.created,
          metadata: subscription.metadata || {},
        };

        logger.info("Sending subscription created event", { createdEvent });  

        await subscriptionCreated({
          stripe,
          eventBridgeClient,
          eventBusName,
          dynamoDBClient,
          idempotencyTableName,
          logger,
        })(createdEvent);
        break;
      }

      case "customer.subscription.updated": {
        const updatedEvent: SubscriptionUpdatedEvent = {
          items: {
            data: subscription.items.data.map((item) => {
              const productId =
                typeof item.price === "string"
                  ? item.price
                  : typeof item.price.product === "string"
                    ? item.price.product
                    : item.price.product.id;
              const quantityValue = item.quantity ?? 1;
              return {
                price: { product: productId, id: item.price.id },
                quantity: quantityValue,
                current_period_end: item.current_period_end,
                current_period_start: item.current_period_start,
                metadata: item.metadata as Record<string, unknown>,
                id: item.id,
              };
            }),
          },
          createdAt: subscription.created,
          ...(subscription.trial_start && {
            trialStart: subscription.trial_start,
          }),
          ...(subscription.trial_end && {
            trialEnd: subscription.trial_end,
          }),
          customer: subscription.customer as string,
          id: subscription.id,
          status: subscription.status,
          cancel_at_period_end: subscription.cancel_at_period_end,
          ...(subscription.cancel_at && {
            cancel_at: subscription.cancel_at,
          }),
          ...(stripeEvent.data.previous_attributes && {
            previousAttributes: stripeEvent.data.previous_attributes,
          }),
        };
        await subscriptionUpdated({
          eventBridgeClient,
          eventBusArn,
          eventBusSchedulerRoleArn,
          eventBusName,
          schedulerClient,
          stripe,
          dynamoDBClient,
          idempotencyTableName,
          logger,
        })(updatedEvent);
        break;
      }

      case "customer.subscription.deleted": {
        const deletedEvent: SubscriptionDeletedEvent = {
          id: subscription.id,
          customer: subscription.customer as string,
          status: subscription.status,
          ended_at: subscription.ended_at ?? undefined,
          canceled_at: subscription.canceled_at ?? undefined,
        };
        await subscriptionDeleted({ 
          stripe, 
          eventBridgeClient, 
          eventBusName,
          dynamoDBClient,
          idempotencyTableName,
          logger,
        })(deletedEvent);
        break;
      }

      default:
        logger.warn("Unhandled event type", { eventType: stripeEvent.type });
    }
  };
