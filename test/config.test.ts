import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const valid = {
  PUBLIC_URL: "https://mcp.example.com",
  AUTH_ISSUER: "https://idp.example.com/",
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig(valid);

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 3000,
      publicUrl: "https://mcp.example.com",
      issuer: "https://idp.example.com/",
      jwksUrl: undefined,
      audience: "https://mcp.example.com",
      allowedOrigins: [],
    });
  });

  it("defaults the audience to PUBLIC_URL and lets AUTH_AUDIENCE override it", () => {
    expect(loadConfig(valid).audience).toBe("https://mcp.example.com");
    expect(loadConfig({ ...valid, AUTH_AUDIENCE: "api://mcp" }).audience).toBe("api://mcp");
    expect(loadConfig({ ...valid, AUTH_AUDIENCE: "" }).audience).toBe("https://mcp.example.com");
  });

  it("normalizes PUBLIC_URL to an origin without a trailing slash", () => {
    expect(loadConfig({ ...valid, PUBLIC_URL: "https://MCP.example.com/" }).publicUrl).toBe(
      "https://mcp.example.com",
    );
  });

  it("keeps the issuer byte for byte, trailing slash included", () => {
    expect(loadConfig(valid).issuer).toBe("https://idp.example.com/");
    expect(loadConfig({ ...valid, AUTH_ISSUER: "https://idp.example.com" }).issuer).toBe(
      "https://idp.example.com",
    );
  });

  it("treats an empty AUTH_JWKS_URL as unset", () => {
    expect(loadConfig({ ...valid, AUTH_JWKS_URL: "" }).jwksUrl).toBeUndefined();
    expect(loadConfig({ ...valid, AUTH_JWKS_URL: "https://idp.example.com/keys" }).jwksUrl).toBe(
      "https://idp.example.com/keys",
    );
  });

  it("parses ALLOWED_ORIGINS into a deduplicated list of origins", () => {
    const config = loadConfig({
      ...valid,
      ALLOWED_ORIGINS: " http://localhost:6274, https://app.example.com/ ,http://localhost:6274",
    });

    expect(config.allowedOrigins).toEqual(["http://localhost:6274", "https://app.example.com"]);
  });

  it("accepts http for localhost only", () => {
    expect(
      loadConfig({ PUBLIC_URL: "http://localhost:3000", AUTH_ISSUER: "http://127.0.0.1:9000" }),
    ).toMatchObject({ publicUrl: "http://localhost:3000" });
    expect(() => loadConfig({ ...valid, AUTH_ISSUER: "http://idp.example.com" })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ ...valid, PUBLIC_URL: "http://mcp.example.com" })).toThrow(
      ConfigError,
    );
  });

  it("rejects missing required variables, naming them", () => {
    expect(() => loadConfig({})).toThrowError(
      /PUBLIC_URL[\s\S]*AUTH_ISSUER|AUTH_ISSUER[\s\S]*PUBLIC_URL/,
    );
  });

  it("rejects a PUBLIC_URL that carries a path", () => {
    expect(() => loadConfig({ ...valid, PUBLIC_URL: "https://mcp.example.com/mcp" })).toThrow(
      /origin only/,
    );
  });

  it("rejects an invalid origin in ALLOWED_ORIGINS", () => {
    expect(() =>
      loadConfig({ ...valid, ALLOWED_ORIGINS: "https://ok.example.com,nonsense" }),
    ).toThrow(/not a valid origin/);
    expect(() => loadConfig({ ...valid, ALLOWED_ORIGINS: "https://app.example.com/path" })).toThrow(
      /not a valid origin/,
    );
  });

  it("rejects an invalid PORT", () => {
    expect(() => loadConfig({ ...valid, PORT: "abc" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...valid, PORT: "70000" })).toThrow(ConfigError);
  });
});
