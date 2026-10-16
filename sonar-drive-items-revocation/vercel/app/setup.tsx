"use client";

import { useEffect, useState } from "react";
import type { ConfigStatus } from "../../lib/config";
import { EntraSecretShot } from "./illustrations";

type State = "done" | "todo" | "error" | "skipped";
type Check = { ok: boolean; message: string } | null;
type SubStep = { title: React.ReactNode; body?: React.ReactNode; media?: React.ReactNode };

const STORAGE_KEY = "riot-sonar-revoker:manual";
const EVENT_TYPE = "revoke_drive_item_permission_request.created";
const vercelLink = (path: string, title: string) =>
  `https://vercel.com/d?to=${encodeURIComponent(`/[team]/[project]/${path}`)}&title=${encodeURIComponent(title)}`;
const VERCEL_ENV = vercelLink("settings/environment-variables", "Add an environment variable");
const HUB_SETTINGS = "https://hub.tryriot.com/settings/about";
const ENTRA_APPS = "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade";
const VERCEL_DEPLOYMENTS = vercelLink("deployments", "Redeploy");

function useManual() {
  const [manual, setManual] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      setManual(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"));
    } catch {}
  }, []);
  const toggle = (key: string, patch?: Record<string, boolean>) =>
    setManual((prev) => {
      const next = { ...prev, ...(patch ?? { [key]: !prev[key] }) };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return { manual, toggle };
}

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
);
const CopyIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5.5" y="5.5" width="8" height="8" rx="2" /><path d="M10.5 3.5v-.5a1.5 1.5 0 00-1.5-1.5H4A1.5 1.5 0 002.5 3v5A1.5 1.5 0 004 9.5h.5" /></svg>
);
const ExternalIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5L7 9" /></svg>
);
const Chevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="chevron" style={{ transform: open ? "rotate(180deg)" : undefined }}><path d="M4 6l4 4 4-4" /></svg>
);

function ProgressCircle({ percent }: { percent: number }) {
  const c = 2 * Math.PI * 8;
  return (
    <svg viewBox="0 0 20 20" width="20" height="20">
      <circle cx="10" cy="10" r="8" fill="none" stroke="var(--gray-200)" strokeWidth="2.5" />
      <circle cx="10" cy="10" r="8" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - percent)} transform="rotate(-90 10 10)" style={{ transition: "stroke-dashoffset .4s" }} />
    </svg>
  );
}

