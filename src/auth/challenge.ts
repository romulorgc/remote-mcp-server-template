import type { RequestHandler } from "express";
import { BASELINE_SCOPES, buildBearerChallenge } from "./scopes.js";

/**
 * Answer a request that carries no credentials at all with the bare challenge the spec shows:
 *
 *   HTTP 401
 *   WWW-Authenticate: Bearer scope="notes:read", resource_metadata="https://.../.well-known/oauth-protected-resource"
 *
 * RFC 6750 section 3.1 says a challenge for a request without credentials SHOULD NOT carry an
 * error code, and the SDK's `requireBearerAuth` always adds `error="invalid_token"`. So this runs
 * first and leaves the SDK middleware to deal with credentials that are present but wrong.
 *
 * `scope` is the minimal set for basic use. Clients start the authorization flow with it
 * (Scope Selection Strategy) and step up later if a tool asks for more.
 */
export function challengeMissingCredentials(resourceMetadataUrl: string): RequestHandler {
  return (req, res, next) => {
    if (req.headers.authorization !== undefined) {
      next();
      return;
    }
    res.set(
      "WWW-Authenticate",
      buildBearerChallenge({ scope: BASELINE_SCOPES, resourceMetadata: resourceMetadataUrl }),
    );
    res.status(401).json({ error: "unauthorized", error_description: "Authentication required" });
  };
}
