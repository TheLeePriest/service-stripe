import {
  DeleteScheduleCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-scheduler";
import type Stripe from "stripe";
import type { SchedulerClient } from "../../../types/aws.types";
import type { SubscriptionUpdatedEvent } from "../../SubscriptionUpdated.types";

export const handleUncancellation = async (
  subscription: SubscriptionUpdatedEvent,
  schedulerClient: SchedulerClient,
) => {
  const { items } = subscription;
  const deletePromises = items.data.map(async (item) => {
    const scheduleName = `subscription-cancel-${subscription.id}`;

    try {
      await schedulerClient.send(
        new DeleteScheduleCommand({ Name: scheduleName }),
      );
      console.log(`Deleted schedule ${scheduleName}`);
    } catch (error) {
      const { name } = error as Error;
      if (name === ResourceNotFoundException.name) {
        console.log(`Schedule ${scheduleName} not found; skipping.`);
      } else {
        console.error(`Error deleting schedule ${scheduleName}:`, error);
        throw error;
      }
    }
  });

  await Promise.all(deletePromises);
};
