import type { IncomingMessage, ServerResponse } from "node:http";
import { route } from "../lib/router";

async function readBody(message: IncomingMessage): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Buffer[] = [];
  for await (const chunk of message) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

export async function toRequest(message: IncomingMessage): Promise<Request> {
  const method = message.method ?? "GET";
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const hasBody = method !== "GET" && method !== "HEAD";
  // Cloud Run terminates TLS, so the original scheme only survives in x-forwarded-proto.
  const proto = headers.get("x-forwarded-proto") ?? "http";
  return new Request(`${proto}://${headers.get("host") ?? "localhost"}${message.url ?? "/"}`, {
    method,
    headers,
    body: hasBody ? await readBody(message) : undefined,
  });
}

export async function serve(message: IncomingMessage, res: ServerResponse) {
  try {
    const response = await route(await toRequest(message));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal error" }));
  }
}

