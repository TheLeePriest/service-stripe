import type { EventBridgeEvent } from "aws-lambda";
import { subscriptionCreated } from "../SubscriptionCreated/SubscriptionCreated";
import { subscriptionUpdated } from "../SubscriptionUpdated/SubscriptionUpdated";
import { subscriptionDeleted } from "../SubscriptionDeleted/SubscriptionDeleted";
import type {
  SubscriptionEventConductorDependencies,
} from "./SubscriptionEventConductor.types";
import type { SubscriptionCreatedEvent } from "../SubscriptionCreated/SubscriptionCreated.types";
import type { SubscriptionUpdatedEvent } from "../SubscriptionUpdated/SubscriptionUpdated.types";
import type { SubscriptionDeletedEvent } from "../SubscriptionDeleted/SubscriptionDeleted.types";
import { subscriptionUpgraded } from "../SubscriptionUpgraded/SubscriptionUpgraded";
import type { Stripe } from "stripe";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";

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
  }: SubscriptionEventConductorDependencies) =>
  async (
    event: EventBridgeEvent<string, Stripe.Event>,
  ) => {
    const stripeEvent = event.detail;
    const subscription = stripeEvent.data.object as Stripe.Subscription;

    logger.info("Processing subscription event", {
      eventType: stripeEvent.type,
      subscriptionId: subscription.id,
      stripeEvent,
    });

    switch (stripeEvent.type) {
      case "customer.subscription.trial_will_end": {
        await eventBridgeClient.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: "service.stripe",
                DetailType: "TrialWillEnd",
                EventBusName: eventBusName,
                Detail: JSON.stringify({
                  stripeSubscriptionId: subscription.id,
                  stripeCustomerId: subscription.customer,
                  trialEnd: subscription.trial_end,
                  status: subscription.status,
                  createdAt: stripeEvent.created,
                  metadata: subscription.metadata || {},
                }),
              },
            ],
          }),
        );

        logger.info("Emitted TrialWillEnd event", {
          subscriptionId: subscription.id,
          customer: subscription.customer,
          trialEnd: subscription.trial_end,
        });
        break;
      }

      case "customer.subscription.paused": {
        const pausedAt = stripeEvent.created;

        await eventBridgeClient.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: "service.stripe",
                DetailType: "SubscriptionPaused",
                EventBusName: eventBusName,
                Detail: JSON.stringify({
                  stripeSubscriptionId: subscription.id,
                  status: subscription.status,
                  stripeCustomerId: subscription.customer,
                  pausedAt,
                  trialStart: subscription.trial_start,
                  trialEnd: subscription.trial_end,
                  metadata: subscription.metadata || {},
                }),
              },
            ],
          }),
        );

        logger.info("Emitted SubscriptionPaused event", {
          subscriptionId: subscription.id,
          customer: subscription.customer,
        });
        break;
      }

      case "customer.subscription.resumed": {
        const resumedAt = stripeEvent.created;

        await eventBridgeClient.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: "service.stripe",
                DetailType: "SubscriptionResumed",
                EventBusName: eventBusName,
                Detail: JSON.stringify({
                  stripeSubscriptionId: subscription.id,
                  status: subscription.status,
                  stripeCustomerId: subscription.customer,
                  resumedAt,
                  trialStart: subscription.trial_start,
                  trialEnd: subscription.trial_end,
                  metadata: subscription.metadata || {},
                }),
              },
            ],
          }),
        );

        logger.info("Emitted SubscriptionResumed event", {
          subscriptionId: subscription.id,
          customer: subscription.customer,
        });
        break;
      }

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
        // Handle in-place upgrade updates if metadata signals an upgrade
        const isUpgradeUpdate = subscription.metadata?.is_upgrade === "true";
        
        // Also detect trial-to-active transitions as upgrades (fallback if metadata missing)
        const wasTrialing = stripeEvent.data.previous_attributes?.status === "trialing";
        const isNowActive = subscription.status === "active";
        const trialEnded = 
          wasTrialing && 
          isNowActive && 
          subscription.trial_end && 
          stripeEvent.data.previous_attributes?.trial_end &&
          subscription.trial_end < stripeEvent.data.previous_attributes.trial_end;
        
        logger.info("Checking for upgrade in subscription update", {
          subscriptionId: subscription.id,
          hasIsUpgradeMetadata: subscription.metadata?.is_upgrade === "true",
          metadata: subscription.metadata || {},
          wasTrialing,
          isNowActive,
          trialEnded,
          previousStatus: stripeEvent.data.previous_attributes?.status,
          currentStatus: subscription.status,
          previousTrialEnd: stripeEvent.data.previous_attributes?.trial_end,
          currentTrialEnd: subscription.trial_end,
        });

        if (isUpgradeUpdate || (wasTrialing && isNowActive && trialEnded)) {
          // Ensure metadata includes upgrade info if we detected it via status change
          const upgradeMetadata = isUpgradeUpdate 
            ? subscription.metadata || {}
            : {
                ...subscription.metadata,
                is_upgrade: "true",
                upgrade_type: "trial_to_paid",
                upgraded_at: new Date().toISOString(),
                original_trial_subscription_id: subscription.id,
              };
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
            metadata: upgradeMetadata,
          };

          logger.info("Sending subscription upgraded event (updated)", {
            upgradeEvent,
          });

          await subscriptionUpgraded({
            stripe,
            eventBridgeClient,
            eventBusName,
            logger,
          })(upgradeEvent);
          break;
        }

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
        logger.warn("Unhandled event type", { eventType: event.detail.type });
    }
  };
