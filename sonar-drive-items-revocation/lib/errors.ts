export type RevokeOutcome =
  | { status: "revoked" }
  | { status: "already_gone" }
  | { status: "skipped"; reason: string };

export class RetryableError extends Error {}
export class ConfigurationError extends Error {}

export function classifyHttpError(provider: string, status: number, body: string): Error {
  const message = `${provider} responded ${status}: ${body.slice(0, 500)}`;
  if (status === 429 || status >= 500) return new RetryableError(message);
  if (status === 401 || status === 403) return new ConfigurationError(message);
  return new Error(message);
}
