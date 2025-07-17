#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ServiceStripeStack } from "../cdk/stacks/ServiceStripeStack";
import { env } from "../src/functions/Lambda/lib/env";

const app = new cdk.App();

const stage = env.getRequired("STAGE") as "dev" | "prod" | "test";
const targetEventBusName = env.get("TARGET_EVENT_BUS_NAME") || "target-event-bus";

console.log("CDK App Configuration:", {
  stage,
  targetEventBusName: `${targetEventBusName}-${stage}`,
  nodeEnv: process.env.NODE_ENV,
  cdkDefaultAccount: process.env.CDK_DEFAULT_ACCOUNT,
  cdkDefaultRegion: process.env.CDK_DEFAULT_REGION,
});

new ServiceStripeStack(app, `service-stripe-stack-${stage}`, {
  stage,
  serviceName: "service-stripe",
  targetEventBusName: `${targetEventBusName}-${stage}`,
});
