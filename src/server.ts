import type { Server } from "node:http";
import type { Logger } from "pino";
import { createLogger, resolveLogLevel } from "./config/logger";

interface ShutdownContext {
  server: Server;
  logger: Logger;
  cleanup: () => Promise<void>;
  forceExitTimeoutMs: number;
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
  const { server, logger, cleanup, forceExitTimeoutMs } = context;
  let isShuttingDown = false;

  const shutdown = (reason: string, exitCode: number): void => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logger.info({ reason }, "shutdown_started");

    const forceExitTimer = setTimeout(() => {
      logger.fatal({ reason }, "shutdown_forced_timeout");
      void cleanup().catch((error) => {
        logger.fatal({ error: serializeUnknownError(error) }, "shutdown_cleanup_failed");
      });
      process.exit(1);
    }, forceExitTimeoutMs);
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
        void cleanup().catch((cleanupError) => {
          logger.fatal(
            {
              reason,
              error: serializeUnknownError(cleanupError)
            },
            "shutdown_cleanup_failed"
          );
        });
        process.exit(1);
        return;
      }

      void cleanup()
        .then(() => {
          logger.info({ reason }, "shutdown_complete");
          process.exit(exitCode);
        })
        .catch((cleanupError) => {
          logger.fatal(
            {
              reason,
              error: serializeUnknownError(cleanupError)
            },
            "shutdown_cleanup_failed"
          );
          process.exit(1);
        });
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
    void cleanup().catch((cleanupError) => {
      logger.fatal({ error: serializeUnknownError(cleanupError) }, "shutdown_cleanup_failed");
    });
    process.exit(1);
  });
}

async function bootstrap(): Promise<void> {
  const startupLogger = createLogger(resolveLogLevel(process.env.LOG_LEVEL));

  try {
    const [{ env }, { createApp }] = await Promise.all([import("./config/env"), import("./app")]);

    const logger = createLogger(env.LOG_LEVEL);
    const app = createApp({ logger });
    const cleanup = async () => {
      const maybeShutdown = (
        app.locals as { shutdown?: () => void | Promise<void> }
      ).shutdown;
      if (typeof maybeShutdown === "function") {
        await maybeShutdown();
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

    setupRuntimeHandlers({
      server,
      logger,
      cleanup,
      forceExitTimeoutMs: Math.max(10_000, env.CONTACT_SYNC_QUEUE_SHUTDOWN_DRAIN_MS + 5_000)
    });
  } catch (error) {
    startupLogger.fatal({ error: serializeUnknownError(error) }, "startup_failed");
    process.exit(1);
  }
}

void bootstrap();
