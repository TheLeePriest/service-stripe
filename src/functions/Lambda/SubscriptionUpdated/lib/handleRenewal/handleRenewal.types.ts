import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import type Stripe from "stripe";
import type { SubscriptionUpdatedEvent } from "../../SubscriptionUpdated.types";

export type HandleRenewal = {
  subscription: SubscriptionUpdatedEvent;
  eventBridgeClient: EventBridgeClient;
  eventBusName: string;
};
