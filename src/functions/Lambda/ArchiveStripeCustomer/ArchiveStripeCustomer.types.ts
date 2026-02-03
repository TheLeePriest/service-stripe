import type Stripe from "stripe";
import type {
  PutEventsCommand,
  PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";

export interface ArchiveStripeCustomerEvent {
  detail: {
    stripeCustomerId: string;
    deletionRequestId: string;
  };
}

export interface ArchiveStripeCustomerDependencies {
  stripeClient: Stripe;
  eventBridgeClient: {
    send: (command: PutEventsCommand) => Promise<PutEventsCommandOutput>;
  };
  eventBusName: string;
  logger: {
    info: (message: string, data?: Record<string, unknown>) => void;
    warn: (message: string, data?: Record<string, unknown>) => void;
    error: (message: string, data?: Record<string, unknown>) => void;
  };
}
