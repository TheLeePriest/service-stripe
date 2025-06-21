#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ServiceStripeStack } from "../cdk/stacks/ServiceStripeStack";

const app = new cdk.App();

const stage = process.env.STAGE || "dev";
const targetEventBusName =
  process.env.TARGET_EVENT_BUS_NAME || "target-event-bus";

new ServiceStripeStack(app, `service-stripe-stack-${stage}`, {
  stage,
  serviceName: "service-stripe",
  targetEventBusName: `${targetEventBusName}-${stage}`,
});
