import type Stripe from "stripe";
import type {
  SubscriptionCreatedEvent,
  SubscriptionCreatedDependencies,
} from "./SubscriptionCreated.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";

export const subscriptionCreated =
  (dependencies: SubscriptionCreatedDependencies) =>
  async (subscription: SubscriptionCreatedEvent) => {
    const { stripe, eventBridgeClient, eventBusName } = dependencies;

    try {
      const customer = (await stripe.customers.retrieve(
        subscription.customer as string,
      )) as Stripe.Customer;

      const items = await Promise.all(
        subscription.items.data.map(async (item) => {
          console.log(item, "item");
          const product = await stripe.products.retrieve(
            item.price.product as string,
          );
          const priceData = await stripe.prices.retrieve(item.price.id);
          console.log(priceData, "priceData");
          console.log(product, " Product retrieved for item:", item.id);
          return {
            itemId: item.id,
            productId: product.id,
            productName: product.name,
            priceId: item.price.id,
            priceData: {
              unitAmount: priceData.unit_amount,
              currency: priceData.currency,
              recurring: priceData.recurring,
              metadata: priceData.metadata,
            },
            quantity: item.quantity,
            expiresAt: item.current_period_end,
            metadata: item.metadata,
          };
        }),
      );

      console.log(
        `Processing subscription ${subscription.id} for customer ${customer.id}`,
      );

      console.log(items, "Items processed for subscription:", subscription.id);

      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "SubscriptionCreated",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                stripeSubscriptionId: subscription.id,
                stripeCustomerId: subscription.customer,
                customerEmail: customer.email,
                items,
                status: subscription.status,
                createdAt: subscription.created,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                ...(subscription.trial_start && {
                  trialStart: subscription.trial_start,
                }),
                ...(subscription.trial_end && {
                  trialEnd: subscription.trial_end,
                }),
              }),
            },
          ],
        }),
      );

      console.log(
        `SubscriptionCreated event sent for subscription ${subscription.id}`,
      );
    } catch (error) {
      console.error(`Error processing subscription ${subscription.id}:`, error);
      throw error;
    }
  };
