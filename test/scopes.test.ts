import { describe, expect, it } from "vitest";
import { buildBearerChallenge, expandScopes, missingScopes } from "../src/auth/scopes.js";

describe("scopes", () => {
  it("expands the hierarchy", () => {
    expect([...expandScopes(["notes"])].sort()).toEqual(["notes", "notes:read", "notes:write"]);
    expect([...expandScopes(["notes:read"])]).toEqual(["notes:read"]);
  });

  it("reports only the scopes that are missing", () => {
    expect(missingScopes(["notes:read"], ["notes:read", "notes:write"])).toEqual(["notes:write"]);
    expect(missingScopes(["notes"], ["notes:read", "notes:write"])).toEqual([]);
    expect(missingScopes([], [])).toEqual([]);
  });
});

describe("buildBearerChallenge", () => {
  it("builds a bare challenge for missing credentials", () => {
    expect(buildBearerChallenge({ resourceMetadata: "https://mcp.example.com/m" })).toBe(
      'Bearer resource_metadata="https://mcp.example.com/m"',
    );
  });

  it("builds an insufficient_scope challenge in the order the spec shows", () => {
    expect(
      buildBearerChallenge({
        error: "insufficient_scope",
        scope: ["notes:write", "notes:admin"],
        resourceMetadata: "https://mcp.example.com/m",
        errorDescription: "Write permission required",
      }),
    ).toBe(
      'Bearer error="insufficient_scope", scope="notes:write notes:admin", resource_metadata="https://mcp.example.com/m", error_description="Write permission required"',
    );
  });

  it("escapes quotes and backslashes in parameter values", () => {
    const header = buildBearerChallenge({
      resourceMetadata: "https://mcp.example.com/m",
      errorDescription: 'say "hi" \\ bye',
    });

    expect(header).toContain('error_description="say \\"hi\\" \\\\ bye"');
  });
});
