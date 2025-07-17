import type { HandleQuantityChange } from "./handleQuantityChange.types";
import type Stripe from "stripe";
import { sendQuantityChangeEvents } from "./lib/sendQuantityChangeEvents";
import type { Logger } from "../../../types/utils.types";

export async function handleQuantityChange({
  subscription,
  previousAttributes,
  eventBridgeClient,
  eventBusName,
  stripe,
  logger,
  dynamoDBClient,
  idempotencyTableName,
}: HandleQuantityChange): Promise<void> {
  try {
    logger.info("Processing quantity change for subscription", { subscriptionId: subscription.id });
    
    const customer = (await stripe.customers.retrieve(
      subscription.customer as string,
    )) as Stripe.Customer;
    const previousItems = new Map<string, Stripe.SubscriptionItem>(
      (
        previousAttributes?.items?.data as Stripe.SubscriptionItem[] | undefined
      )?.map((item) => [item.id, item]) || [],
    );
    const currentItems = new Map<string, Stripe.SubscriptionItem>(
      (subscription.items.data as Stripe.SubscriptionItem[]).map((item) => [
        item.id,
        item,
      ]),
    );

    for (const [itemId, currentItem] of currentItems) {
      const previousItem = previousItems.get(itemId);
      const previousQuantity = previousItem?.quantity ?? 0;
      const currentQuantity = currentItem.quantity ?? 0;
      const quantityDifference = currentQuantity - previousQuantity;

      if (quantityDifference > 0) {
        logger.info("Quantity increased for item", {
          itemId,
          previousQuantity,
          currentQuantity,
          quantityDifference,
        });
        
        await sendQuantityChangeEvents({
          eventBridgeClient,
          eventBusName,
          subscription,
          customer,
          item: currentItem,
          quantityDifference,
          stripe,
          logger,
          dynamoDBClient,
          idempotencyTableName,
        });
      }

      previousItems.delete(itemId);
    }
  } catch (error) {
    logger.error("Error processing quantity change for subscription", {
      subscriptionId: subscription.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
