import { googleServiceAccount, microsoftApp } from "./config";
import { ConfigurationError, type RevokeOutcome } from "./errors";
import { revokeGooglePermission } from "./google";
import { revokeMicrosoftPermission } from "./microsoft";

export const EVENT_TYPE = "revoke_drive_item_permission_request.created";

export type RevokeEvent = {
  type: string;
  timestamp: string;
  data: {
    provider: "google" | "microsoft";
    provider_data: { owner_id: string; permission_id: string; drive_item_id: string; shared_drive_id?: string };
  };
};

export function parseEvent(body: string): RevokeEvent | null {
  try {
    const event = JSON.parse(body);
    const pd = event?.data?.provider_data;
    if (
      typeof event?.type !== "string" ||
      !["google", "microsoft"].includes(event?.data?.provider) ||
      typeof pd?.owner_id !== "string" ||
      typeof pd?.permission_id !== "string" ||
      typeof pd?.drive_item_id !== "string"
    ) {
      return event?.type && event.type !== EVENT_TYPE ? event : null;
    }
    return event;
  } catch {
    return null;
  }
}

export async function revoke(event: RevokeEvent): Promise<RevokeOutcome> {
  const { provider, provider_data } = event.data;
  if (provider === "google") {
    const sa = googleServiceAccount();
    if (!sa) throw new ConfigurationError("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
    return revokeGooglePermission(sa, provider_data);
  }
  const app = microsoftApp();
  if (!app) throw new ConfigurationError("MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET, or MS_MANAGED_IDENTITY, are not configured");
  return revokeMicrosoftPermission(app, provider_data);
}
