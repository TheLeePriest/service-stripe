import {
  DeleteScheduleCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-scheduler";
import type Stripe from "stripe";
import type { SchedulerClient } from "../../../types/aws.types";
import type { SubscriptionUpdatedEvent } from "../../SubscriptionUpdated.types";
import type { Logger } from "../../../types/utils.types";

export const handleUncancellation = async (
  subscription: SubscriptionUpdatedEvent,
  schedulerClient: SchedulerClient,
  logger: Logger,
) => {
  const { items } = subscription;
  const deletePromises = items.data.map(async (item) => {
    const scheduleName = `subscription-cancel-${subscription.id}`;

    try {
      await schedulerClient.send(
        new DeleteScheduleCommand({ Name: scheduleName }),
      );
      logger.info("Deleted schedule", { scheduleName });
    } catch (error) {
      const { name } = error as Error;
      if (name === ResourceNotFoundException.name) {
        logger.info("Schedule not found, skipping", { scheduleName });
      } else {
        logger.error("Error deleting schedule", { 
          scheduleName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  });

  await Promise.all(deletePromises);
};
