import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { subscriptionEventConductor } from "./SubscriptionEventConductor";

const eventBusName = process.env.TARGET_EVENT_BUS_NAME;

if (!eventBusName) {
	throw new Error("TARGET_EVENT_BUS_NAME environment variable is not set");
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
	apiVersion: "2025-04-30.basil",
});
const eventBridgeClient = new EventBridgeClient({});

export const subscriptionEventConductorHandler = subscriptionEventConductor({
	stripe,
	eventBridgeClient,
	uuidv4,
	eventBusName,
});
