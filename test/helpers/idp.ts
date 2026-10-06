import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

export interface SignOptions {
  issuer: string;
  audience: string | string[];
  sub?: string | undefined;
  /** Space-separated scopes for the `scope` claim. Omit for a token without scopes. */
  scope?: string;
  /** Seconds since epoch. Defaults to one hour from now. */
  expiresAt?: number;
  /** Seconds since epoch. Defaults to now. */
  issuedAt?: number;
  /** Extra claims merged into the payload. */
  claims?: Record<string, unknown>;
}

export interface TestIdp {
  /** Issuer URL. Equal to the `iss` claim of tokens signed through `sign`. */
  issuer: string;
  jwksUrl: string;
  /** Number of times the JWKS endpoint was fetched. */
  jwksRequests(): number;
  /** Sign a token with the key published in the JWKS. */
  sign(options: SignOptions): Promise<string>;
  /** Sign a token with a key that is NOT published in the JWKS. */
  signWithUnpublishedKey(options: SignOptions): Promise<string>;
  close(): Promise<void>;
}

export interface TestIdpOptions {
  /** Issuer the discovery document claims. Defaults to the real one. Used to test mix-up protection. */
  discoveryIssuer?: string;
}

async function signJwt(key: SigningKey, kid: string, options: SignOptions): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...options.claims,
  })
    .setProtectedHeader({ alg: "ES256", kid, typ: "at+jwt" })
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setIssuedAt(options.issuedAt ?? now)
    .setExpirationTime(options.expiresAt ?? now + 3600);
  if (options.sub !== undefined) jwt.setSubject(options.sub);
  return jwt.sign(key);
}

/**
 * A minimal identity provider for tests: it owns a signing key, publishes the public half as a
 * JWKS and serves an OIDC discovery document. Tokens are forged locally; no real provider is involved.
 */
export async function startTestIdp(options: TestIdpOptions = {}): Promise<TestIdp> {
  const kid = "test-key-1";
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const unpublished = await generateKeyPair("ES256");
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };

  let jwksRequests = 0;
  let issuer = "";

  const server = createServer((req, res) => {
    const send = (body: unknown): void => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (req.url === "/jwks.json") {
      jwksRequests += 1;
      send({ keys: [publicJwk] });
    } else if (req.url === "/.well-known/openid-configuration") {
      send({ issuer: options.discoveryIssuer ?? issuer, jwks_uri: `${issuer}/jwks.json` });
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    jwksUrl: `${issuer}/jwks.json`,
    jwksRequests: () => jwksRequests,
    sign: (signOptions) => signJwt(privateKey, kid, signOptions),
    signWithUnpublishedKey: (signOptions) => signJwt(unpublished.privateKey, kid, signOptions),
    close: () =>
      new Promise<void>((resolve) => {
        // Safe to call twice: closing a server that is not running just reports an error.
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
