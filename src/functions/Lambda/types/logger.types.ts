// Define a basic Logger interface since Strogger types might not be available
export interface Logger {
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
  debug: (message: string, context?: Record<string, unknown>) => void;
}

export type LoggerContext = {
  functionName: string;
  correlationId?: string;
  stage: string;
  serviceName: string;
};

export type StripeLogger = Logger & {
  withContext: (context: Partial<LoggerContext>) => StripeLogger;
  logStripeEvent: (eventType: string, eventData: Record<string, unknown>) => void;
  logStripeError: (error: Error, context?: Record<string, unknown>) => void;
  logSubscriptionEvent: (subscriptionId: string, eventType: string, data?: Record<string, unknown>) => void;
  logProductEvent: (productId: string, eventType: string, data?: Record<string, unknown>) => void;
  logUsageEvent: (customerId: string, usageData: Record<string, unknown>) => void;
};

export type LoggerDependencies = {
  logger: StripeLogger;
}; 