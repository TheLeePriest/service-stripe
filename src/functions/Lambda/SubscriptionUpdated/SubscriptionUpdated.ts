import type { SubscriptionUpdatedDependencies } from "./SubscriptionUpdated.types";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type Stripe from "stripe";

export const subscriptionUpdated =
	({
		stripe,
		eventBridgeClient,
		eventBusName,
	}: SubscriptionUpdatedDependencies) =>
	async (event: Stripe.CustomerSubscriptionUpdatedEvent.Data) => {
		const { object } = event;
		const {
			items: subscribedItems,
			customer,
			id: stripeSubscriptionId,
			status,
			cancel_at_period_end,
		} = object;
		const stripeCustomer = (await stripe.customers.retrieve(
			customer as string,
		)) as Stripe.Customer;
		const { email } = stripeCustomer;

		for (const item of subscribedItems.data) {
			const product = await stripe.products.retrieve(
				item.price.product as string,
			);

			await eventBridgeClient.send(
				new PutEventsCommand({
					Entries: [
						{
							Source: "service.stripe",
							DetailType: "SubscriptionUpdated",
							EventBusName: eventBusName,
							Detail: JSON.stringify({
								userEmail: email,
								orgId: item.metadata.orgId,
								subscriptionTier: product.name,
								stripeSubscriptionId,
								stripeCustomerId: customer,
								createdAt: object.created,
								expiresAt: item.current_period_end,
								priceId: item.price.id,
								status,
								cancelAtPeriodEnd: cancel_at_period_end,
							}),
						},
					],
				}),
			);
		}
	};
