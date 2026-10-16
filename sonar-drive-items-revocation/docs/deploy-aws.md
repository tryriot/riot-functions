# Deploy on AWS

The receiver runs as one Lambda function (Node.js 22, arm64) behind an HTTP API in your own AWS account. It stays within the free tier for normal revocation volumes. The Riot signing secret and the Google or Microsoft credentials live in Parameter Store as encrypted parameters, never in the template or in environment variables.

One script does the whole setup. It walks you through four steps, and you can stop and rerun it at any time: it picks up where it left off.

## Before you start

- **An AWS account** where you can create CloudFormation stacks, Lambda functions, IAM roles and Parameter Store parameters.
- **For Google Workspace:** a Google Cloud project to hold the service account, and a Google Workspace super admin for the domain-wide delegation step.
- **For Microsoft 365:** an Entra Global Administrator or Privileged Role Administrator, to grant admin consent to `Files.ReadWrite.All`.
- **A Riot admin**, to create the webhook endpoint in the Riot hub.

## Deploy

1. Open [AWS CloudShell](https://console.aws.amazon.com/cloudshell) in the region where the function should run, for example Paris (`eu-west-3`).
2. Run the script:

   ```bash
   git clone https://github.com/tryriot/riot-functions && ./riot-functions/sonar-drive-items-revocation/aws/deploy.sh
   ```

   `STACK` defaults to `riot-sonar-revoker`. The region is the one CloudShell runs in.

<details>
<summary>Run it from your own machine instead of CloudShell</summary>

On macOS or Linux, you need the AWS CLI and curl. The script downloads the prebuilt code from the GitHub release.

```bash
aws login
export AWS_REGION=eu-west-3
git clone https://github.com/tryriot/riot-functions
cd riot-functions/sonar-drive-items-revocation && ./aws/deploy.sh
```

With AWS IAM Identity Center, run `aws sso login --profile <profile>` and `export AWS_PROFILE=<profile>` instead of `aws login`.

On Windows, use CloudShell, or run the commands above in [WSL](https://learn.microsoft.com/windows/wsl/install).

</details>

## What the script walks you through

### 1/4 Account, region and provider

The script checks that you are signed in, shows the account and region, and asks which provider Sonar revokes sharing on: Google Workspace or Microsoft 365.

### 2/4 Deploy

The script downloads the release and deploys the stack. This takes 1 to 3 minutes. At the end it prints the URL, for example `https://abc123.execute-api.eu-west-3.amazonaws.com`.

### 3/4 Google Workspace or Microsoft 365

The script asks how to create the credentials:

- **Automatically:** it signs in to the Google Cloud CLI (`gcloud`) or the Azure CLI (`az`), creates what is missing, and saves the credentials in Parameter Store. In CloudShell it installs the CLI first, which takes 2 to 3 minutes. On your own machine, install it beforehand.
- **By hand:** follow [Google Workspace by hand](#google-workspace-by-hand) or [Microsoft 365 by hand](#microsoft-365-by-hand), then give the script the key file or the app IDs.
- **Keep the current one:** shown on reruns, when credentials are already saved.

For Google Workspace, the script then prints the client ID to allow in domain-wide delegation:

1. As a Google Workspace super admin, open [domain-wide delegation](https://admin.google.com/ac/owl/domainwidedelegation). The menu path is **Security > Access and data control > API controls > Manage domain-wide delegation**.
2. Click **Add new** and fill in:
   - **Client ID:** the one printed by the script
   - **OAuth scopes:** `https://www.googleapis.com/auth/drive`

   ![Add a new client ID with the Drive scope](../vercel/public/tutorial/google-delegation.jpg)

3. Click **Authorize**, then press Enter in the script.

For Microsoft 365, the script grants admin consent itself when your account has the role. Otherwise it prints an admin consent link to send to a Global Administrator.

### 4/4 Connect Riot

The script prints the webhook URL and the values to enter in Riot. Riot only shows the signing secret once the endpoint exists, which is why this step comes after the deploy.

1. Open the [Riot hub settings](https://hub.tryriot.com/settings/about) and click the **API** tab.
2. Under **Webhooks**, click **Create endpoint** and fill in:
   - **Name:** `Sonar revoker`
   - **Endpoint URL:** the webhook URL printed by the script, ending in `/api/webhook`
   - **Events to send:** tick only `revoke_drive_item_permission_request.created`

   ![Riot Create endpoint form](../vercel/public/tutorial/riot-create-endpoint.jpg)

3. Click **Create endpoint**. Riot shows the signing secret (`whsec_…`) once. Copy it, then click **I saved the secret**.

   ![Riot Save signing secret dialog](../vercel/public/tutorial/riot-signing-secret.jpg)

4. Paste the secret into the script. It saves it in Parameter Store.

The function rereads its parameters every minute, so the script waits up to two minutes, then ends with a check:

```
━━ Check

  ✓ Riot signing secret
  ✓ Microsoft 365
```

## Test from Riot

1. In the Riot **API** tab, click **⋯** on the endpoint, then **Send test**.

   ![Riot endpoint menu with Send test](../vercel/public/tutorial/riot-send-test.jpg)

2. Pick `revoke_drive_item_permission_request.created` and click **Send test**.
3. Riot must show **Your endpoint accepted the test** with a 200. A test event never revokes anything. If Riot shows **Your endpoint rejected the test**, see [Troubleshooting](#troubleshooting).

## Go live

Ask your Riot account manager to switch Sonar revocations to webhook mode. Each revocation then shows up in the function's CloudWatch logs with the status `revoked`, `already_gone` or `skipped`. The script prints the direct link.

## Google Workspace by hand

1. In the [Google Cloud console](https://console.cloud.google.com), pick or create a project, then [enable the Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com).
2. Open **IAM & Admin > Service accounts** and click **Create service account**. Name it `riot-sonar-revoker`, click **Create and continue**, skip the roles, and click **Done**.
3. Open the service account, then **Keys > Add key > Create new key**, pick **JSON** and click **Create**. The key file downloads.

   If Google answers that key creation is disabled, see [Allow service account keys](#allow-service-account-keys).

4. In CloudShell, upload the key file with **Actions > Upload file**. Give its path to the script, which saves it in Parameter Store and prints the client ID for domain-wide delegation. Then delete the downloaded file.

### Allow service account keys

Organizations created since May 2024 forbid service account keys by default, with the policy **Disable service account key creation** (`iam.disableServiceAccountKeyCreation`, or `iam.managed.disableServiceAccountKeyCreation`). An Organization Policy Administrator can lift it for the project that holds the service account only:

1. In the Google Cloud console, select the project, then open **IAM & Admin > Organization policies**.
2. Search **Disable service account key creation**, click it, then **Manage policy**.
3. Pick **Override parent's policy**, add a rule with **Enforcement: Off**, and click **Set policy**.

Then rerun the script, or create the key by hand.

## Microsoft 365 by hand

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), open **Applications > App registrations** and click **New registration**. Name it `Riot Sonar revoker`, keep **Accounts in this organizational directory only**, and click **Register**.
2. Open **API permissions > Add a permission > Microsoft Graph > Application permissions**, tick `Files.ReadWrite.All`, and click **Add permissions**.
3. Click **Grant admin consent for <your organization>**, then **Yes**. This needs a Global Administrator or Privileged Role Administrator.
4. Open **Certificates & secrets > Client secrets > New client secret**, pick 24 months, and click **Add**. Copy the **Value** now: Entra only shows it once.
5. Give the script the **Directory (tenant) ID** and the **Application (client) ID** from the app's **Overview** page, and the secret value.

The client secret expires. Before it does, create a new one and rerun the script with **By hand**, or with **Automatically**, which adds one next to the current one.

## Without the script

Download `sonar-drive-items-revocation-aws.yaml` and `sonar-drive-items-revocation-aws.zip` from the [latest release](https://github.com/tryriot/riot-functions/releases), then:

```bash
aws cloudformation deploy --template-file sonar-drive-items-revocation-aws.yaml --stack-name riot-sonar-revoker \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND
aws lambda update-function-code --function-name <FunctionName output> --zip-file fileb://sonar-drive-items-revocation-aws.zip
```

Then, in **Systems Manager > Parameter Store**, create one **SecureString** parameter per value, named after the `ParameterPrefix` output, for example `/riot-sonar-revoker/RIOT_WEBHOOK_SECRET`:

| Name | Value |
| --- | --- |
| `RIOT_WEBHOOK_SECRET` | The Riot signing secret (`whsec_…`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The service account key file, for Google Workspace |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | The Entra app, for Microsoft 365 |

`WebhookUrl` in the stack outputs is the URL for Riot.

## What gets created

- CloudFormation stack `riot-sonar-revoker`, with the Lambda function, its IAM role, and an HTTP API.
- Parameter Store SecureString parameters under `/riot-sonar-revoker/`, readable by the function only.
- CloudWatch log group of the function.
- For Google Workspace, automatically: the Drive API and the service account `riot-sonar-revoker` in the Google Cloud project you pick.
- For Microsoft 365, automatically: the Entra app `Riot Sonar revoker` with `Files.ReadWrite.All` and a client secret valid two years.

## Update

Pull the repository and run the script again. It redeploys the code, offers to keep the current credentials, and keeps the Riot signing secret when you press Enter at the prompt.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Not signed in` | Run `aws login`, or `aws sso login --profile <profile>` with `AWS_PROFILE` set. |
| `Your organization forbids service account keys` | See [Allow service account keys](#allow-service-account-keys). |
| Only an admin can grant `Files.ReadWrite.All` | Send the admin consent link printed by the script to a Global Administrator, or follow step 3 of [Microsoft 365 by hand](#microsoft-365-by-hand). |
| Check: Microsoft 365 fails with 401 or `invalid_client` | The client secret is wrong or expired. Rerun the script and pick **Automatically** to add a new one. |
| Check: Google Workspace fails with `unauthorized_client` | Domain-wide delegation is missing, has the wrong client ID or the wrong scope, or is not active yet. It can take a few minutes to apply. |
| Riot: **401** `no matching signature` | Parameter Store holds another endpoint's signing secret. Rerun the script and paste this endpoint's secret. |
| Riot: **404** | The endpoint URL must end in `/api/webhook`. |

To read the function's logs:

```bash
aws logs tail /aws/lambda/<FunctionName output> --follow
```

Then follow [Verify a deployment](../README.md#verify-a-deployment).
