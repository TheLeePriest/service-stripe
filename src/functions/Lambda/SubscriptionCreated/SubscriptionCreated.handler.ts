import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { subscriptionCreated } from "./SubscriptionCreated";

const eventBusName = process.env.EVENT_BUS_NAME;

if (!eventBusName) {
	throw new Error("EVENT_BUS_NAME environment variable is not set");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
	apiVersion: "2025-04-30.basil",
});
const eventBridgeClient = new EventBridgeClient({});

export const subscriptionCreatedHandler = subscriptionCreated({
	stripe,
	eventBridgeClient,
	uuidv4,
	eventBusName,
});
