import type { SubscriptionCreatedDependencies } from "./SubscriptionCreated.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type Stripe from "stripe";

export const subscriptionCreated =
	({
		stripe,
		uuidv4,
		eventBridgeClient,
		eventBusName,
	}: SubscriptionCreatedDependencies) =>
	async (event: Stripe.CustomerSubscriptionCreatedEvent.Data) => {
		const { object } = event;
		console.log("Subscription Created Event:", event);
		console.log("Subscription Object:", JSON.stringify(object));
		const {
			items: subscribedItems,
			customer,
			id: stripeSubscriptionId,
			status,
			cancel_at_period_end,
			trial_start,
			trial_end,
			created,
		} = object;
		const stripeCustomer = (await stripe.customers.retrieve(
			customer as string,
		)) as Stripe.Customer;
		const { email } = stripeCustomer;

		for (const item of subscribedItems.data) {
			const key = uuidv4();
			const product = await stripe.products.retrieve(
				item.price.product as string,
			);
			const { current_period_end } = item;
			await eventBridgeClient.send(
				new PutEventsCommand({
					Entries: [
						{
							Source: "service.stripe",
							DetailType: "SubscriptionCreated",
							EventBusName: eventBusName,
							Detail: JSON.stringify({
								licenseKey: key,
								stripeSubscriptionId: stripeSubscriptionId,
								customerId: customer,
								customerEmail: email,
								productId: product.id,
								productName: product.name,
								priceId: item.price.id,
								quantity: item.quantity,
								status: status,
								createdAt: created,
								cancelAtPeriodEnd: cancel_at_period_end,
								trialStart: trial_start,
								trialEnd: trial_end,
								expiresAt: current_period_end,
								metadata: item.metadata,
							}),
						},
					],
				}),
			);
		}
	};
