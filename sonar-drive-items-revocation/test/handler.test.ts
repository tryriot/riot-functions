import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleWebhook } from "@/lib/handler";
import { permissionUrl, tokenRoles } from "@/lib/microsoft";
import { sign, verify } from "@/lib/signature";

const SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const now = () => Math.floor(Date.now() / 1000);

function delivery(payload: unknown, opts: { secret?: string; test?: boolean; ts?: number } = {}) {
  const body = JSON.stringify(payload);
  const ts = opts.ts ?? now();
  const headers: Record<string, string> = {
    "webhook-id": "msg_1",
    "webhook-timestamp": String(ts),
    "webhook-signature": sign(opts.secret ?? SECRET, "msg_1", ts, body),
  };
  if (opts.test) headers["webhook-test"] = "true";
  return new Request("https://x/api/webhook", { method: "POST", headers, body });
}

const googleEvent = {
  type: "revoke_drive_item_permission_request.created",
  timestamp: "2026-10-14T10:00:00Z",
  data: { provider: "google", provider_data: { owner_id: "alice@acme.com", permission_id: "anyoneWithLink", drive_item_id: "file1" } },
};
const msEvent = {
  ...googleEvent,
  data: { provider: "microsoft", provider_data: { owner_id: "u1", permission_id: "p1", drive_item_id: "i1", shared_drive_id: "b!d1" } },
};

const fetchMock = vi.fn();

beforeEach(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  vi.stubEnv("RIOT_WEBHOOK_SECRET", SECRET);
  vi.stubEnv(
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    JSON.stringify({ client_email: "sa@p.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }),
  );
  vi.stubEnv("MS_TENANT_ID", "t");
  vi.stubEnv("MS_CLIENT_ID", "c");
  vi.stubEnv("MS_CLIENT_SECRET", "s");
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const token = () => new Response(JSON.stringify({ access_token: "tok" }));

describe("signature", () => {
  it("accepts any of the rotated secrets and rejects others", () => {
    const body = "{}";
    const ts = now();
    const headers = { id: "a", timestamp: String(ts), signature: `v1,bogus ${sign(SECRET, "a", ts, body)}` };
    expect(verify(["whsec_b3RoZXI=", SECRET], headers, body).ok).toBe(true);
    expect(verify(["whsec_b3RoZXI="], headers, body).ok).toBe(false);
  });

  it("rejects stale timestamps", () => {
    const ts = now() - 600;
    expect(verify([SECRET], { id: "a", timestamp: String(ts), signature: sign(SECRET, "a", ts, "{}") }, "{}").ok).toBe(false);
  });
});

describe("handleWebhook", () => {
  it("returns 401 on a bad signature", async () => {
    const res = await handleWebhook(delivery(googleEvent, { secret: "whsec_d3Jvbmc=" }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("acknowledges test deliveries without revoking", async () => {
    const res = await handleWebhook(delivery(googleEvent, { test: true }));
    expect(await res.json()).toEqual({ status: "test_received" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores other event types", async () => {
    const res = await handleWebhook(delivery({ type: "inbox_email_analysis.classified", data: {} }));
    expect(res.status).toBe(200);
  });

  it("revokes a Google permission as the owner", async () => {
    fetchMock.mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await handleWebhook(delivery(googleEvent));
    expect(await res.json()).toEqual({ status: "revoked" });
    const assertion = new URLSearchParams(fetchMock.mock.calls[0][1].body).get("assertion")!;
    expect(JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString()).sub).toBe("alice@acme.com");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://www.googleapis.com/drive/v3/files/file1/permissions/anyoneWithLink?supportsAllDrives=true",
    );
  });

  it("treats a missing permission as already revoked", async () => {
    fetchMock.mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response("not found", { status: 404 }));
    expect(await (await handleWebhook(delivery(googleEvent))).json()).toEqual({ status: "already_gone" });
  });

  it("asks Riot to retry on rate limits", async () => {
    fetchMock.mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response("slow down", { status: 429 }));
    expect((await handleWebhook(delivery(googleEvent))).status).toBe(503);
  });

  it("revokes a Microsoft permission on a shared drive", async () => {
    fetchMock.mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await handleWebhook(delivery(msEvent))).status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe("https://graph.microsoft.com/v1.0/drives/b!d1/items/i1/permissions/p1");
  });
});

describe("microsoft helpers", () => {
  it("uses the owner's drive without a shared drive id", () => {
    expect(permissionUrl({ owner_id: "u1", drive_item_id: "i", permission_id: "p" })).toBe(
      "https://graph.microsoft.com/v1.0/users/u1/drive/items/i/permissions/p",
    );
  });

  it("reads application roles from the token", () => {
    const payload = Buffer.from(JSON.stringify({ roles: ["Files.ReadWrite.All"] })).toString("base64url");
    expect(tokenRoles(`h.${payload}.s`)).toEqual(["Files.ReadWrite.All"]);
  });
});
