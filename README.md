# Riot functions

Small services that Riot customers run in their own cloud. Each folder is one self-contained function, with one subfolder per hosting platform.

| Function | What it does | Platforms |
| --- | --- | --- |
| [sonar-drive-items-revocation](sonar-drive-items-revocation) | Receives Riot Sonar revocation webhooks and removes the Google Drive or Microsoft 365 permission with your own credentials. | Vercel, AWS, Azure, Google Cloud |
