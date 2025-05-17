import type { EventBridgeEvent } from "aws-lambda";
import type Stripe from "stripe";
import type {
	PutEventsCommand,
	PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import { sessionCompleted } from "../SessionCompleted/SessionCompleted";

type SessionEventConductorDependencies = {
	stripe: Stripe;
	eventBridgeClient: {
		send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
	};
	eventBusName: string;
};

type StripeEventBridgeDetail = {
	id: string;
	object: string;
	api_version: string;
	created: number;
	data: {
		object: Stripe.Checkout.Session;
	};
	livemode: boolean;
	pending_webhooks: number;
	request: {
		id: string | null;
		idempotency_key: string | null;
	};
	type: "checkout.session.completed";
};

export const sessionEventConductor =
	({
		stripe,
		eventBridgeClient,
		eventBusName,
	}: SessionEventConductorDependencies) =>
	async (event: EventBridgeEvent<string, StripeEventBridgeDetail>) => {
		const stripeEvent = event.detail;
		const session = stripeEvent.data;

		switch (stripeEvent.type) {
			case "checkout.session.completed":
				await sessionCompleted({
					stripe,
					eventBridgeClient,
					eventBusName,
				})(session);
				break;
			default:
				console.log(`Unhandled event type: ${stripeEvent.type}`);
		}
	};
