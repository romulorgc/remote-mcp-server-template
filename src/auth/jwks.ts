import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { isHttpsOrLoopback } from "../url-policy.js";

const DISCOVERY_TIMEOUT_MS = 5_000;

export interface KeyResolverOptions {
  issuer: string;
  /** Explicit JWKS endpoint. When omitted it is discovered from the issuer metadata. */
  jwksUrl?: string | undefined;
}

function assertSecureUrl(value: string, what: string): URL {
  const url = new URL(value);
  if (!isHttpsOrLoopback(url)) throw new Error(`${what} must use https: ${value}`);
  return url;
}

function remoteJwks(url: URL): JWTVerifyGetKey {
  return createRemoteJWKSet(url, {
    timeoutDuration: 5_000,
    // Refetch at most once every 30 s when a token carries an unknown `kid`,
    // so a flood of forged tokens cannot turn into a flood of JWKS requests.
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
}

/**
 * Metadata documents to try for an issuer, in order:
 * 1. OpenID Connect Discovery (the path is appended to the issuer),
 * 2. RFC 8414 (the well-known segment is inserted before the issuer path).
 */
export function discoveryUrls(issuer: string): string[] {
  const url = new URL(issuer);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return [
    `${url.origin}${path}/.well-known/openid-configuration`,
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
  ];
}

/** Resolve `jwks_uri` from the issuer metadata, checking that the document names the same issuer. */
export async function discoverJwksUri(issuer: string): Promise<string> {
  const failures: string[] = [];
  for (const metadataUrl of discoveryUrls(issuer)) {
    try {
      const response = await fetch(metadataUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!response.ok) {
        failures.push(`${metadataUrl} answered ${response.status}`);
        continue;
      }
      const metadata = (await response.json()) as { issuer?: unknown; jwks_uri?: unknown };
      // RFC 8414 section 3.3 and OIDC Discovery section 4.3: the document must name the
      // issuer it was fetched for, otherwise a mix-up between servers is possible.
      if (metadata.issuer !== issuer) {
        failures.push(`${metadataUrl} names a different issuer`);
        continue;
      }
      if (typeof metadata.jwks_uri !== "string") {
        failures.push(`${metadataUrl} has no jwks_uri`);
        continue;
      }
      return assertSecureUrl(metadata.jwks_uri, "jwks_uri").href;
    } catch (error) {
      failures.push(
        `${metadataUrl} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(`Could not discover the JWKS URI for issuer ${issuer}. ${failures.join("; ")}`);
}

/**
 * Key resolver for `jwtVerify`. Keys are fetched from the JWKS endpoint, cached, and rotated
 * by `kid`. With no explicit `jwksUrl`, discovery runs lazily on the first token and is
 * retried on the next one if it fails, so the server can start before the IdP is reachable.
 */
export function createKeyResolver(options: KeyResolverOptions): JWTVerifyGetKey {
  if (options.jwksUrl !== undefined) {
    return remoteJwks(assertSecureUrl(options.jwksUrl, "AUTH_JWKS_URL"));
  }

  let resolver: Promise<JWTVerifyGetKey> | undefined;
  return async (protectedHeader, token) => {
    resolver ??= discoverJwksUri(options.issuer)
      .then((uri) => remoteJwks(new URL(uri)))
      .catch((error: unknown) => {
        resolver = undefined;
        throw error;
      });
    return (await resolver)(protectedHeader, token);
  };
}
