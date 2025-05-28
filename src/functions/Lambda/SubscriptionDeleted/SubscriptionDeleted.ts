import type Stripe from "stripe";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type {
  SubscriptionDeletedDependencies,
  SubscriptionDeletedEvent,
} from "./SubscriptionDeleted.types";

export const subscriptionDeleted =
  ({
    stripe,
    eventBridgeClient,
    eventBusName,
  }: SubscriptionDeletedDependencies) =>
  async (event: SubscriptionDeletedEvent) => {
    const {
      id: stripeSubscriptionId,
      status,
      ended_at,
      canceled_at,
      customer,
    } = event;

    try {
      const stripeCustomer = (await stripe.customers.retrieve(
        customer as string,
      )) as Stripe.Customer;
      const { email } = stripeCustomer;

      if (status !== "canceled") {
        console.warn("Subscription is not canceled, skipping");
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
    } catch (error) {
      console.error("Error processing subscription cancellation:", error);
      throw error;
    }
  };
