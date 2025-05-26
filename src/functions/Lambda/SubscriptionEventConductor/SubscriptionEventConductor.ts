import type { EventBridgeEvent } from "aws-lambda";
import { subscriptionCreated } from "../SubscriptionCreated/SubscriptionCreated";
import { subscriptionDeleted } from "../SubscriptionDeleted/SubscriptionDeleted";
import type {
	SubscriptionEventConductorDependencies,
	StripeEventBridgeDetail,
} from "./SubscriptionEventConductor.types";
import { subscriptionUpdated } from "../SubscriptionUpdated/SubscriptionUpdated";

export const subscriptionEventConductor =
	({
		stripe,
		eventBridgeClient,
		uuidv4,
		eventBusName,
		eventBusArn,
		eventBusSchedulerRoleArn,
		schedulerClient,
	}: SubscriptionEventConductorDependencies) =>
	async (event: EventBridgeEvent<string, StripeEventBridgeDetail>) => {
		const stripeEvent = event.detail;
		const subscription = stripeEvent.data;
		console.log(stripeEvent, "stripeEvent");
		console.log(subscription, "subscriptionEventConductor");
		switch (stripeEvent.type) {
			case "customer.subscription.created":
				await subscriptionCreated({
					stripe,
					uuidv4,
					eventBridgeClient,
					eventBusName,
				})(subscription);
				break;
			case "customer.subscription.updated":
				await subscriptionUpdated({
					stripe,
					eventBridgeClient,
					eventBusArn,
					eventBusSchedulerRoleArn,
					eventBusName,
					schedulerClient,
				})(subscription);
				break;
			case "customer.subscription.deleted":
				await subscriptionDeleted({
					stripe,
					eventBridgeClient,
					eventBusName,
				})(subscription);
				break;
			default:
				console.log(`Unhandled event type: ${stripeEvent.type}`);
		}
	};
