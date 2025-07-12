# Strogger Logging Setup

This project uses [Strogger](https://www.npmjs.com/package/strogger) for structured logging across all Lambda functions.

## Overview

Strogger provides structured JSON logging with context-aware features, making it easier to debug and monitor the Stripe integration.

## Setup

The logger is configured in `src/functions/Lambda/lib/logger/createLogger.ts` and provides:

- **Structured JSON logging** - All logs are in JSON format for easy parsing
- **Context-aware logging** - Each log includes function name, stage, and correlation ID
- **Stripe-specific methods** - Custom methods for logging Stripe events, errors, and operations
- **Fallback support** - Graceful fallback to console logging if Strogger is unavailable

## Usage

### Basic Logger Setup

```typescript
import { createStripeLogger } from "../lib/logger/createLogger";

const logger = createStripeLogger(
  "functionName",
  process.env.STAGE || "dev"
);
```

### Available Logging Methods

#### Standard Methods
```typescript
logger.info("Message", { context: "data" });
logger.warn("Warning message", { warningContext: "data" });
logger.error("Error message", { errorContext: "data" });
logger.debug("Debug message", { debugContext: "data" });
```

#### Stripe-Specific Methods
```typescript
// Log Stripe events
logger.logStripeEvent("customer.subscription.created", eventData);

// Log Stripe API errors
logger.logStripeError(error, { subscriptionId: "sub_123" });

// Log subscription events
logger.logSubscriptionEvent("sub_123", "created", { customerId: "cus_123" });

// Log product events
logger.logProductEvent("prod_123", "updated", { priceId: "price_123" });

// Log usage events
logger.logUsageEvent("cus_123", { resourcesAnalyzed: 100 });
```

### Adding Logger to Lambda Functions

1. **Update the handler file:**
```typescript
import { createStripeLogger } from "../lib/logger/createLogger";

const logger = createStripeLogger(
  "functionName",
  process.env.STAGE || "dev"
);

export const handler = yourFunction({
  // ... other dependencies
  logger,
});
```

2. **Update the function types:**
```typescript
import type { StripeLogger } from "../types/logger.types";

export type YourFunctionDependencies = {
  // ... existing dependencies
  logger: StripeLogger;
};
```

3. **Update the function implementation:**
```typescript
export const yourFunction = ({ logger, ...otherDeps }: YourFunctionDependencies) =>
  async (event: YourEventType) => {
    logger.info("Processing event", { eventType: event.type });
    
    try {
      // Your logic here
      logger.info("Success", { result: "data" });
    } catch (error) {
      logger.error("Error occurred", { error: error.message });
      throw error;
    }
  };
```

## Environment Variables

- `LOG_LEVEL` - Set logging level (debug, info, warn, error). Default: "info"
- `STAGE` - Environment stage (dev, prod). Used for context

## Log Output Format

All logs are structured JSON with the following format:

```json
{
  "level": "info",
  "message": "Stripe event received: customer.subscription.created",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "functionName": "subscriptionCreated",
  "stage": "dev",
  "serviceName": "service-stripe",
  "correlationId": "uuid-123",
  "eventType": "customer.subscription.created",
  "eventData": { ... }
}
```

## Benefits

1. **Structured Data** - All logs are JSON for easy parsing and analysis
2. **Context Preservation** - Each log includes function and environment context
3. **Stripe Integration** - Specialized methods for Stripe-specific logging
4. **Error Tracking** - Structured error logging with stack traces
5. **Performance Monitoring** - Easy to track function performance and errors
6. **CloudWatch Integration** - JSON logs work well with CloudWatch Logs Insights

## Migration from Console Logging

To migrate existing console.log statements:

```typescript
// Before
console.log("Processing subscription", subscriptionId);
console.error("Error occurred", error);

// After
logger.info("Processing subscription", { subscriptionId });
logger.error("Error occurred", { error: error.message });
```

## Testing

The logger includes a fallback implementation that works even if Strogger is not available, making it safe for development and testing environments. 