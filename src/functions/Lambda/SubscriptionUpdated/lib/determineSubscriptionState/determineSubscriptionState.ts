import type {
  SubscriptionUpdatedEvent,
  SubscriptionState,
} from "../../SubscriptionUpdated.types";

export const determineSubscriptionState = (
  event: SubscriptionUpdatedEvent,
): SubscriptionState => {
  const { status, cancel_at_period_end, cancel_at, previousAttributes, items } =
    event;

  const currentQuantity = items.data[0]?.quantity;
  const previousQuantity = previousAttributes?.items?.data?.[0]?.quantity;

  if (previousQuantity !== undefined && currentQuantity !== previousQuantity) {
    return "QUANTITY_CHANGED";
  }

  if (cancel_at_period_end && status === "active") {
    return "CANCELLING";
  }

  if (
    (previousAttributes?.cancel_at !== undefined && cancel_at == null) ||
    (previousAttributes?.cancel_at_period_end === true &&
      cancel_at_period_end === false)
  ) {
    return "UNCANCELLING";
  }

  return "OTHER_UPDATE";
};
