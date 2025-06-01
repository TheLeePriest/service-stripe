import type Stripe from "stripe";
import type { SubscriptionUpdatedEvent } from "../../../SubscriptionUpdated.types";
import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";

export type SendQuantityChangeEvents = {
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  subscription: SubscriptionUpdatedEvent;
  customer: Stripe.Customer;
  item: Stripe.SubscriptionItem;
  quantityDifference: number;
};
