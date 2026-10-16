import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { route } from "../lib/router";

export async function toRequest(request: HttpRequest): Promise<Request> {
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? Buffer.from(await request.arrayBuffer()) : undefined,
  });
}

export async function handle(request: HttpRequest): Promise<HttpResponseInit> {
  const response = await route(await toRequest(request));
  return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
}

// host.json sets an empty routePrefix, so "{*path}" receives /api/webhook unchanged.
app.http("riot-sonar-revoker", { route: "{*path}", methods: ["GET", "POST"], authLevel: "anonymous", handler: handle });
