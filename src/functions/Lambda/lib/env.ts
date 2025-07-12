import { EnvironmentConfig, BaseEnvironmentSchema, mergeSchemas } from "envolution";
import { z } from "zod";

const AppEnvironmentSchema = z.object({
  TARGET_EVENT_BUS_NAME: z.string().optional(),
  IDEMPOTENCY_TABLE_NAME: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  PRODUCTS_TABLE_NAME: z.string().optional(),
  API_ID: z.string().optional(),
  EVENT_BUS_NAME: z.string().optional(),
  SCHEDULER_ROLE_ARN: z.string().optional(),
  EVENT_BUS_ARN: z.string().optional(),
});

const FullSchema = mergeSchemas(BaseEnvironmentSchema, AppEnvironmentSchema);

// Define the expected environment type without undefined for required fields
type EnvType = {
  STAGE: "dev" | "prod" | "test";
  LOG_LEVEL: "debug" | "info" | "warn" | "error";
  ENABLE_DEBUG: boolean;
  ENABLE_METRICS: boolean;
  REQUEST_TIMEOUT: number;
  MAX_RETRIES: number;
  TARGET_EVENT_BUS_NAME?: string;
  IDEMPOTENCY_TABLE_NAME?: string;
  STRIPE_SECRET_KEY?: string;
  PRODUCTS_TABLE_NAME?: string;
  API_ID?: string;
  EVENT_BUS_NAME?: string;
  SCHEDULER_ROLE_ARN?: string;
  EVENT_BUS_ARN?: string;
  NODE_ENV?: "test" | "development" | "production";
  SERVICE_NAME?: string;
  VERSION?: string;
};

// Encapsulate the type assertion here so the rest of the codebase doesn't see it
export const env = EnvironmentConfig.getInstance(FullSchema as unknown as z.ZodType<EnvType>);

// Re-export helper functions for convenience
export const { get, getRequired } = env; 