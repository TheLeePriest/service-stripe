import type { StripeLogger, LoggerContext } from "../../types/logger.types";
import { env } from "../env";

// Fallback logger implementation
const createFallbackLogger = (name: string, level = "info") => {
  const logLevel = env.get("LOG_LEVEL") || level;
  const shouldLog = (level: string) => {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return (
      levels[level as keyof typeof levels] >=
      levels[logLevel as keyof typeof levels]
    );
  };

  return {
    info: (message: string, context?: Record<string, unknown>) => {
      if (shouldLog("info")) {
        console.log(
          JSON.stringify({
            level: "info",
            message,
            context,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    },
    warn: (message: string, context?: Record<string, unknown>) => {
      if (shouldLog("warn")) {
        console.warn(
          JSON.stringify({
            level: "warn",
            message,
            context,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    },
    error: (message: string, context?: Record<string, unknown>) => {
      if (shouldLog("error")) {
        console.error(
          JSON.stringify({
            level: "error",
            message,
            context,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    },
    debug: (message: string, context?: Record<string, unknown>) => {
      if (shouldLog("debug")) {
        console.debug(
          JSON.stringify({
            level: "debug",
            message,
            context,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    },
  };
};

export const createStripeLogger = (
  functionName: string,
  stage: string,
  serviceName = "service-stripe",
  correlationId?: string,
): StripeLogger => {
  const baseContext: LoggerContext = {
    functionName,
    stage,
    serviceName,
    correlationId,
  };

  // Try to use Strogger, fallback to console if not available
  let logger: ReturnType<typeof createFallbackLogger>;
  try {
    // Dynamic import to avoid build-time errors
    const strogger = require("strogger");
    logger = strogger.createLogger({
      name: `${serviceName}-${functionName}`,
      level: env.get("LOG_LEVEL") || "info",
      format: "json",
      context: baseContext,
    });
  } catch (error) {
    // Fallback to console-based logger
    logger = createFallbackLogger(
      `${serviceName}-${functionName}`,
      env.get("LOG_LEVEL") || "info",
    );
  }

  const stripeLogger: StripeLogger = {
    ...logger,
    withContext: (context: Partial<LoggerContext>) => {
      return createStripeLogger(
        context.functionName || functionName,
        context.stage || stage,
        context.serviceName || serviceName,
        context.correlationId || correlationId,
      );
    },
    logStripeEvent: (eventType: string, eventData: Record<string, unknown>) => {
      logger.info(`Stripe event received: ${eventType}`, {
        eventType,
        eventData,
        ...baseContext,
      });
    },
    logStripeError: (error: Error, context?: Record<string, unknown>) => {
      logger.error(`Stripe API error: ${error.message}`, {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        ...context,
        ...baseContext,
      });
    },
    logSubscriptionEvent: (
      subscriptionId: string,
      eventType: string,
      data?: Record<string, unknown>,
    ) => {
      logger.info(`Subscription event: ${eventType}`, {
        subscriptionId,
        eventType,
        ...data,
        ...baseContext,
      });
    },
    logProductEvent: (
      productId: string,
      eventType: string,
      data?: Record<string, unknown>,
    ) => {
      logger.info(`Product event: ${eventType}`, {
        productId,
        eventType,
        ...data,
        ...baseContext,
      });
    },
    logUsageEvent: (customerId: string, usageData: Record<string, unknown>) => {
      logger.info("Usage event processed", {
        customerId,
        usageData,
        ...baseContext,
      });
    },
  };

  return stripeLogger;
};
