import pino, { type LevelWithSilent, type Logger } from "pino";

const service = "activecampaign-contact-sync-api";
const validLevels: LevelWithSilent[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent"
];

export function resolveLogLevel(value: string | undefined): LevelWithSilent {
  if (!value) {
    return "info";
  }

  if (validLevels.includes(value as LevelWithSilent)) {
    return value as LevelWithSilent;
  }

  return "info";
}

export function createLogger(level: LevelWithSilent): Logger {
  const stream = pino.multistream(
    [
      { level: "trace", stream: process.stdout },
      { level: "fatal", stream: process.stderr }
    ],
    { dedupe: true }
  );

  return pino(
    {
      level,
      base: {
        service
      }
    },
    stream
  );
}
