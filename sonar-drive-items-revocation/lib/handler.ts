import { riotSecrets } from "./config";
import { ConfigurationError, RetryableError } from "./errors";
import { EVENT_TYPE, parseEvent, revoke } from "./revoke";
import { verify } from "./signature";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handleWebhook(request: Request): Promise<Response> {
  const secrets = riotSecrets();
  if (secrets.length === 0) return json(500, { error: "RIOT_WEBHOOK_SECRET is not configured" });

  const body = await request.text();
  const h = request.headers;
  const verification = verify(
    secrets,
    { id: h.get("webhook-id"), timestamp: h.get("webhook-timestamp"), signature: h.get("webhook-signature") },
    body,
  );
  if (!verification.ok) return json(401, { error: verification.reason });

  const webhookId = h.get("webhook-id");
  const event = parseEvent(body);
  if (!event) return json(400, { error: "invalid payload" });
  if (event.type !== EVENT_TYPE) return json(200, { status: "ignored", type: event.type });

  if (h.get("webhook-test") === "true") {
    console.log(JSON.stringify({ webhookId, msg: "test delivery received, nothing revoked" }));
    return json(200, { status: "test_received" });
  }

  try {
    const outcome = await revoke(event);
    console.log(JSON.stringify({ webhookId, provider: event.data.provider, ...event.data.provider_data, ...outcome }));
    return json(200, outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ webhookId, provider: event.data.provider, ...event.data.provider_data, error: message }));
    if (error instanceof RetryableError) return json(503, { error: message });
    if (error instanceof ConfigurationError) return json(500, { error: "configuration", message });
    return json(500, { error: message });
  }
}
