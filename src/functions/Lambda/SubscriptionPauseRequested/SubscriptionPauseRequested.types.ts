import { z } from "zod";

export const SubscriptionPauseRequestedEventSchema = z.object({
  stripeSubscriptionId: z.string().min(1, "Stripe subscription ID is required"),
  reason: z.enum(["usage_limit", "manual"]).default("usage_limit"),
  requestedAt: z.number().int().positive().optional(),
});

export type SubscriptionPauseRequestedEvent = z.infer<
  typeof SubscriptionPauseRequestedEventSchema
>;

export interface SubscriptionPauseRequestedDependencies {
  stripeClient: {
    subscriptions: {
      retrieve: (id: string) => Promise<{
        id: string;
        status: string;
        pause_collection: unknown | null;
        metadata?: Record<string, string>;
      }>;
      update: (
        id: string,
        params: { pause_collection: { behavior: "void" | "mark_uncollectible" | "keep_as_draft" } },
      ) => Promise<unknown>;
    };
  };
  logger: {
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
    success: (message: string, context?: Record<string, unknown>) => void;
  };
}

