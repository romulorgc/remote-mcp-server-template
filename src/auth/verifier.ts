import { InvalidTokenError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { errors, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from "jose";
import { errorFields, type Logger } from "../logger.js";

/**
 * Asymmetric algorithms only. Symmetric (HS*) and `none` are never accepted, so a token
 * cannot be forged by someone who merely knows the public key.
 */
const ALLOWED_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
];

export interface JwtVerifierOptions {
  /** Expected `iss`, compared as an exact string. */
  issuer: string;
  /** Expected `aud`: this server (RFC 8707 resource indicator). */
  audience: string;
  getKey: JWTVerifyGetKey;
  logger: Logger;
  /** Allowed clock drift in seconds when checking `exp` and `nbf`. */
  clockToleranceSeconds?: number;
}

/** Errors that mean "this token is not acceptable", as opposed to "we could not check it". */
function isTokenProblem(error: unknown): boolean {
  return (
    error instanceof errors.JWTExpired ||
    error instanceof errors.JWTClaimValidationFailed ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JOSEAlgNotAllowed ||
    error instanceof errors.JOSENotSupported ||
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWKSMultipleMatchingKeys
  );
}

function describeTokenProblem(error: unknown): string {
  if (error instanceof errors.JWTExpired) return "Token has expired";
  if (error instanceof errors.JWTClaimValidationFailed) {
    return error.claim === "aud"
      ? "Token was not issued for this resource"
      : `Token claim "${error.claim}" is not acceptable`;
  }
  return "Token is not valid";
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Scopes from `scope` (RFC 9068, space-delimited string) or `scp` (string or array, used by some IdPs). */
function readScopes(payload: JWTPayload): string[] {
  const scopes = new Set<string>();
  for (const claim of [payload.scope, payload.scp]) {
    const items =
      typeof claim === "string" ? claim.split(/\s+/) : Array.isArray(claim) ? claim : [];
    for (const item of items) {
      if (typeof item === "string" && item !== "") scopes.add(item);
    }
  }
  return [...scopes];
}

/**
 * Validates JWT access tokens against the issuer's JWKS: signature, `iss`, `aud`, `exp`/`nbf`.
 * Implements the SDK's `OAuthTokenVerifier`, so it plugs into `requireBearerAuth`.
 */
export class JwtAccessTokenVerifier implements OAuthTokenVerifier {
  constructor(private readonly options: JwtVerifierOptions) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.options.getKey, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ALLOWED_ALGORITHMS,
        requiredClaims: ["exp", "sub"],
        clockTolerance: this.options.clockToleranceSeconds ?? 5,
      }));
    } catch (error) {
      if (isTokenProblem(error)) throw new InvalidTokenError(describeTokenProblem(error));
      // JWKS unreachable, malformed metadata, and similar: our side, not the client's.
      this.options.logger.error("token verification unavailable", errorFields(error));
      throw new ServerError("Unable to verify the access token");
    }

    const { sub, exp } = payload;
    if (sub === undefined || exp === undefined) {
      throw new InvalidTokenError("Token is not valid");
    }

    return {
      // The raw bearer token is deliberately not kept. Tool code sees who the caller is and
      // what they may do, never a credential it could forward to another service
      // (the MCP spec forbids token passthrough).
      token: "",
      clientId: stringClaim(payload.client_id) ?? stringClaim(payload.azp) ?? "",
      scopes: readScopes(payload),
      expiresAt: exp,
      extra: { sub },
    };
  }
}
