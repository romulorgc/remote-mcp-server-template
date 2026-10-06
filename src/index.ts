import { createServer } from "node:http";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createLogger, errorFields } from "./logger.js";

const logger = createLogger();

function main(): void {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error("invalid configuration", { issues: error.message.split("\n") });
      process.exit(1);
    }
    throw error;
  }

  const server = createServer(createApp({ config, logger }));

  server.on("error", (error) => {
    logger.error("server error", errorFields(error));
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    logger.info("listening", {
      host: config.host,
      port: config.port,
      publicUrl: config.publicUrl,
      issuer: config.issuer,
      audience: config.audience,
    });
  });

  const shutdown = (signal: string): void => {
    logger.info("shutting down", { signal });
    server.close((error) => process.exit(error ? 1 : 0));
    server.closeIdleConnections();
    // Give in-flight requests a few seconds, then cut whatever is left.
    setTimeout(() => server.closeAllConnections(), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
