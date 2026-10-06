import type { Response } from "express";

/** JSON-RPC 2.0 error codes used by this server. */
export const JSONRPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  internalError: -32603,
  /** Implementation-defined server error range (-32000 to -32099), as used by the SDK transport. */
  serverError: -32000,
} as const;

/** Send a JSON-RPC error response with no request id, as the transport spec allows for HTTP-level errors. */
export function sendJsonRpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}
