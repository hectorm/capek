import { useRuntimeConfig } from "nitropack/runtime/config";
import pino from "pino";

const config = useRuntimeConfig();

let logger: pino.Logger | null = null;

export const useLogger = (): pino.Logger => {
  logger ??= pino({
    level: config.logLevel,
    transport: import.meta.dev ? { target: "pino-pretty", options: { colorize: true } } : undefined,
    serializers: {
      ...pino.stdSerializers,
      error: pino.stdSerializers.wrapErrorSerializer((err) => {
        return { message: err.message, cause: err.cause };
      }),
    },
  });

  return logger;
};
