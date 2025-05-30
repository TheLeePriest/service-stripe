import type Stripe from "stripe";
import type {
  SubscriptionCreatedDependencies,
  SubscriptionCreatedEvent,
} from "./SubscriptionCreated.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";

export const subscriptionCreated =
  (dependencies: SubscriptionCreatedDependencies) =>
  async (subscription: SubscriptionCreatedEvent) => {
    const { stripe, uuidv4, eventBridgeClient, eventBusName } = dependencies;

    const getCustomer = async () => {
      try {
        return (await stripe.customers.retrieve(
          subscription.customer,
        )) as Stripe.Customer;
      } catch (error) {
        console.error("Error retrieving customer:", error);
        throw new Error(
          `Failed to retrieve customer: ${(error as Error).message}`,
        );
      }
    };

    const customer = await getCustomer();

    const createEventPromise = async (
      item: SubscriptionCreatedEvent["items"]["data"][0],
    ) => {
      const getProduct = async () => {
        try {
          return (await stripe.products.retrieve(
            item.price.product,
          )) as Stripe.Product;
        } catch (error) {
          console.error("Error retrieving product:", error);
          throw new Error(
            `Failed to retrieve product: ${(error as Error).message}`,
          );
        }
      };

      const product = await getProduct();

      const { current_period_end } = item;
      const key = uuidv4();

      const sendEvent = async () => {
        try {
          await eventBridgeClient.send(
            new PutEventsCommand({
              Entries: [
                {
                  Source: "service.stripe",
                  DetailType: "SubscriptionCreated",
                  EventBusName: eventBusName,
                  Detail: JSON.stringify({
                    licenseKey: key,
                    stripeSubscriptionId: subscription.id,
                    stripeCustomerId: subscription.customer,
                    customerEmail: customer.email,
                    productId: product.id,
                    productName: product.name,
                    priceId: item.price.id,
                    quantity: item.quantity,
                    status: subscription.status,
                    createdAt: subscription.created,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    ...(subscription.trial_start && {
                      trialStart: subscription.trial_start,
                    }),
                    ...(subscription.trial_end && {
                      trialEnd: subscription.trial_end,
                    }),
                    expiresAt: current_period_end,
                    metadata: item.metadata,
                  }),
                },
              ],
            }),
          );
        } catch (error) {
          console.error("Error sending event to EventBridge:", error);
          throw new Error(
            `Failed to send event to EventBridge: ${(error as Error).message}`,
          );
        }
      };

      await sendEvent();
    };

    const eventPromises = subscription.items.data.map(createEventPromise);

    try {
      await Promise.all(eventPromises);
    } catch (error) {
      console.error("Error in subscriptionCreated:", error);
      throw error;
    }
  };
