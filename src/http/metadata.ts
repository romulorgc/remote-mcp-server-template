import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { RequestHandler } from "express";
import { SUPPORTED_SCOPES } from "../auth/scopes.js";
import type { Config } from "../config.js";

/** Where the Protected Resource Metadata document lives (RFC 9728, root form). */
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/** Absolute URL of the metadata document, for the `resource_metadata` challenge parameter. */
export function protectedResourceMetadataUrl(config: Config): string {
  return new URL(PROTECTED_RESOURCE_METADATA_PATH, config.publicUrl).href;
}

/** The RFC 9728 document: which resource this is, and which authorization server issues tokens for it. */
export function buildProtectedResourceMetadata(config: Config): OAuthProtectedResourceMetadata {
  return {
    resource: config.publicUrl,
    authorization_servers: [config.issuer],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Remote MCP server template",
  };
}

export function protectedResourceMetadataHandler(config: Config): RequestHandler {
  const document = buildProtectedResourceMetadata(config);
  return (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json(document);
  };
}
