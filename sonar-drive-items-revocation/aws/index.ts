import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { route } from "../lib/router";

// API Gateway HTTP API payload format 2.0. SAR does not accept Lambda function URLs, so the template uses an HTTP API.
export type HttpApiEvent = {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { domainName: string; http: { method: string } };
};

export type HttpApiResult = { statusCode: number; headers: Record<string, string>; body: string };

export function toRequest(event: HttpApiEvent): Request {
  const { domainName, http } = event.requestContext;
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers ?? {})) if (value !== undefined) headers.set(name, value);
  // The signature covers the exact bytes Riot sent, so decode before anything reads the body.
  const body = event.body === undefined ? undefined : event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
  const hasBody = http.method !== "GET" && http.method !== "HEAD";
  return new Request(`https://${domainName}${event.rawPath}${query}`, { method: http.method, headers, body: hasBody ? body : undefined });
}

// The credentials live in Parameter Store, one SecureString per variable lib/config reads, named
// PARAMETER_PREFIX + the variable. Reloaded every minute so a value the deploy script just saved applies
// without a redeploy.
const SECRET_KEYS = ["RIOT_WEBHOOK_SECRET", "GOOGLE_SERVICE_ACCOUNT_JSON", "MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"];
const SECRET_TTL_MS = 60_000;
let ssm: SSMClient | undefined;
let loadedAt = 0;

async function loadSecrets(): Promise<void> {
  const prefix = process.env.PARAMETER_PREFIX;
  if (!prefix || Date.now() - loadedAt < SECRET_TTL_MS) return;
  ssm ??= new SSMClient({});
  const { Parameters = [] } = await ssm.send(
    new GetParametersCommand({ Names: SECRET_KEYS.map((key) => prefix + key), WithDecryption: true }),
  );
  const values = new Map(Parameters.map((p) => [p.Name, p.Value]));
  for (const key of SECRET_KEYS) {
    const value = values.get(prefix + key);
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
  loadedAt = Date.now();
}

export async function handler(event: HttpApiEvent): Promise<HttpApiResult> {
  await loadSecrets();
  const response = await route(toRequest(event));
  return { statusCode: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
}
