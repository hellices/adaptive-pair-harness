import { createHash } from "node:crypto";

export const parseSafeRemoteEndpoint = (value: string): URL | undefined => {
  if (value.length === 0 || value !== value.trim()) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0 ||
      parsed.origin === "null" ||
      (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname))
    ) {
      return undefined;
    }

    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
    }
    return parsed;
  } catch (error: unknown) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    return undefined;
  }
};

export const requireSafeRemoteEndpoint = (endpoint: URL): URL => {
  const validated = parseSafeRemoteEndpoint(endpoint.toString());
  if (validated === undefined) {
    throw new Error("OpenAI-compatible provider endpoint is unsafe.");
  }
  return validated;
};

export const canonicalEndpointOrigin = (endpoint: URL): string =>
  requireSafeRemoteEndpoint(endpoint).origin;

export const apiKeySecretNameForEndpoint = (endpoint: URL): string => {
  const originHash = createHash("sha256")
    .update(canonicalEndpointOrigin(endpoint), "utf8")
    .digest("hex")
    .slice(0, 24);
  return `adaptivePair.openaiCompatibleApiKey.${originHash}`;
};

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.replace(/^\[(.*)\]$/u, "$1").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }

  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet)) &&
    Number(octets[0]) === 127 &&
    octets.every((octet) => Number(octet) <= 255)
  );
};
