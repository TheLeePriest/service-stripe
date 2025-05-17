import Stripe from "stripe";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { sessionCompleted } from "./SessionCompleted";

const eventBusName = process.env.EVENT_BUS_NAME;

if (!eventBusName) {
	throw new Error("EVENT_BUS_NAME environment variable is not set");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
	apiVersion: "2025-04-30.basil",
});

const eventBridgeClient = new EventBridgeClient({});

export const sessionCompletedHandler = sessionCompleted({
	stripe,
	eventBridgeClient,
	eventBusName,
});
