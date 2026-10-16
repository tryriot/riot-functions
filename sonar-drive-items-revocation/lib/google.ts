import { createSign } from "node:crypto";
import type { GoogleServiceAccount } from "./config";
import { classifyHttpError, ConfigurationError, type RevokeOutcome } from "./errors";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

export function assertionClaims(clientEmail: string, subject: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  return { iss: clientEmail, sub: subject, scope: DRIVE_SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 };
}

export function buildAssertion(sa: Required<GoogleServiceAccount>, subject: string, nowSeconds?: number) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify(assertionClaims(sa.client_email, subject, nowSeconds)));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key);
  return `${header}.${claims}.${base64url(signature)}`;
}

async function metadataAccessToken(): Promise<string> {
  const res = await fetch(METADATA_TOKEN_URL, { headers: { "metadata-flavor": "Google" } }).catch(() => null);
  if (!res?.ok) {
    throw new ConfigurationError("GOOGLE_SERVICE_ACCOUNT_EMAIL only works on Google Cloud; elsewhere set GOOGLE_SERVICE_ACCOUNT_JSON");
  }
  return (await res.json()).access_token;
}

// Lets Cloud Run do domain-wide delegation without a key file: the runtime service account needs
// roles/iam.serviceAccountTokenCreator on the delegated service account (itself, in the default setup).
async function signAssertionWithIam(clientEmail: string, subject: string): Promise<string> {
  const res = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(clientEmail)}:signJwt`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${await metadataAccessToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ payload: JSON.stringify(assertionClaims(clientEmail, subject)) }),
    },
  );
  const body = await res.text();
  if (!res.ok) throw classifyHttpError("Google IAM signJwt", res.status, body);
  return JSON.parse(body).signedJwt;
}

const signAssertion = (sa: GoogleServiceAccount, subject: string) =>
  sa.private_key ? Promise.resolve(buildAssertion({ ...sa, private_key: sa.private_key }, subject)) : signAssertionWithIam(sa.client_email, subject);

export async function googleAccessToken(sa: GoogleServiceAccount, subject: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: await signAssertion(sa, subject),
    }),
  });
  const body = await res.text();
  if (res.ok) return JSON.parse(body).access_token;
  // unauthorized_client means domain-wide delegation is not granted for this client ID and scope.
  if (res.status === 400 || res.status === 401) throw new ConfigurationError(`Google token exchange failed: ${body}`);
  throw classifyHttpError("Google token", res.status, body);
}

export type GoogleRevocation = { owner_id: string; drive_item_id: string; permission_id: string };

export async function revokeGooglePermission(sa: GoogleServiceAccount, data: GoogleRevocation): Promise<RevokeOutcome> {
  const token = await googleAccessToken(sa, data.owner_id);
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(data.drive_item_id)}` +
    `/permissions/${encodeURIComponent(data.permission_id)}?supportsAllDrives=true`;
  const res = await fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  if (res.ok) return { status: "revoked" };

  const body = await res.text();
  if (res.status === 404) return { status: "already_gone" };
  if (res.status === 403 && /inherit/i.test(body)) {
    return { status: "skipped", reason: "permission is inherited from a parent folder or shared drive" };
  }
  throw classifyHttpError("Google Drive", res.status, body);
}

export async function checkGoogle(sa: GoogleServiceAccount, adminEmail: string) {
  const token = await googleAccessToken(sa, adminEmail);
  const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw classifyHttpError("Google Drive", res.status, await res.text());
}
