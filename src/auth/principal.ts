import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/** The authenticated caller, as tool code sees it. */
export interface Principal {
  /** Stable user identifier from the token's `sub` claim. The tenant key for all stored data. */
  readonly sub: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
}

/** Build a `Principal` from the auth info the bearer middleware attached to the request. */
export function principalFromAuthInfo(authInfo: AuthInfo | undefined): Principal {
  const sub = authInfo?.extra?.sub;
  if (authInfo === undefined || typeof sub !== "string" || sub === "") {
    // Unreachable behind the auth middleware. Failing closed beats serving anonymous data.
    throw new Error("Request reached a tool without an authenticated principal");
  }
  return { sub, clientId: authInfo.clientId, scopes: authInfo.scopes };
}
