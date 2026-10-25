<!-- Same content as LLD section 18. Keep the two in sync. -->
# Runbook

## Setup from scratch on a new machine

1. Node 18+ and Salesforce CLI (`sf --version`); git.
2. Agentia CLI. If the global npm folder needs root, install to a user prefix:
   ```bash
   npm i -g --prefix "$HOME/.npm-global" @copado/agentia-cli@beta
   ```
   Then add `export PATH="$HOME/.npm-global/bin:$PATH"` to `~/.zshrc`.
3. Clone the repo; `cd interceptor && npm ci && npm run build`.
4. Authorise the org, and set it as the project default:
   ```bash
   sf org login web --alias interceptor-dev --instance-url https://YOUR_MY_DOMAIN.develop.my.salesforce.com
   ```
   ```bash
   sf config set target-org interceptor-dev
   ```
5. Deploy the metadata in this order, with `--json` and `-o interceptor-dev`:
   - the four Apex classes (run their tests);
   - permission sets `Opportunity_Assistant_Access` and `Agent_Interceptor_CRT_Access`, assigned to the user;
   - the External Client App files (`externalClientApps`, `extlClntAppGlobalOauthSets`, `extlClntAppOauthSettings`, `extlClntAppOauthPolicies`);
   - `AiAuthoringBundle:Opportunity_Assistant`.
6. CRT auth (you, in a terminal; the key is never echoed):
   ```bash
   read -rs "PAK?CRT personal access key: "; echo; agentia auth set --crt "$PAK" --crt-domain sg-robotic.copado.com --crt-org 983; unset PAK
   ```
   Check that `agentia auth get --crt --json` shows `ready: true`.
7. Copy the ECA consumer key and secret from Setup → External Client App Manager → Agent Interceptor CRT → Settings → OAuth Settings, and store them as sensitive CRT variables `SF_CLIENT_ID` / `SF_CLIENT_SECRET` on robot 28176 (`agentia testing variable create … --value-stdin --sensitive`).
8. `node dist/src/cli.js crt-sync`, then put the printed job ID in `crt.job`.
9. Smoke test: `node dist/src/cli.js gate --action find_opportunity` should end in VERIFIED, exit 0.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `PreviewStartFailed: Cannot read properties of undefined (reading 'replace')` | CLI defect: employee agent without `access.default_agent_user` | Keep the `access` block in the `.agent` file ([LLD §10](LLD.md#10-conversation-channel)) |
| `interceptor: Refusing to run: alias … is not the configured demo org` | Wrong alias or org | Check `sf org display -o interceptor-dev --json`; fix config |
| CRT log: `MissingSchema: Invalid URL '…/services/oauth2/token'` | `SF_DOMAIN` without `https://` | Agent Interceptor passes the instance URL; check config `expectedInstanceUrl` |
| CRT log: `invalid_client_id` | Consumer key stored wrongly (e.g. extra text) | Re-store; it should be ~85 chars and start with `3MVG` |
| CRT log: `invalid_app_access … not admin approved` | Run-as user not in the ECA's permitted users | Assign `Agent_Interceptor_CRT_Access` |
| Verdict INCONCLUSIVE "crt.job is not set" | No job ID in config | `crt-sync`, set `crt.job` |
| Verdict INCONCLUSIVE "could not find the CRT build for run …" | Build not listed by `testing status` | Check the CRT UI for the job; rerun |
| Verdict INCONCLUSIVE "did not report checks" | Suite errored before checking (auth, bad field) | Open `logReportUrl` from the report |
| `agentia: command not found` | `~/.npm-global/bin` not on PATH | Open a new terminal or `source ~/.zshrc`; config falls back automatically |
| `npm i -g` EACCES | Global npm folder owned by root | Use `--prefix "$HOME/.npm-global"` |
| `node --test dist/test/` "Cannot find module" | Node 24 expects files/globs | `npm test` (uses a glob) |
| `sf project deploy validate --metadata-dir … --single-package` → "No package.xml found" | Flag means something else | Omit `--single-package` |
| Agent action returns nothing in live preview | `WITH USER_MODE` and missing access → 0 rows silently | Check the running user's object/field access |
| `sf agent trace read -t 2` shows the first reply's actions | `-t` counts every message | Read traces by `planId` (as the driver does) |
| Agentia "Failed to report local quality gates result: not on a feature/US-XXXX branch" | No Copado user-story branch | Expected without CICD setup ([LLD §13](LLD.md#13-pipeline-integration)) |
