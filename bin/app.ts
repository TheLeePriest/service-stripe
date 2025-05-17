#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ServiceStripeStack } from "../cdk/stacks/ServiceStripeStack";

const app = new cdk.App();

const stage = process.env.STAGE || "dev";
const targetEventBusName =
	process.env.TARGET_EVENT_BUS_NAME || `cdk-insights-event-bus-${stage}`;

new ServiceStripeStack(app, "ServiceStripeStack", {
	stage,
	targetEventBusName,
});
