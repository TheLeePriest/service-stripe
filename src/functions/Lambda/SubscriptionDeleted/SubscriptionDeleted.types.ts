import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type Stripe from "stripe";

export type SubscriptionDeletedDependencies = {
  stripe: {
    customers: {
      retrieve: (
        id: string,
      ) => Promise<Stripe.Response<Stripe.Customer | Stripe.DeletedCustomer>>;
    };
    products: {
      retrieve: (id: string) => Promise<Stripe.Response<Stripe.Product>>;
    };
    subscriptions: {
      retrieve: (id: string) => Promise<Stripe.Response<Stripe.Subscription>>;
    };
    refunds: {
      list: (params: { limit?: number; created?: { gte: number } }) => Promise<Stripe.Response<Stripe.ApiList<Stripe.Refund>>>;
    };
  };
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  dynamoDBClient: DynamoDBClient;
  idempotencyTableName: string;
};

export type SubscriptionDeletedEvent = {
  id: string;
  customer: string;
  status: string;
  ended_at?: number;
  canceled_at?: number;
};
