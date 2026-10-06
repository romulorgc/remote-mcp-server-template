import { z } from "zod";
import { isHttpsOrLoopback, parseUrl } from "./url-policy.js";

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Treat an empty string (for example `AUTH_JWKS_URL=` in a .env file) as "not set". */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const SECURE_URL_MESSAGE = "must be an absolute https URL (http is only accepted for localhost)";

/** An absolute https URL (http only for loopback), without query or fragment. */
const secureUrl = z
  .string()
  .trim()
  .refine((value) => {
    const url = parseUrl(value);
    return url !== undefined && isHttpsOrLoopback(url) && url.search === "" && url.hash === "";
  }, SECURE_URL_MESSAGE);

/** The server origin: scheme, host and optional port. Normalized without a trailing slash. */
const publicUrl = z
  .string()
  .trim()
  .refine((value) => {
    const url = parseUrl(value);
    return (
      url !== undefined &&
      isHttpsOrLoopback(url) &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  }, "must be an origin only (scheme, host, optional port), https unless localhost, with no path")
  .transform((value) => new URL(value).origin);

/** Comma-separated list of browser origins, normalized to their serialized form. */
const allowedOrigins = z
  .string()
  .default("")
  .transform((raw, ctx) => {
    const origins: string[] = [];
    for (const item of raw.split(",")) {
      const entry = item.trim();
      if (entry === "") continue;
      const url = parseUrl(entry);
      const isOrigin =
        url !== undefined &&
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === "";
      if (!isOrigin) {
        ctx.issues.push({
          code: "custom",
          message: `"${entry}" is not a valid origin (expected scheme://host[:port], no path)`,
          input: raw,
        });
        return z.NEVER;
      }
      origins.push(url.origin);
    }
    return [...new Set(origins)];
  });

const envSchema = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  PUBLIC_URL: publicUrl,
  AUTH_ISSUER: secureUrl,
  AUTH_JWKS_URL: z.preprocess(emptyToUndefined, secureUrl.optional()),
  AUTH_AUDIENCE: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
  ALLOWED_ORIGINS: allowedOrigins,
});

export interface Config {
  host: string;
  port: number;
  /** Canonical origin of this server. Also the RFC 9728 `resource` identifier. */
  publicUrl: string;
  /** Issuer of the authorization server. Compared with the `iss` claim as an exact string. */
  issuer: string;
  /** JWKS endpoint. When undefined it is discovered from the issuer metadata. */
  jwksUrl: string | undefined;
  /** Expected `aud` claim of access tokens. Defaults to `publicUrl`. */
  audience: string;
  /** Browser origins allowed to call the server. Empty means none. */
  allowedOrigins: readonly string[];
}

/** Parse and validate configuration from environment variables. Throws `ConfigError`. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const values = parsed.data;
  return {
    host: values.HOST,
    port: values.PORT,
    publicUrl: values.PUBLIC_URL,
    issuer: values.AUTH_ISSUER,
    jwksUrl: values.AUTH_JWKS_URL,
    audience: values.AUTH_AUDIENCE ?? values.PUBLIC_URL,
    allowedOrigins: values.ALLOWED_ORIGINS,
  };
}
