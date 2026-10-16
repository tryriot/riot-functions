import { afterEach, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: vi.fn(() => ({ send })),
  GetParametersCommand: vi.fn((input: unknown) => input),
}));

const { handler } = await import("@/aws/index");

const status = () =>
  handler({ rawPath: "/", requestContext: { domainName: "abc.example", http: { method: "GET" } } }).then((res) => JSON.parse(res.body));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("reads the credentials from the stack's parameters and reloads them after a minute", async () => {
  vi.useFakeTimers();
  vi.stubEnv("PARAMETER_PREFIX", "/riot-sonar-revoker/");
  vi.stubEnv("RIOT_WEBHOOK_SECRET", "");
  send.mockResolvedValueOnce({ Parameters: [] });
  expect(await status()).toMatchObject({ riotSecret: "missing", microsoft: "missing" });

  const parameter = (name: string, Value: string) => ({ Name: `/riot-sonar-revoker/${name}`, Value });
  send.mockResolvedValueOnce({
    Parameters: [parameter("RIOT_WEBHOOK_SECRET", "whsec_abc"), parameter("MS_TENANT_ID", "t"), parameter("MS_CLIENT_ID", "c"), parameter("MS_CLIENT_SECRET", "s")],
  });
  expect(await status()).toMatchObject({ riotSecret: "missing" });
  vi.advanceTimersByTime(60_000);
  expect(await status()).toMatchObject({ riotSecret: "ok", microsoft: "ok" });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith({
    Names: ["RIOT_WEBHOOK_SECRET", "GOOGLE_SERVICE_ACCOUNT_JSON", "MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"].map((key) => `/riot-sonar-revoker/${key}`),
    WithDecryption: true,
  });
});
