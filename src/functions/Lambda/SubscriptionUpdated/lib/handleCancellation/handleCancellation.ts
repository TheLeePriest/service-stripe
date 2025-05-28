import {
  CreateScheduleCommand,
  UpdateScheduleCommand,
  type CreateScheduleCommandInput,
  ConflictException,
} from "@aws-sdk/client-scheduler";
import type Stripe from "stripe";
import type { SchedulerClient } from "../../../types/aws.types";
import type { SubscriptionUpdatedEvent } from "../../SubscriptionUpdated.types";

export const handleCancellation = async (
  subscription: SubscriptionUpdatedEvent,
  schedulerClient: SchedulerClient,
  eventBusArn: string,
  roleArn: string,
) => {
  const now = Date.now();
  const { items } = subscription;
  const tasks = items.data.map(async (item) => {
    const endMs = item.current_period_end * 1000;
    if (endMs <= now) {
      console.warn(
        `Skipping ${subscription.id}/${item.id}: period end already passed`,
      );
      return Promise.resolve();
    }

    const scheduleTime = new Date(endMs).toISOString().replace(/\.\d{3}Z$/, "");

    const name = `subscription-cancel-${subscription.id}-${item.id}`;
    const config: CreateScheduleCommandInput = {
      Name: name,
      ScheduleExpression: `at(${scheduleTime})`,
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: {
        Arn: eventBusArn,
        RoleArn: roleArn,
        Input: JSON.stringify({
          customerId: subscription.customer,
          subscriptionId: subscription.id,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        }),
      },
    };

    try {
      await schedulerClient.send(new CreateScheduleCommand(config));
      return console.info(`Scheduled ${name}`);
    } catch (err) {
      if ((err as Error).name === ConflictException.name) {
        console.info(`Schedule ${name} exists, updating…`);
        return schedulerClient
          .send(new UpdateScheduleCommand(config))
          .then(() => console.info(`Updated ${name}`));
      }
      console.error(`Error scheduling ${name}:`, err);
      throw err;
    }
  });

  const results = await Promise.allSettled(tasks);
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length) {
    throw new Error(`${failures.length} subscription schedules failed`);
  }
};
