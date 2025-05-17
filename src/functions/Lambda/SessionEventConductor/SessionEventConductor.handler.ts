import Stripe from "stripe";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { sessionEventConductor } from "./SessionEventConductor";

const eventBusName = process.env.TARGET_EVENT_BUS_NAME;

if (!eventBusName) {
	throw new Error("TARGET_EVENT_BUS_NAME environment variable is not set");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
	apiVersion: "2025-04-30.basil",
});

const eventBridgeClient = new EventBridgeClient({});

export const sessionEventConductorHandler = sessionEventConductor({
	stripe,
	eventBridgeClient,
	eventBusName,
});
