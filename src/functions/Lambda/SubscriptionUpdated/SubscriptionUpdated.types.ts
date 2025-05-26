import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type Stripe from "stripe";
import type { SchedulerClient } from "../types/aws.types";

export type SubscriptionUpdatedDependencies = {
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  eventBusArn: string;
  eventBusSchedulerRoleArn: string;
  schedulerClient: SchedulerClient;
};
