import type { EventBridgeEvent } from "aws-lambda";
import type Stripe from "stripe";
import type {
	PutEventsCommand,
	PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { sessionCompleted } from "../SessionCompleted/SessionCompleted";
import type { Logger } from "../types/utils.types";

type SessionEventConductorDependencies = {
	stripe: Stripe;
	eventBridgeClient: {
		send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
	};
	eventBusName: string;
	logger: Logger;
	dynamoDBClient: DynamoDBClient;
	idempotencyTableName: string;
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
		logger,
		dynamoDBClient,
		idempotencyTableName,
	}: SessionEventConductorDependencies) =>
	async (event: EventBridgeEvent<string, StripeEventBridgeDetail>) => {
		const stripeEvent = event.detail;
		const session = stripeEvent.data;

		logger.info("Processing session event", {
			eventType: stripeEvent.type,
			sessionId: session.object.id,
		});

		switch (stripeEvent.type) {
			case "checkout.session.completed":
				await sessionCompleted({
					stripe,
					eventBridgeClient,
					eventBusName,
					logger,
					dynamoDBClient,
					idempotencyTableName,
				})(session);
				break;
			default:
				logger.warn("Unhandled event type", { eventType: stripeEvent.type });
		}
	};
