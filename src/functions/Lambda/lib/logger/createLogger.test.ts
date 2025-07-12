import { describe, it, expect, vi } from "vitest";
import { createStripeLogger } from "./createLogger";

describe("createStripeLogger", () => {
  it("should create a logger with basic functionality", () => {
    const logger = createStripeLogger("testFunction", "dev");
    
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("should have Stripe-specific logging methods", () => {
    const logger = createStripeLogger("testFunction", "dev");
    
    expect(typeof logger.logStripeEvent).toBe("function");
    expect(typeof logger.logStripeError).toBe("function");
    expect(typeof logger.logSubscriptionEvent).toBe("function");
    expect(typeof logger.logProductEvent).toBe("function");
    expect(typeof logger.logUsageEvent).toBe("function");
  });

  it("should log messages with context", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createStripeLogger("testFunction", "dev");
    
    logger.info("Test message", { testData: "value" });
    
    expect(consoleSpy).toHaveBeenCalled();
    const logCall = consoleSpy.mock.calls[0][0] as string;
    const logData = JSON.parse(logCall);
    
    expect(logData.message).toBe("Test message");
    expect(logData.context?.testData).toBe("value");
    expect(logData.level).toBe("info");
    expect(logData.timestamp).toBeDefined();
    
    consoleSpy.mockRestore();
  });

  it("should create logger with correlation ID", () => {
    const logger = createStripeLogger("testFunction", "dev", "service-stripe", "correlation-123");
    
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("Test message");
    
    const logCall = consoleSpy.mock.calls[0][0] as string;
    const logData = JSON.parse(logCall);
    
    expect(logData.message).toBe("Test message");
    expect(logData.level).toBe("info");
    expect(logData.timestamp).toBeDefined();
    
    consoleSpy.mockRestore();
  });

  it("should log Stripe-specific events", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createStripeLogger("testFunction", "dev");
    
    logger.logStripeEvent("customer.subscription.created", { subscriptionId: "sub_123" });
    
    expect(consoleSpy).toHaveBeenCalled();
    const logCall = consoleSpy.mock.calls[0][0] as string;
    const logData = JSON.parse(logCall);
    
    expect(logData.message).toBe("Stripe event received: customer.subscription.created");
    expect(logData.context?.eventType).toBe("customer.subscription.created");
    expect(logData.context?.eventData?.subscriptionId).toBe("sub_123");
    
    consoleSpy.mockRestore();
  });
}); 