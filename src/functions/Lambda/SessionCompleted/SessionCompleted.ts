import type Stripe from "stripe";
import type { SessionCompletedDependencies } from "./SessionCompleted.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";

export const sessionCompleted =
  ({ stripe, eventBridgeClient, eventBusName }: SessionCompletedDependencies) =>
  async (event: Stripe.CheckoutSessionCompletedEvent.Data) => {
    const { object } = event;

    if (!object) {
      console.warn("Missing session data, skipping");
      return;
    }

    const sessionId = object.id;
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer", "subscription", "subscription.items.data.price"],
    });

    const { customer_details: customerDetails } = session;
    try {
      if (!customerDetails) {
        console.warn("Missing customer details, skipping");
        throw new Error("Missing customer details");
      }

      const { email } = customerDetails;

      if (!email) {
        console.warn("Missing email, skipping");
        throw new Error("Missing email");
      }

      const customFieldsObject = session.custom_fields.reduce<
        Record<string, string>
      >((acc, field) => {
        acc[field.key] = field.text?.value ?? "";
        return acc;
      }, {});
      const { organization = "" } = customFieldsObject;
      const customer = session.customer as Stripe.Customer;
      console.log(customer);
      const retrievedCustomer = await stripe.customers.retrieve(customer.id);
      console.log(retrievedCustomer);
      const subscription = session.subscription as Stripe.Subscription;
      const planItem = subscription.items.data[0];
      const now = new Date().toISOString();

      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: "service.stripe",
              DetailType: "CustomerCreated",
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                userName: email,
                name: customer.name,
                signUpDate: now,
                stripeCustomerId: customer.id,
                stripeSubscriptionId: subscription.id,
                subscriptionStatus: subscription.status,
                planId: planItem.plan.product,
                priceId: planItem.price.id,
                subscriptionStartDate: subscription.start_date
                  ? new Date(subscription.start_date * 1000).toISOString()
                  : "",
                currentPeriodEndDate: new Date(
                  planItem.current_period_end * 1000,
                ).toISOString(),
                currency: subscription.currency,
                trialEndDate: subscription.trial_end
                  ? new Date(subscription.trial_end * 1000).toISOString()
                  : "",
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                organization: organization,
                createdAt: now,
                updatedAt: now,
              }),
            },
          ],
        }),
      );
    } catch (error) {
      console.error("Error sending event to EventBridge:", error);
      throw new Error("Failed to send event to EventBridge");
    }
  };
