import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { subscriptionEventConductor } from "./SubscriptionEventConductor";
import { SchedulerClient } from "@aws-sdk/client-scheduler";

const eventBusName = process.env.TARGET_EVENT_BUS_NAME;
const eventBusSchedulerRoleArn = process.env.SCHEDULER_ROLE_ARN;
const eventBusArn = process.env.EVENT_BUS_ARN;

if (!eventBusArn) {
	throw new Error("EVENT_BUS_ARN environment variable is not set");
}

if (!eventBusSchedulerRoleArn) {
	throw new Error("SCHEDULER_ROLE_ARN environment variable is not set");
}

if (!eventBusName) {
	throw new Error("TARGET_EVENT_BUS_NAME environment variable is not set");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
	apiVersion: "2025-04-30.basil",
});

const eventBridgeClient = new EventBridgeClient();
const schedulerClient = new SchedulerClient();

export const subscriptionEventConductorHandler = subscriptionEventConductor({
	stripe,
	eventBridgeClient,
	uuidv4,
	eventBusName,
	eventBusSchedulerRoleArn,
	eventBusArn,
	schedulerClient,
});
