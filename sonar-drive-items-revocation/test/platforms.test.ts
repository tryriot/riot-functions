import { HttpRequest } from "@azure/functions";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handler, type HttpApiEvent } from "@/aws/index";
import { handle } from "@/azure/index";
import { toRequest as nodeRequest } from "@/gcp/server";
import { route } from "@/lib/router";
import { sign } from "@/lib/signature";

const SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const body = JSON.stringify({
  type: "revoke_drive_item_permission_request.created",
  timestamp: "2026-10-14T10:00:00Z",
  data: { provider: "google", provider_data: { owner_id: "alice@acme.com", permission_id: "p1", drive_item_id: "f1" } },
});

function signedHeaders(payload = body) {
  const ts = Math.floor(Date.now() / 1000);
  return { "webhook-id": "msg_1", "webhook-timestamp": String(ts), "webhook-signature": sign(SECRET, "msg_1", ts, payload), "webhook-test": "true" };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("RIOT_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "");
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("router", () => {
  it("reports the configuration and webhook URL on GET /", async () => {
    const res = await route(new Request("https://revoker.example/"));
    expect(await res.json()).toMatchObject({ riotSecret: "ok", google: "missing", webhookUrl: "https://revoker.example/api/webhook" });
  });

  it("returns 404 on unknown paths", async () => {
    expect((await route(new Request("https://revoker.example/api/webhook"))).status).toBe(404);
  });
});

describe("AWS HTTP API adapter", () => {
  const event = (overrides: Partial<HttpApiEvent> = {}): HttpApiEvent => ({
    rawPath: "/api/webhook",
    headers: signedHeaders(),
    body,
    requestContext: { domainName: "abc.execute-api.eu-west-1.amazonaws.com", http: { method: "POST" } },
    ...overrides,
  });

  it("verifies the signature against a base64-encoded body", async () => {
    const res = await handler(event({ body: Buffer.from(body).toString("base64"), isBase64Encoded: true }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "test_received" });
  });

  it("rejects a tampered body", async () => {
    const res = await handler(event({ body: body.replace("p1", "p2") }));
    expect(res.statusCode).toBe(401);
  });

  it("serves the status page", async () => {
    const res = await handler(event({ rawPath: "/", body: undefined, requestContext: { domainName: "abc.example", http: { method: "GET" } } }));
    expect(JSON.parse(res.body).webhookUrl).toBe("https://abc.example/api/webhook");
  });
});

describe("Azure Functions adapter", () => {
  it("passes the raw body and headers through", async () => {
    const request = new HttpRequest({
      method: "POST",
      url: "https://revoker.azurewebsites.net/api/webhook",
      headers: signedHeaders(),
      body: { string: body },
    });
    const res = await handle(request);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ status: "test_received" });
  });
});

describe("Cloud Run adapter", () => {
  it("rebuilds the public URL and the body from the Node request", async () => {
    const message = Object.assign(Readable.from([Buffer.from(body)]), {
      method: "POST",
      url: "/api/webhook",
      headers: { host: "revoker-abc.a.run.app", "x-forwarded-proto": "https", ...signedHeaders() },
    }) as unknown as IncomingMessage;
    const request = await nodeRequest(message);
    expect(request.url).toBe("https://revoker-abc.a.run.app/api/webhook");
    expect(await (await route(request)).json()).toEqual({ status: "test_received" });
  });
});

describe("keyless Google service account", () => {
  it("signs the delegation assertion through IAM instead of a key", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "revoker@acme.iam.gserviceaccount.com");
    fetchMock
      .mockResolvedValueOnce(Response.json({ access_token: "metadata-token" }))
      .mockResolvedValueOnce(Response.json({ signedJwt: "signed.jwt.value" }))
      .mockResolvedValueOnce(Response.json({ access_token: "drive-token" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { "webhook-test": _, ...headers } = signedHeaders();
    const res = await route(new Request("https://x/api/webhook", { method: "POST", headers, body }));

    expect(await res.json()).toEqual({ status: "revoked" });
    const [signUrl, signInit] = fetchMock.mock.calls[1];
    expect(signUrl).toBe(
      "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/revoker%40acme.iam.gserviceaccount.com:signJwt",
    );
    expect(signInit.headers.authorization).toBe("Bearer metadata-token");
    expect(JSON.parse(JSON.parse(signInit.body).payload)).toMatchObject({ iss: "revoker@acme.iam.gserviceaccount.com", sub: "alice@acme.com" });
    expect(new URLSearchParams(fetchMock.mock.calls[2][1].body).get("assertion")).toBe("signed.jwt.value");
  });

  it("explains that keyless only works on Google Cloud", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "revoker@acme.iam.gserviceaccount.com");
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const { "webhook-test": _, ...headers } = signedHeaders();
    const res = await route(new Request("https://x/api/webhook", { method: "POST", headers, body }));
    expect(res.status).toBe(500);
    expect((await res.json()).message).toMatch(/only works on Google Cloud/);
  });

  it("rejects an email that is not a service account", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "alice@acme.com");
    expect(await (await route(new Request("https://x/"))).json()).toMatchObject({ google: "invalid" });
  });
});

describe("Microsoft managed identity", () => {
  const msBody = JSON.stringify({
    type: "revoke_drive_item_permission_request.created",
    timestamp: "2026-10-14T10:00:00Z",
    data: { provider: "microsoft", provider_data: { owner_id: "u1", permission_id: "p1", drive_item_id: "i1" } },
  });
  const deliver = () => {
    const { "webhook-test": _, ...headers } = signedHeaders(msBody);
    return route(new Request("https://x/api/webhook", { method: "POST", headers, body: msBody }));
  };

  it("gets the Graph token from the Function App identity", async () => {
    vi.stubEnv("MS_MANAGED_IDENTITY", "true");
    vi.stubEnv("IDENTITY_ENDPOINT", "http://localhost:8081/msi/token");
    vi.stubEnv("IDENTITY_HEADER", "h1");
    fetchMock
      .mockResolvedValueOnce(Response.json({ access_token: "mi-token" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    expect(await (await deliver()).json()).toEqual({ status: "revoked" });
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("http://localhost:8081/msi/token?resource=https%3A%2F%2Fgraph.microsoft.com&api-version=2019-08-01");
    expect(tokenInit.headers["x-identity-header"]).toBe("h1");
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe("Bearer mi-token");
  });

  it("explains that the identity must be on", async () => {
    vi.stubEnv("MS_MANAGED_IDENTITY", "true");
    vi.stubEnv("IDENTITY_ENDPOINT", "");
    const res = await deliver();
    expect(res.status).toBe(500);
    expect((await res.json()).message).toMatch(/system-assigned identity/);
  });
});
