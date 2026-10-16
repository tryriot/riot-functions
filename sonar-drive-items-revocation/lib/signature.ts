import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 5 * 60;

export type SignatureHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export type VerifyResult = { ok: true } | { ok: false; reason: string };

function secretKey(secret: string): Buffer {
  return Buffer.from(secret.replace(/^whsec_/, ""), "base64");
}

export function sign(secret: string, id: string, timestamp: number, body: string): string {
  const mac = createHmac("sha256", secretKey(secret)).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${mac}`;
}

export function verify(
  secrets: string[],
  headers: SignatureHeaders,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifyResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing webhook headers" };

  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: "invalid webhook-timestamp" };
  if (Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return { ok: false, reason: "timestamp outside tolerance" };

  const received = signature
    .split(" ")
    .filter((s) => s.startsWith("v1,"))
    .map((s) => Buffer.from(s.slice(3), "base64"));

  for (const secret of secrets) {
    const expected = Buffer.from(sign(secret, id, ts, body).slice(3), "base64");
    if (received.some((r) => r.length === expected.length && timingSafeEqual(r, expected))) return { ok: true };
  }
  return { ok: false, reason: "no matching signature" };
}
