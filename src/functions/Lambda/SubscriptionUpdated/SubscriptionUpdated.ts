import type Stripe from "stripe";
import {
	SchedulerClient,
	CreateScheduleCommand,
	DeleteScheduleCommand,
} from "@aws-sdk/client-scheduler";
import type { SubscriptionUpdatedDependencies } from "./SubscriptionUpdated.types";
import { handleCancellation } from "./lib/handleCancellation/handleCancellation";
import { handleUncancellation } from "./lib/handleUncancellation/handleUncancellation";

export const subscriptionUpdated =
	({
		stripe,
		eventBusArn,
		eventBusSchedulerRoleArn,
		schedulerClient,
	}: SubscriptionUpdatedDependencies) =>
	async (event: Stripe.CustomerSubscriptionUpdatedEvent.Data) => {
		const { object: subscription, previous_attributes: previousAttributes } =
			event;
		const {
			id: stripeSubscriptionId,
			customer,
			status,
			cancel_at_period_end,
			cancel_at,
		} = subscription;

		try {
			const stripeCustomer = (await stripe.customers.retrieve(
				customer as string,
			)) as Stripe.Customer;
			if (cancel_at_period_end || status === "canceled") {
				console.log(`Subscription ${stripeSubscriptionId} is being canceled`);
				await handleCancellation(
					subscription,
					schedulerClient,
					eventBusArn,
					eventBusSchedulerRoleArn,
				);
			} else if (
				(previousAttributes?.cancel_at !== undefined && cancel_at === null) ||
				(previousAttributes?.cancel_at_period_end === true &&
					cancel_at_period_end === false)
			) {
				console.log(
					`Subscription ${stripeSubscriptionId} has been un-canceled`,
				);
				await handleUncancellation(subscription, schedulerClient);
			} else {
				console.log(
					`Subscription ${stripeSubscriptionId} updated with status: ${status}`,
				);
			}
		} catch (error) {
			console.error(
				`Error processing subscription ${stripeSubscriptionId}:`,
				error,
			);
			throw error;
		}
	};
