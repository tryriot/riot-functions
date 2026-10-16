import type { MicrosoftApp } from "./config";
import { classifyHttpError, ConfigurationError, type RevokeOutcome } from "./errors";

const GRAPH = "https://graph.microsoft.com/v1.0";
export const REQUIRED_ROLE = "Files.ReadWrite.All";

export async function microsoftAccessToken(app: MicrosoftApp): Promise<string> {
  if ("managedIdentity" in app) return managedIdentityToken();
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(app.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: app.clientId,
      client_secret: app.clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const body = await res.text();
  if (res.ok) return JSON.parse(body).access_token;
  if (res.status === 400 || res.status === 401) throw new ConfigurationError(`Microsoft token request failed: ${body}`);
  throw classifyHttpError("Microsoft token", res.status, body);
}

// Azure Functions exposes this endpoint once the app's system-assigned identity is on.
async function managedIdentityToken(): Promise<string> {
  const endpoint = process.env.IDENTITY_ENDPOINT;
  const header = process.env.IDENTITY_HEADER;
  if (!endpoint || !header) {
    throw new ConfigurationError("MS_MANAGED_IDENTITY only works on an Azure Function App with its system-assigned identity on");
  }
  const url = `${endpoint}?${new URLSearchParams({ resource: "https://graph.microsoft.com", "api-version": "2019-08-01" })}`;
  const res = await fetch(url, { headers: { "x-identity-header": header } });
  const body = await res.text();
  if (res.ok) return JSON.parse(body).access_token;
  if (res.status === 400 || res.status === 401) throw new ConfigurationError(`Managed identity token request failed: ${body}`);
  throw classifyHttpError("Managed identity token", res.status, body);
}

export function tokenRoles(token: string): string[] {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return Array.isArray(payload.roles) ? payload.roles : [];
  } catch {
    return [];
  }
}

export type MicrosoftRevocation = {
  owner_id: string;
  drive_item_id: string;
  permission_id: string;
  shared_drive_id?: string;
};

export function permissionUrl(data: MicrosoftRevocation): string {
  const drive = data.shared_drive_id
    ? `drives/${encodeURIComponent(data.shared_drive_id)}`
    : `users/${encodeURIComponent(data.owner_id)}/drive`;
  return `${GRAPH}/${drive}/items/${encodeURIComponent(data.drive_item_id)}/permissions/${encodeURIComponent(data.permission_id)}`;
}

export async function revokeMicrosoftPermission(app: MicrosoftApp, data: MicrosoftRevocation): Promise<RevokeOutcome> {
  const token = await microsoftAccessToken(app);
  const res = await fetch(permissionUrl(data), { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  if (res.ok) return { status: "revoked" };

  const body = await res.text();
  if (res.status === 404) return { status: "already_gone" };
  if (res.status === 400 && /inherit/i.test(body)) {
    return { status: "skipped", reason: "permission is inherited from a parent item" };
  }
  throw classifyHttpError("Microsoft Graph", res.status, body);
}

export async function checkMicrosoft(app: MicrosoftApp) {
  const roles = tokenRoles(await microsoftAccessToken(app));
  if (!roles.includes(REQUIRED_ROLE)) {
    throw new ConfigurationError(
      `Admin consent for ${REQUIRED_ROLE} is missing. Granted application permissions: ${roles.join(", ") || "none"}.`,
    );
  }
}
