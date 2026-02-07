import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStripeLogger } from "./createLogger";

// Mock strogger to verify our wrapper delegates correctly
const mockInfo = vi.fn();
const mockWarn = vi.fn();
const mockError = vi.fn();
const mockDebug = vi.fn();

vi.mock("strogger", () => ({
  createLogger: vi.fn(() => ({
    info: mockInfo,
    warn: mockWarn,
    error: mockError,
    debug: mockDebug,
  })),
  createConsoleTransport: vi.fn(),
  createJsonFormatter: vi.fn(),
  getEnvironment: vi.fn(),
}));

describe("createStripeLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a logger with basic functionality", () => {
    const logger = createStripeLogger("testFunction", "dev");

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("should pass message and merged context to strogger info", () => {
    const logger = createStripeLogger("testFunction", "dev");

    logger.info("Test message", { testData: "value" });

    expect(mockInfo).toHaveBeenCalledWith("Test message", {
      functionName: "testFunction",
      stage: "dev",
      serviceName: "service-stripe",
      testData: "value",
    });
  });

  it("should include base context in all log entries", () => {
    const logger = createStripeLogger("testFunction", "dev", "my-service");

    logger.info("Test message");

    expect(mockInfo).toHaveBeenCalledWith("Test message", {
      functionName: "testFunction",
      stage: "dev",
      serviceName: "my-service",
    });
  });

  it("should delegate error with context to strogger error", () => {
    const logger = createStripeLogger("testFunction", "dev");
    const error = new Error("test error");

    logger.error("Something failed", { err: error, subscriptionId: "sub_123" });

    expect(mockError).toHaveBeenCalledWith("Something failed", {
      functionName: "testFunction",
      stage: "dev",
      serviceName: "service-stripe",
      err: error,
      subscriptionId: "sub_123",
    });
  });

  it("should delegate warn to strogger warn", () => {
    const logger = createStripeLogger("testFunction", "dev");

    logger.warn("Warning message", { detail: "something" });

    expect(mockWarn).toHaveBeenCalledWith("Warning message", {
      functionName: "testFunction",
      stage: "dev",
      serviceName: "service-stripe",
      detail: "something",
    });
  });

  it("should delegate debug to strogger debug", () => {
    const logger = createStripeLogger("testFunction", "dev");

    logger.debug("Debug message");

    expect(mockDebug).toHaveBeenCalledWith("Debug message", {
      functionName: "testFunction",
      stage: "dev",
      serviceName: "service-stripe",
    });
  });
});
