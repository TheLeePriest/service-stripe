import type {
	PutEventsCommand,
	PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type Stripe from "stripe";

export type SubscriptionDeletedDependencies = {
	stripe: Stripe;
	eventBridgeClient: {
		send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
	};
	eventBusName: string;
};
