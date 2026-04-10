import type { Server } from "node:http";
import type { Logger } from "pino";
import { createLogger, resolveLogLevel } from "./config/logger";

interface ShutdownContext {
  server: Server;
  logger: Logger;
  cleanup: () => void;
}

function serializeUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    value: String(error)
  };
}

function setupRuntimeHandlers(context: ShutdownContext): void {
  const { server, logger, cleanup } = context;
  let isShuttingDown = false;

  const shutdown = (reason: string, exitCode: number): void => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logger.info({ reason }, "shutdown_started");

    const forceExitTimer = setTimeout(() => {
      logger.fatal({ reason }, "shutdown_forced_timeout");
      cleanup();
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    server.close((closeError) => {
      clearTimeout(forceExitTimer);

      if (closeError) {
        logger.fatal(
          {
            reason,
            error: serializeUnknownError(closeError)
          },
          "shutdown_failed"
        );
        cleanup();
        process.exit(1);
        return;
      }

      cleanup();
      logger.info({ reason }, "shutdown_complete");
      process.exit(exitCode);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM", 0));
  process.on("SIGINT", () => shutdown("SIGINT", 0));

  process.on("uncaughtException", (error) => {
    logger.fatal({ error: serializeUnknownError(error) }, "uncaught_exception");
    shutdown("uncaughtException", 1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ error: serializeUnknownError(reason) }, "unhandled_rejection");
    shutdown("unhandledRejection", 1);
  });

  server.on("error", (error) => {
    logger.fatal({ error: serializeUnknownError(error) }, "startup_failed");
    cleanup();
    process.exit(1);
  });
}

async function bootstrap(): Promise<void> {
  const startupLogger = createLogger(resolveLogLevel(process.env.LOG_LEVEL));

  try {
    const [{ env }, { createApp }] = await Promise.all([import("./config/env"), import("./app")]);

    const logger = createLogger(env.LOG_LEVEL);
    const app = createApp({ logger });
    const cleanup = () => {
      const maybeShutdown = (app.locals as { shutdown?: () => void }).shutdown;
      if (typeof maybeShutdown === "function") {
        maybeShutdown();
      }
    };

    const server = app.listen(env.PORT, () => {
      logger.info(
        {
          port: env.PORT,
          environment: env.NODE_ENV
        },
        "startup_complete"
      );
    });

    setupRuntimeHandlers({ server, logger, cleanup });
  } catch (error) {
    startupLogger.fatal({ error: serializeUnknownError(error) }, "startup_failed");
    process.exit(1);
  }
}

void bootstrap();
