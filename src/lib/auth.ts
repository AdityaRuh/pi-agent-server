/**
 * Bearer-token check. The gateway carries one of:
 *
 *   Authorization: Bearer <GATEWAY_SHARED_TOKEN>
 *   X-Gateway-Token: <GATEWAY_SHARED_TOKEN>
 *
 * Anything else is 401.
 */

import { env } from "@/lib/env";

export function assertGatewayToken(
  headers: Record<string, string | undefined>,
): void {
  const expected = env.gatewaySharedToken;
  const auth = headers["authorization"];
  if (auth === `Bearer ${expected}`) return;
  const xGateway = headers["x-gateway-token"];
  if (xGateway === expected) return;
  const err = new Error("unauthorized");
  (err as Error & { code?: string }).code = "unauthorized";
  throw err;
}
