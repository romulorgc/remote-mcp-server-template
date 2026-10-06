/** Hosts for which plain http is acceptable (local development only). */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https everywhere; http only when the host is the local machine. */
export function isHttpsOrLoopback(url: URL): boolean {
  return (
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname))
  );
}

/** Parse an absolute URL, returning undefined instead of throwing. */
export function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
