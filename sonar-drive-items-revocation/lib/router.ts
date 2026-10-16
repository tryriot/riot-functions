import { handleCheck } from "./check";
import { configStatus } from "./config";
import { handleWebhook } from "./handler";

// Single entry point for the platforms that hand us one function for every path (Lambda, Azure Functions, Cloud Run).
export async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { method } = request;
  if (method === "POST" && url.pathname === "/api/webhook") return handleWebhook(request);
  if (method === "POST" && url.pathname === "/api/check") return handleCheck(request);
  if (method === "GET" && (url.pathname === "/" || url.pathname === "/api/status")) {
    return Response.json({ ...configStatus(), webhookUrl: `${url.origin}/api/webhook` });
  }
  return Response.json({ error: "not found" }, { status: 404 });
}