function Copy({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy">
      <code>{value}</code>
      <button type="button" aria-label="Copy" onClick={() => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

const Ext = ({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) => (
  <a className={`btn ${primary ? "primary" : ""}`} href={href} target="_blank" rel="noreferrer">{children}<ExternalIcon /></a>
);

const Shot = ({ src, alt }: { src: string; alt: string }) => <img className="media-img" src={src} alt={alt} />;

const redeploy = (extra?: React.ReactNode): SubStep => ({
  title: "Redeploy, then reload this page",
  body: (
    <>
      <p>After saving, Vercel shows a blue box. Click <b>Redeploy</b> in it, then <b>Redeploy</b> again to confirm.</p>
      <p className="note">Box gone? Open deployments, click <b>⋯</b> on the latest one, then <b>Redeploy</b>.</p>
      <div className="actions">
        <Ext href={VERCEL_DEPLOYMENTS}>Open deployments</Ext>
        <button type="button" className="btn" onClick={() => location.reload()}>Reload this page</button>
      </div>
      {extra}
    </>
  ),
  media: <Shot src="/tutorial/vercel-redeploy-toast.jpg" alt="Vercel Redeploy button after adding a variable" />,
});

const STATUS: Partial<Record<State, string>> = { error: "Needs attention", skipped: "Skipped" };

function Step(props: {
  state: State; title: string; summary?: React.ReactNode; open: boolean; onToggle: () => void; steps?: SubStep[]; children?: React.ReactNode;
}) {
  const [active, setActive] = useState(0);
  const finished = props.state === "done" || props.state === "skipped";
  const media = props.steps?.[active]?.media;
  return (
    <section className={`step ${props.state} ${props.open ? "open" : ""}`}>
      <button type="button" className="step-head" onClick={props.onToggle} aria-expanded={props.open}>
        <span className="dot">{finished ? <CheckIcon /> : props.state === "error" ? "!" : null}</span>
        <span className="step-title">{props.title}</span>
        {STATUS[props.state] && <span className={`pill ${props.state}`}>{STATUS[props.state]}</span>}
        <Chevron open={props.open} />
      </button>
      {props.open && (
        <div className={`step-body ${media ? "with-media" : ""}`}>
          <div className="sub-list">
            {props.summary && <p className={`banner ${props.state}`}>{props.summary}</p>}
            {props.steps?.map((s, i) => (
              <div key={i} className={`sub ${i === active ? "active" : ""} ${i < active ? "past" : ""}`}>
                <button type="button" className="sub-head" onClick={() => setActive(i)}>
                  <span className="sub-n">{i < active ? <CheckIcon /> : i + 1}</span>
                  <span>{s.title}</span>
                </button>
                {i === active && (
                  <div className="sub-body">
                    {s.body}
                    {media && <div className="media-inline">{media}</div>}
                    {i < props.steps!.length - 1 && (
                      <div className="actions"><button type="button" className="btn" onClick={() => setActive(i + 1)}>Next</button></div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {props.children}
          </div>
          {media && <div className="media">{media}</div>}
        </div>
      )}
    </section>
  );
}

function Tick({ id, manual, toggle, children }: { id: string; manual: Record<string, boolean>; toggle: (k: string) => void; children: React.ReactNode }) {
  return (
    <label className="tick">
      <input type="checkbox" checked={Boolean(manual[id])} onChange={() => toggle(id)} />
      <span>{children}</span>
    </label>
  );
}

async function runCheck(provider: string, email?: string): Promise<Check> {
  const res = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, email }) });
  return res.json();
}

export function Setup({ status, webhookUrl }: { status: ConfigStatus; webhookUrl: string }) {
  const { manual, toggle } = useManual();
  const [googleEmail, setGoogleEmail] = useState("");
  const [googleCheck, setGoogleCheck] = useState<Check>(null);
  const [msCheck, setMsCheck] = useState<Check>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const check = async (provider: "google" | "microsoft") => {
    setBusy(provider);
    const r = await runCheck(provider, googleEmail).catch((e) => ({ ok: false, message: String(e) }));
    (provider === "google" ? setGoogleCheck : setMsCheck)(r);
    setBusy(null);
  };

  const providerState = (configured: string, checkResult: Check): State => {
    if (configured === "missing") return "todo";
    if (configured !== "ok" || checkResult?.ok === false) return "error";
    return checkResult?.ok ? "done" : "todo";
  };

  const riotState: State = status.riotSecret === "ok" ? "done" : status.riotSecret === "invalid" ? "error" : "todo";
  const googleState = providerState(status.google, googleCheck);
  const msState = providerState(status.microsoft, msCheck);
  const testState: State = manual["riot-test"] ? "done" : "todo";
  const activeState: State = manual["riot-enabled"] ? "done" : "todo";

  const provider = manual["use-microsoft"] ? "microsoft"
    : manual["use-google"] ? "google"
    : status.google !== "missing" ? "google"
    : status.microsoft !== "missing" ? "microsoft"
    : null;
  const usesGoogle = provider === "google";
  const usesMicrosoft = provider === "microsoft";
  const pick = (p: "google" | "microsoft") =>
    toggle("", { "use-google": p === "google", "use-microsoft": p === "microsoft" });
  const chooseState: State = usesGoogle || usesMicrosoft ? "done" : "todo";

  const flow: [string, State][] = [
    ["deploy", "done"],
    ["choose", chooseState],
    ["riot", riotState],
    ...(usesGoogle ? [["google", googleState] as [string, State]] : []),
    ...(usesMicrosoft ? [["microsoft", msState] as [string, State]] : []),
    ["test", testState],
    ["active", activeState],
  ];
  const states = flow.map(([, st]) => st);
  const doneCount = states.filter((st) => st === "done").length;
  const firstOpen = states.findIndex((st) => st !== "done");

  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => setOpen(firstOpen === -1 ? null : firstOpen), [firstOpen]);
  const stepProps = (key: string) => {
    const i = flow.findIndex(([k]) => k === key);
    return { state: states[i], open: open === i, onToggle: () => setOpen(open === i ? null : i) };
  };

  return (
    <main>
      <header className="hero">
        <p className="eyebrow"><span className="logo">R</span>Riot Sonar</p>
        <h1>Permission revoker</h1>
        <p className="lead">
          Receives revocation requests from Riot Sonar and removes the sharing in Google Drive or Microsoft 365. Riot keeps
          read-only access, write access stays in your cloud.
        </p>
      </header>

      <div className="card">
        <div className="card-head">
          <ProgressCircle percent={doneCount / states.length} />
          <span className="primary">Set up</span>
          <span>·</span>
          <span>{doneCount} of {states.length} completed</span>
        </div>

        <div className="steps">
          <Step {...stepProps("deploy")} title="Deploy this app">
            <p>This page is running, so the deployment worked. Nothing to do here.</p>
          </Step>

          <Step {...stepProps("choose")} title="Choose your workspace">
            <p>Where do your employees share files? Pick one.</p>
            <div className="choices">
              <button type="button" className="choice" aria-pressed={usesGoogle} onClick={() => pick("google")}>
                Google Workspace
              </button>
              <button type="button" className="choice" aria-pressed={usesMicrosoft} onClick={() => pick("microsoft")}>
                Microsoft 365
              </button>
            </div>
          </Step>

          <Step {...stepProps("riot")} title="Create the webhook endpoint in Riot"
            summary={riotState === "error" ? <><code>RIOT_WEBHOOK_SECRET</code> must start with <code>whsec_</code>.</> : undefined}
            steps={[
              {
                title: "Create the endpoint in Riot",
                body: (
                  <>
                    <div className="actions"><Ext href={HUB_SETTINGS} primary>Open Riot settings</Ext></div>
                    <p>Click the <b>API</b> tab at the top, then <b>Create endpoint</b>.</p>
                    <p>Name: <code>Sonar revoker</code>. Endpoint URL:</p>
                    <Copy value={webhookUrl} />
                    <p>Tick only <b>{EVENT_TYPE}</b>, then <b>Create endpoint</b>.</p>
                  </>
                ),
                media: <Shot src="/tutorial/riot-create-endpoint.jpg" alt="Riot Create endpoint form" />,
              },
              {
                title: "Copy the signing secret",
                body: <p>Riot shows the secret once. Click the copy button next to it and keep the tab open.</p>,
                media: <Shot src="/tutorial/riot-signing-secret.jpg" alt="Riot Save signing secret dialog" />,
              },
              {
                title: <>Add it to Vercel as <code>RIOT_WEBHOOK_SECRET</code></>,
                body: (
                  <>
                    <p>Key:</p>
                    <Copy value="RIOT_WEBHOOK_SECRET" />
                    <p>Value: paste the secret. Click <b>Save</b>.</p>
                    <div className="actions"><Ext href={VERCEL_ENV} primary>Open environment variables</Ext></div>
                  </>
                ),
                media: <Shot src="/tutorial/vercel-env.jpg" alt="Vercel Add Environment Variable form" />,
              },
              redeploy(),
            ]}
          />

          {usesGoogle && <Step {...stepProps("google")} title="Connect Google Workspace"
            summary={status.google === "invalid" ? <><code>GOOGLE_SERVICE_ACCOUNT_JSON</code> is set but is not a valid service account key.</> : googleCheck?.message}
            steps={[
              {
                title: "Create a project and enable the Drive API",
                body: (
                  <div className="actions">
                    <Ext href="https://console.cloud.google.com/projectcreate" primary>Create project</Ext>
                    <Ext href="https://console.cloud.google.com/apis/library/drive.googleapis.com">Enable Drive API</Ext>
                  </div>
                ),
                media: <Shot src="/tutorial/gcp-enable-drive.jpg" alt="Enable the Google Drive API" />,
              },
              {
                title: "Create a service account",
                body: (
                  <>
                    <div className="actions"><Ext href="https://console.cloud.google.com/iam-admin/serviceaccounts/create" primary>Create service account</Ext></div>
                    <p>Service account name:</p>
                    <Copy value="riot-sonar-revoker" />
                    <p>Click <b>Create and close</b>. Skip permissions, no role needed.</p>
                  </>
                ),
                media: <Shot src="/tutorial/gcp-create-sa.jpg" alt="Create the service account" />,
              },
              {
                title: "Download a JSON key and copy the Unique ID",
                body: (
                  <>
                    <div className="actions"><Ext href="https://console.cloud.google.com/iam-admin/serviceaccounts" primary>Open service accounts</Ext></div>
                    <p>Click <b>riot-sonar-revoker</b>, then the <b>Keys</b> tab.</p>
                    <p><b>Add key → Create new key → JSON → Create</b>. A file downloads.</p>
                    <p>Open the <b>Details</b> tab and copy the <b>Unique ID</b>. You need it next.</p>
                  </>
                ),
                media: <Shot src="/tutorial/gcp-add-key.jpg" alt="Keys tab with Add key, Create new key" />,
              },
              {
                title: "Allow domain-wide delegation",
                body: (
                  <>
                    <p>Click <b>Add new</b>. Client ID: the Unique ID. OAuth scope:</p>
                    <Copy value="https://www.googleapis.com/auth/drive" />
                    <div className="actions"><Ext href="https://admin.google.com/ac/owl/domainwidedelegation" primary>Open Admin console</Ext></div>
                    <p className="note">Delegation can take a few minutes to apply.</p>
                  </>
                ),
                media: <Shot src="/tutorial/google-delegation.jpg" alt="Add new client ID with the Drive scope" />,
              },
              {
                title: <>Add the key to Vercel as <code>GOOGLE_SERVICE_ACCOUNT_JSON</code></>,
                body: (
                  <>
                    <p>Key:</p>
                    <Copy value="GOOGLE_SERVICE_ACCOUNT_JSON" />
                    <p>Value: open the downloaded file, paste all of it. Click <b>Save</b>.</p>
                    <div className="actions"><Ext href={VERCEL_ENV} primary>Open environment variables</Ext></div>
                  </>
                ),
                media: <Shot src="/tutorial/vercel-env-google.jpg" alt="Vercel env var with the JSON key" />,
              },
              redeploy(
                <>
                  <p>Then check access with the email of any user in your domain:</p>
                  <div className="check">
                    <input type="email" placeholder="someone@yourcompany.com" value={googleEmail} onChange={(e) => setGoogleEmail(e.target.value)} />
                    <button type="button" className="btn primary" disabled={status.google !== "ok" || busy !== null} onClick={() => check("google")}>
                      {busy === "google" ? "Checking…" : "Check Google"}
                    </button>
                  </div>
                </>,
              ),
            ]}
          >
          </Step>}

          {usesMicrosoft && <Step {...stepProps("microsoft")} title="Connect Microsoft 365"
            summary={status.microsoft === "partial" ? <><code>MS_TENANT_ID</code>, <code>MS_CLIENT_ID</code> and <code>MS_CLIENT_SECRET</code> must all be set.</> : msCheck?.message}
            steps={[
              {
                title: "Register an app in Entra",
                body: (
                  <>
                    <p>Name it <code>Riot Sonar Revoker</code>, keep <b>single tenant</b>, leave the redirect URI empty.</p>
                    <div className="actions"><Ext href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade" primary>Open Entra</Ext></div>
                  </>
                ),
                media: <Shot src="/tutorial/entra-register.jpg" alt="Entra Register an application form" />,
              },
              {
                title: "Add the Files.ReadWrite.All permission",
                body: (
                  <>
                    <div className="actions"><Ext href={ENTRA_APPS} primary>Open app registrations</Ext></div>
                    <p>Open <b>Riot Sonar Revoker → API permissions → Add a permission</b>.</p>
                    <p>Pick <b>Microsoft Graph → Application permissions</b>, search and tick:</p>
                    <Copy value="Files.ReadWrite.All" />
                    <p>Click <b>Add permissions</b>.</p>
                  </>
                ),
                media: <Shot src="/tutorial/entra-add-permission.jpg" alt="Request API permissions with Files.ReadWrite.All ticked" />,
              },
              {
                title: "Grant admin consent",
                body: (
                  <>
                    <p>Back on <b>API permissions</b>, remove <code>User.Read</code> with <b>⋯</b>.</p>
                    <p>Click <b>Grant admin consent</b> and confirm. The status turns green.</p>
                  </>
                ),
                media: <Shot src="/tutorial/entra-api-permissions.jpg" alt="API permissions blade with Grant admin consent" />,
              },
              {
                title: "Create a client secret and copy the IDs",
                body: (
                  <>
                    <p><b>Certificates &amp; secrets → New client secret → Add</b>. Copy the <b>Value</b> column right away, it is shown once.</p>
                    <p>On <b>Overview</b>, keep <b>Application (client) ID</b> and <b>Directory (tenant) ID</b> at hand.</p>
                  </>
                ),
                media: <EntraSecretShot />,
              },
              {
                title: "Add the three values to Vercel",
                body: (
                  <>
                    <p>Copy this, paste it in the <b>Key</b> field, Vercel splits it into three rows. Fill the three values, then <b>Save</b>.</p>
                    <Copy value={"MS_TENANT_ID=\nMS_CLIENT_ID=\nMS_CLIENT_SECRET="} />
                    <div className="actions"><Ext href={VERCEL_ENV} primary>Open environment variables</Ext></div>
                  </>
                ),
                media: <Shot src="/tutorial/vercel-env-microsoft.jpg" alt="Vercel env vars for Microsoft" />,
              },
              redeploy(
                <div className="check">
                  <button type="button" className="btn primary" disabled={status.microsoft !== "ok" || busy !== null} onClick={() => check("microsoft")}>
                    {busy === "microsoft" ? "Checking…" : "Check Microsoft"}
                  </button>
                </div>,
              ),
            ]}
          >
          </Step>}

          <Step {...stepProps("test")} title="Send a test event from Riot"
            steps={[
              {
                title: "Send a test event",
                body: (
                  <>
                    <div className="actions"><Ext href={HUB_SETTINGS} primary>Open Riot settings</Ext></div>
                    <p>In the <b>API</b> tab, click <b>⋯</b> on your endpoint, then <b>Send test</b>.</p>
                    <p>Pick <code>{EVENT_TYPE}</code> and click <b>Send test</b>. Riot must show <b>Your endpoint accepted the test</b>. Nothing is revoked.</p>
                    <p className="note">A 401 means <code>RIOT_WEBHOOK_SECRET</code> does not match the secret in Riot.</p>
                  </>
                ),
                media: <Shot src="/tutorial/riot-send-test.jpg" alt="Riot endpoint menu with Send test" />,
              },
            ]}
          >
            <Tick id="riot-test" manual={manual} toggle={toggle}>Riot says “Your endpoint accepted the test”</Tick>
          </Step>

          <Step {...stepProps("active")} title="Switch your workspace to webhook mode">
            <p>
              Ask your Riot account manager to switch Sonar revocations to webhook mode. Every revocation from the hub, the employee
              Portal or auto-revocation is then sent here, and Riot only asks for read-only scopes.
            </p>
            <p className="note">
              Follow revocations in your Vercel logs: <code>revoked</code>, <code>already_gone</code>, or <code>skipped</code> for inherited
              permissions. Riot retries failures for about three days.
            </p>
            <Tick id="riot-enabled" manual={manual} toggle={toggle}>Riot confirmed webhook mode is on</Tick>
          </Step>
        </div>
      </div>
    </main>
  );
}
