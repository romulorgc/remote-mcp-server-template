export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export type LogSink = (level: LogLevel, line: string) => void;

/** Keys whose values are never written, whatever the caller passes. A safety net, not a license. */
const SENSITIVE_KEY = /authorization|token|secret|password|cookie/i;

const stdSink: LogSink = (level, line) => {
  const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
};

/** One JSON object per line. Pass a custom sink to capture output in tests. */
export function createLogger(sink: LogSink = stdSink): Logger {
  const write = (level: LogLevel, msg: string, fields: LogFields = {}): void => {
    const line = JSON.stringify(
      { level, time: new Date().toISOString(), msg, ...fields },
      (key, value: unknown) => (SENSITIVE_KEY.test(key) ? "[redacted]" : value),
    );
    sink(level, line);
  };
  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
  };
}

/** Name and message only: stack traces and causes can carry request data. */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) return { errName: error.name, errMessage: error.message };
  return { errMessage: String(error) };
}
