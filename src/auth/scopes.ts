/** Scopes this server understands. Advertised as `scopes_supported` in the resource metadata. */
export const SCOPES = {
  notesRead: "notes:read",
  notesWrite: "notes:write",
} as const;

export const SUPPORTED_SCOPES: readonly string[] = Object.values(SCOPES);

/**
 * Scopes named in the first 401 challenge: the minimal set for basic use. Everything else is
 * requested later, through the step-up flow, when a tool needs it (least privilege).
 */
export const BASELINE_SCOPES: readonly string[] = [SCOPES.notesRead];

/**
 * Scope hierarchy: a broader scope implies narrower ones.
 *
 * The MCP authorization spec requires servers to account for hierarchies when deciding
 * whether a token is sufficient. Here, the umbrella scope `notes` implies both
 * `notes:read` and `notes:write`. Leave the map empty if your scopes are flat.
 */
export const SCOPE_HIERARCHY: Readonly<Record<string, readonly string[]>> = {
  notes: [SCOPES.notesRead, SCOPES.notesWrite],
};

/** Every scope a token effectively holds: the granted ones plus whatever they imply. */
export function expandScopes(granted: readonly string[]): Set<string> {
  const effective = new Set<string>();
  const pending = [...granted];
  for (let scope = pending.pop(); scope !== undefined; scope = pending.pop()) {
    if (effective.has(scope)) continue;
    effective.add(scope);
    pending.push(...(SCOPE_HIERARCHY[scope] ?? []));
  }
  return effective;
}

/** The required scopes the token does not hold (directly or through the hierarchy). */
export function missingScopes(granted: readonly string[], required: readonly string[]): string[] {
  const effective = expandScopes(granted);
  return required.filter((scope) => !effective.has(scope));
}

function quote(value: string): string {
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

export interface BearerChallenge {
  /** URL of the Protected Resource Metadata document (RFC 9728). */
  resourceMetadata: string;
  /** RFC 6750 error code, for example `insufficient_scope`. */
  error?: string;
  errorDescription?: string;
  /** Scopes needed for the operation, emitted as a space-separated list. */
  scope?: readonly string[];
}

/** Build a `WWW-Authenticate: Bearer ...` header value (RFC 6750 section 3, RFC 9728 section 5.1). */
export function buildBearerChallenge(challenge: BearerChallenge): string {
  const params: string[] = [];
  if (challenge.error !== undefined) params.push(`error=${quote(challenge.error)}`);
  if (challenge.scope !== undefined && challenge.scope.length > 0) {
    params.push(`scope=${quote(challenge.scope.join(" "))}`);
  }
  params.push(`resource_metadata=${quote(challenge.resourceMetadata)}`);
  if (challenge.errorDescription !== undefined) {
    params.push(`error_description=${quote(challenge.errorDescription)}`);
  }
  return `Bearer ${params.join(", ")}`;
}
