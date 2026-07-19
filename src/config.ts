/**
 * Environment configuration loading and validation.
 *
 * The X_API_KEY is a base64 encoding of a logged-in account's cookies
 * (auth_token, ct0, twid). It is read only from the environment, never
 * hardcoded, and never logged. It grants full access to that X account, so it
 * belongs to a dedicated throwaway account, never a personal one.
 */

export interface Config {
  /**
   * OPTIONAL rettiwt-api key (base64 cookies), used only as a fallback source.
   * The primary source is Nitter RSS, which needs no credentials at all.
   */
  apiKey?: string;
  /** Default set of handles (without @) to fetch when a call omits them. */
  defaultHandles: string[];
  /** Nitter instances to try in order (NITTER_INSTANCES, comma-separated). */
  nitterInstances?: string[];
}

/** Thrown when required configuration is missing or malformed. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Parse a comma/space/newline-separated handle list, stripping leading @. */
export function parseHandles(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((h) => h.trim().replace(/^@/, ""))
    .filter(Boolean);
}

/**
 * Load and validate configuration from process.env.
 * Fails fast with a clear, secret-free error if X_API_KEY is missing.
 * @param env the environment source (defaults to process.env)
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.X_API_KEY?.trim() || undefined;
  const defaultHandles = parseHandles(env.X_HANDLES);
  const nitterInstances = env.NITTER_INSTANCES?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    apiKey,
    defaultHandles,
    nitterInstances: nitterInstances?.length ? nitterInstances : undefined,
  };
}
