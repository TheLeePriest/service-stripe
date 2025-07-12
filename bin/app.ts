#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ServiceStripeStack } from "../cdk/stacks/ServiceStripeStack";
import { env } from "../src/functions/Lambda/lib/env";

const app = new cdk.App();

const stage = env.getRequired("STAGE") as "dev" | "prod" | "test";
const targetEventBusName = env.get("TARGET_EVENT_BUS_NAME") || "target-event-bus";

new ServiceStripeStack(app, `service-stripe-stack-${stage}`, {
  stage,
  serviceName: "service-stripe",
  targetEventBusName: `${targetEventBusName}-${stage}`,
});
