# Deploy on Vercel

The receiver runs as a Next.js app in your own Vercel account. The Hobby plan is enough for normal revocation volumes. The credentials are Vercel environment variables, stored as sensitive values.

The quickest path is the **Deploy with Vercel** button in the [README](../README.md#deploy): it clones the repository into your Git account and deploys it, then the app's home page walks you through the setup. This guide does the same from a terminal with the Vercel CLI, without cloning into your Git account.

## Before you start

- **A Vercel account.**
- **Node.js 22 and npm**, on macOS, Linux, or Windows (in [WSL](https://learn.microsoft.com/windows/wsl/install) or PowerShell).
- **For Google Workspace:** a service account key, and a Google Workspace super admin for domain-wide delegation.
- **For Microsoft 365:** an Entra app with `Files.ReadWrite.All` and admin consent.
- **A Riot admin**, to create the webhook endpoint in the Riot hub.

## 1. Deploy

```bash
npm install -g vercel
vercel login
git clone https://github.com/tryriot/riot-functions
cd riot-functions/sonar-drive-items-revocation
vercel deploy --prod
```

Deploy from the `sonar-drive-items-revocation` folder, not from `vercel`: the app uses the shared code next to it. On the first deploy, the CLI sets up the project. Answer:

- **Set up and deploy?** `Y`
- **Which scope?** your team
- **Link to existing project?** `N`
- **Project name:** `riot-sonar-revoker`
- **In which directory is your code located?** `./vercel`

At the end, the CLI prints the production URL, for example `https://riot-sonar-revoker.vercel.app`. Opening it shows the setup page, which lists what is configured.

## 2. Credentials

Each `vercel env add` asks for the value. The variables apply to the next deploy.

### Google Workspace

Create the service account and its key with [Google Workspace by hand](deploy-aws.md#google-workspace-by-hand) (steps 1 to 3), then:

```bash
vercel env add GOOGLE_SERVICE_ACCOUNT_JSON production --sensitive < ~/Downloads/<key-file>.json
```

Delete the downloaded key file afterwards. Then, as a Google Workspace super admin:

1. Open [domain-wide delegation](https://admin.google.com/ac/owl/domainwidedelegation).
2. Click **Add new** and fill in:
   - **Client ID:** the `client_id` from the key file, also shown as **Unique ID** on the service account's **Details** tab
   - **OAuth scopes:** `https://www.googleapis.com/auth/drive`
3. Click **Authorize**.

### Microsoft 365

Create the Entra app with [Microsoft 365 by hand](deploy-aws.md#microsoft-365-by-hand), then:

```bash
vercel env add MS_TENANT_ID production
vercel env add MS_CLIENT_ID production
vercel env add MS_CLIENT_SECRET production --sensitive
```

## 3. Connect Riot

1. Open the [Riot hub settings](https://hub.tryriot.com/settings/about) and click the **API** tab.
2. Under **Webhooks**, click **Create endpoint** and fill in:
   - **Name:** `Sonar revoker`
   - **Endpoint URL:** the production URL followed by `/api/webhook`
   - **Events to send:** tick only `revoke_drive_item_permission_request.created`

   ![Riot Create endpoint form](../vercel/public/tutorial/riot-create-endpoint.jpg)

3. Click **Create endpoint**. Riot shows the signing secret (`whsec_…`) once. Copy it, then click **I saved the secret**.
4. Save it and redeploy so the app picks up every variable:

   ```bash
   vercel env add RIOT_WEBHOOK_SECRET production --sensitive
   vercel deploy --prod
   ```

5. Check the app. Each part must show `ok`:

   ```bash
   curl https://<production-url>/
   ```

## 4. Test from Riot

1. In the Riot **API** tab, click **⋯** on the endpoint, then **Send test**.

   ![Riot endpoint menu with Send test](../vercel/public/tutorial/riot-send-test.jpg)

2. Pick `revoke_drive_item_permission_request.created` and click **Send test**.
3. Riot must show **Your endpoint accepted the test** with a 200. A test event never revokes anything.

Then ask your Riot account manager to switch Sonar revocations to webhook mode. Each revocation shows up in the project's **Logs** tab with the status `revoked`, `already_gone` or `skipped`, or with:

```bash
vercel logs <production-url>
```

## Update

Pull the repository and run `vercel deploy --prod` again from the `sonar-drive-items-revocation` folder. Environment variables are kept.

To replace a value, for example a new Entra client secret, run `vercel env rm <NAME> production`, add it again, and redeploy.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| The build fails with `Module not found: Can't resolve '../../../../lib/…'` | The deploy ran from the `vercel` folder. Run it from `sonar-drive-items-revocation`, with the project's root directory set to `vercel` (**Settings > Build and Deployment > Root Directory**). |
| The status page shows `missing` for a variable you added | Variables apply to the next deploy. Run `vercel deploy --prod`. |
| Riot: **401** `no matching signature` | `RIOT_WEBHOOK_SECRET` is another endpoint's secret. Replace it with this endpoint's secret and redeploy. |
| Riot: **401** or a Vercel login page on every request | Vercel Authentication protects the deployment. Production URLs are public by default; check **Settings > Deployment Protection**. |
| Riot: **404** | The endpoint URL must end in `/api/webhook`. |

Then follow [Verify a deployment](../README.md#verify-a-deployment).
