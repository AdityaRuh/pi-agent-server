/**
 * Env reader. Mirrors the pattern in pi-sdk-runtime.
 */

function required(name: string): string {
  const value = Bun.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = Bun.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export const env = {
  port: Number(optional("PORT", "8080")),
  host: optional("HOST", "0.0.0.0"),
  piSdkRuntimeUrl: optional("PI_SDK_RUNTIME_URL", "http://pi-sdk-runtime:7000"),
  internalSharedToken: required("INTERNAL_SHARED_TOKEN"),
  gatewaySharedToken: required("GATEWAY_SHARED_TOKEN"),
  logLevel: optional("LOG_LEVEL", "info"),
} as const;
