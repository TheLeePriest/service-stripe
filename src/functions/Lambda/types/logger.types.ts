import type { LogData } from "strogger";

export type Logger = {
  info: (message: string, data?: LogData) => void;
  warn: (message: string, data?: LogData) => void;
  error: (message: string, data?: LogData) => void;
  debug: (message: string, data?: LogData) => void;
};

export type LoggerDependencies = {
  logger: Logger;
};
