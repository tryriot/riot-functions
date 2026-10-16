// Without a private key, the assertion is signed by the IAM Credentials API as the service account the code runs as.
export type GoogleServiceAccount = { client_email: string; private_key?: string };
// With a managed identity, Azure issues the Graph token to the Function App itself, so no secret exists.
export type MicrosoftApp = { tenantId: string; clientId: string; clientSecret: string } | { managedIdentity: true };

export function riotSecrets(): string[] {
  return (process.env.RIOT_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function googleServiceAccount(): GoogleServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return keylessServiceAccount();
  try {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

function keylessServiceAccount(): GoogleServiceAccount | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  return email && /^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(email) ? { client_email: email } : null;
}

export function microsoftApp(): MicrosoftApp | null {
  if (process.env.MS_MANAGED_IDENTITY?.trim() === "true") return { managedIdentity: true };
  const tenantId = process.env.MS_TENANT_ID?.trim();
  const clientId = process.env.MS_CLIENT_ID?.trim();
  const clientSecret = process.env.MS_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

export type ConfigStatus = {
  riotSecret: "missing" | "invalid" | "ok";
  google: "missing" | "invalid" | "ok";
  microsoft: "missing" | "partial" | "ok";
};

export function configStatus(): ConfigStatus {
  const secrets = riotSecrets();
  const anyGoogle = ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SERVICE_ACCOUNT_EMAIL"].some((k) => process.env[k]?.trim());
  const anyMicrosoft = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_MANAGED_IDENTITY"].some((k) => process.env[k]?.trim());
  return {
    riotSecret: secrets.length === 0 ? "missing" : secrets.every((s) => s.startsWith("whsec_")) ? "ok" : "invalid",
    google: !anyGoogle ? "missing" : googleServiceAccount() ? "ok" : "invalid",
    microsoft: !anyMicrosoft ? "missing" : microsoftApp() ? "ok" : "partial",
  };
}
