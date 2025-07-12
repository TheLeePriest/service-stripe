import type {
  SubscriptionUpdatedEvent,
  SubscriptionState,
} from "../../SubscriptionUpdated.types";

export function determineSubscriptionState(
  event: SubscriptionUpdatedEvent,
): SubscriptionState {
  const { status, cancel_at_period_end, previousAttributes } = event;

  const hasRenewed = event.items.data.some((item, index) => {
    const prevItem = previousAttributes?.items?.data?.[index];
    return (
      prevItem && item.current_period_start !== prevItem.current_period_start
    );
  });

  if (hasRenewed) {
    return "RENEWED";
  }

  if (
    cancel_at_period_end &&
    status === "active" &&
    !previousAttributes?.cancel_at_period_end
  ) {
    return "CANCELLING";
  }

  if (!cancel_at_period_end && previousAttributes?.cancel_at_period_end) {
    return "UNCANCELLING";
  }

  if (event.cancel_at === null && previousAttributes?.cancel_at) {
    return "UNCANCELLING";
  }

  const hasQuantityChanged = event.items.data.some((item, index) => {
    const prevItem = previousAttributes?.items?.data?.[index];
    return prevItem && item.quantity !== prevItem.quantity;
  });

  if (hasQuantityChanged) {
    return "QUANTITY_CHANGED";
  }

  return "OTHER_UPDATE";
}
