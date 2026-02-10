import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { archiveStripeCustomer } from "./ArchiveStripeCustomer";
import { createStripeLogger } from "../lib/logger/createLogger";
import { getStripeClient } from "../lib/stripeClient";
import { env } from "../lib/env";
import type { ArchiveStripeCustomerEvent } from "./ArchiveStripeCustomer.types";

const eventBusName = env.get("TARGET_EVENT_BUS_NAME");

if (!eventBusName) {
  throw new Error("TARGET_EVENT_BUS_NAME environment variable is not set");
}

const eventBridgeClient = new EventBridgeClient({});

const logger = createStripeLogger(
  "archiveStripeCustomer",
  env.getRequired("STAGE") as "dev" | "prod" | "test"
);

let initialized: ReturnType<typeof archiveStripeCustomer> | undefined;

export const handler = async (event: ArchiveStripeCustomerEvent) => {
  if (!initialized) {
    const stripe = await getStripeClient(env.getRequired("STAGE"));
    initialized = archiveStripeCustomer({
      stripeClient: stripe,
      eventBridgeClient,
      eventBusName,
      logger,
    });
  }
  return initialized(event);
};
