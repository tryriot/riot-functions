import type { ReactNode } from "react";

type Brand = "riot" | "vercel" | "gcp" | "gadmin" | "entra";

const BRAND: Record<Brand, { name: string; color: string; url: string }> = {
  riot: { name: "Riot", color: "#4b3cf5", url: "app.tryriot.com/settings/api" },
  vercel: { name: "Vercel", color: "#111", url: "vercel.com/…/settings/environment-variables" },
  gcp: { name: "Google Cloud", color: "#1a73e8", url: "console.cloud.google.com/iam-admin/serviceaccounts" },
  gadmin: { name: "Google Admin", color: "#1a73e8", url: "admin.google.com/ac/owl/domainwidedelegation" },
  entra: { name: "Microsoft Entra", color: "#0f6cbd", url: "entra.microsoft.com/#view/RegisteredApps" },
};

function Window({ brand, nav, active, caption, children }: { brand: Brand; nav: string[]; active: string; caption: string; children: ReactNode }) {
  const b = BRAND[brand];
  return (
    <figure className="shot">
      <div className="shot-frame">
        <div className="shot-bar">
          <span className="lights"><i /><i /><i /></span>
          <span className="shot-url">{b.url}</span>
        </div>
        <div className="shot-app">
          <aside className="shot-nav">
            <div className="shot-logo" style={{ background: b.color }}>{b.name}</div>
            {nav.map((n) => (
              <div key={n} className={n === active ? "nav-item on" : "nav-item"} style={n === active ? { color: b.color } : undefined}>{n}</div>
            ))}
          </aside>
          <div className="shot-main">{children}</div>
        </div>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

const Field = ({ label, value, hot }: { label: string; value: string; hot?: boolean }) => (
  <div className="m-field">
    <div className="m-label">{label}</div>
    <div className={hot ? "m-input hot" : "m-input"}>{value}</div>
  </div>
);
const Btn = ({ children, hot, primary }: { children: ReactNode; hot?: boolean; primary?: boolean }) => (
  <span className={`m-btn${primary ? " primary" : ""}${hot ? " hot" : ""}`}>{children}</span>
);
const Title = ({ children }: { children: ReactNode }) => <div className="m-title">{children}</div>;

export function RiotEndpointShot({ url }: { url: string }) {
  return (
    <Window brand="riot" nav={["General", "Members", "API", "Integrations"]} active="API" caption="Riot: add an endpoint that receives the revocation event, then copy its signing secret.">
      <Title>Add webhook endpoint</Title>
      <Field label="Endpoint URL" value={url} hot />
      <div className="m-label">Events</div>
      <div className="m-check hot"><span className="box on">✓</span>revoke_drive_item_permission_request.created</div>
      <div className="m-check"><span className="box" />inbox_email_analysis.classified</div>
      <div className="m-row"><Btn primary>Create endpoint</Btn></div>
      <div className="m-secret hot">
        <span className="m-label">Signing secret</span>
        <code>whsec_••••••••••••••••••</code>
        <Btn>Copy</Btn>
      </div>
    </Window>
  );
}


export function GcpKeyShot() {
  return (
    <Window brand="gcp" nav={["IAM", "Service Accounts", "Roles", "Audit Logs"]} active="Service Accounts" caption="Google Cloud: create a JSON key, and copy the Unique ID for the next step.">
      <Title>riot-sonar-revoker</Title>
      <div className="m-tabs"><span>Details</span><span>Permissions</span><span className="on">Keys</span></div>
      <div className="m-row"><Btn hot>Add key ▾</Btn></div>
      <div className="m-menu"><div className="hot">Create new key</div><div>Upload existing key</div></div>
      <div className="m-row">
        <span className="m-radio on" /> JSON <span className="m-radio" /> P12
        <span className="spacer" /><Btn primary>Create</Btn>
      </div>
      <Field label="Unique ID (OAuth 2 client ID)" value="104857392018374659201" hot />
    </Window>
  );
}


export function EntraPermissionsShot() {
  return (
    <Window brand="entra" nav={["Overview", "Certificates & secrets", "API permissions", "Owners"]} active="API permissions" caption="Entra: add the Files.ReadWrite.All application permission and grant admin consent.">
      <Title>Configured permissions</Title>
      <div className="m-row"><Btn>+ Add a permission</Btn><Btn primary hot>✓ Grant admin consent</Btn></div>
      <div className="m-table">
        <div className="m-tr head"><span>API / Permission</span><span>Type</span><span>Status</span></div>
        <div className="m-tr hot"><span>Files.ReadWrite.All</span><span>Application</span><span className="m-ok">● Granted</span></div>
      </div>
    </Window>
  );
}

export function EntraSecretShot() {
  return (
    <Window brand="entra" nav={["Overview", "Certificates & secrets", "API permissions", "Owners"]} active="Certificates & secrets" caption="Entra: copy the secret Value right away. It is hidden once you leave the page.">
      <Title>Client secrets</Title>
      <div className="m-row"><Btn hot>+ New client secret</Btn></div>
      <div className="m-table">
        <div className="m-tr head"><span>Description</span><span>Expires</span><span>Value</span></div>
        <div className="m-tr"><span>riot-sonar-revoker</span><span>10/14/2028</span><span className="hot-inline">Xy8Q~••••••••••</span></div>
      </div>
      <div className="m-grid2">
        <Field label="Application (client) ID" value="3f2a…c91e" hot />
        <Field label="Directory (tenant) ID" value="8b71…02d4" hot />
      </div>
    </Window>
  );
}

export function RiotTestShot() {
  return (
    <Window brand="riot" nav={["General", "Members", "API", "Integrations"]} active="API" caption="Riot: send a test event. The delivery must come back with status 200.">
      <Title>Endpoint deliveries</Title>
      <div className="m-row"><span className="spacer" /><Btn primary hot>Send test event</Btn></div>
      <div className="m-table">
        <div className="m-tr head"><span>Event</span><span>Status</span><span>When</span></div>
        <div className="m-tr hot"><span>revoke_drive_item_permission_request.created · test</span><span className="m-ok">200</span><span>just now</span></div>
      </div>
    </Window>
  );
}
