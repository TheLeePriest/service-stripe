import type {
	PutEventsCommand,
	PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type Stripe from "stripe";

export type SubscriptionCreatedDependencies = {
	stripe: Stripe;
	uuidv4: () => string;
	eventBridgeClient: {
		send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
	};
	eventBusName: string;
};
