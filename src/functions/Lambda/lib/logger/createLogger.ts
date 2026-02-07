import {
  createLogger as createStroggerLogger,
  createConsoleTransport,
  createJsonFormatter,
  getEnvironment,
} from "strogger";
import type { Logger } from "../../types/logger.types";

export const createStripeLogger = (
  functionName: string,
  stage: string,
  serviceName = "service-stripe",
): Logger => {
  const env = getEnvironment();
  const formatter = createJsonFormatter();
  const transport = createConsoleTransport({ formatter });

  const logger = createStroggerLogger({
    config: {
      serviceName,
      stage,
    },
    transports: [transport],
    formatter,
    env,
  });

  const baseContext = { functionName, stage, serviceName };

  return {
    info: (message, data?) => {
      logger.info(message, { ...baseContext, ...data });
    },
    warn: (message, data?) => {
      logger.warn(message, { ...baseContext, ...data });
    },
    error: (message, data?) => {
      logger.error(message, { ...baseContext, ...data });
    },
    debug: (message, data?) => {
      logger.debug(message, { ...baseContext, ...data });
    },
  };
};
