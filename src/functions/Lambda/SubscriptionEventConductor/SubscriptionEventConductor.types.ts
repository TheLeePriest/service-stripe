import type {
	PutEventsCommand,
	PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type Stripe from "stripe";

export type SubscriptionEventConductorDependencies = {
	stripe: Stripe;
	eventBridgeClient: {
		send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
	};
	uuidv4: () => string;
	eventBusName: string;
};

export type StripeEventBridgeDetail = {
	id: string;
	object: string;
	api_version: string;
	created: number;
	data: {
		object: Stripe.Subscription;
	};
	livemode: boolean;
	pending_webhooks: number;
	request: {
		id: string | null;
		idempotency_key: string | null;
	};
	type: string;
};
