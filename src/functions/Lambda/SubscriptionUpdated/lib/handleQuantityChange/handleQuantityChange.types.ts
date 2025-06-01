import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type { StripeClient } from "../../../types/stripe.types";
import type Stripe from "stripe";
import type { SubscriptionUpdatedEvent } from "../../SubscriptionUpdated.types";

export type HandleQuantityChange = {
  subscriptionId: string;
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  stripe: StripeClient;
  previousAttributes: Partial<Stripe.Subscription> | undefined;
  subscription: SubscriptionUpdatedEvent;
};
