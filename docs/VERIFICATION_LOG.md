# Verification log

Every external command, flag, API or metadata field that Agent Interceptor relies on is recorded here with the date it was checked, the exact command, and what the output showed. Anything not listed here is **unverified**.

Machine: macOS (darwin arm64). Demo org alias: `interceptor-dev`.

---

## Phase 0, check 1: tooling (2026-10-17)

Script: `spikes/00-tooling.sh`. Result: **FAIL** (Agentia CLI not installed; everything else present).

| Command | Output summary |
|---|---|
| `node --version` | `v24.15.0` (meets Node 18+) |
| `sf --version` | `@salesforce/cli/2.152.14 darwin-arm64 node-v24.20.0`. npm `latest` is 2.154.4 (`npm view @salesforce/cli version`), so the CLI is behind. |
| `sf plugins --json` | Returns a JSON **array** (not `{result: ...}`). `@salesforce/plugin-agent` 2.2.2 (core). npm `latest` is 2.2.3. |
| `sf agent --help` | Topics: `adl`, `generate`, `mcp`, `preview`, `publish`, `test`, `trace`, `validate`; commands `activate`, `create`, `deactivate`, `preview`. |
| `sf agent preview start --help` | Flags: `-o`, `--json`, `-n/--api-name`, `--authoring-bundle`, `--use-live-actions` \| `--simulate-actions` (one is **required** with `--authoring-bundle`; ignored for `--api-name`, which always uses live actions), `--context-variables`, `--context-variables-json`. Exit codes: 0 ok, 1 compile failed, 2 not found, 3 server error, 4 start failed. Matches research. |
| `sf agent preview send --help` | Flags: `-o`, `-u/--utterance` (required), `--session-id` (optional if exactly one session), `-n` / `--authoring-bundle`, `--json`. Exit codes: 0, 2 not found, 4 send failed, 5 session ambiguous. Matches research. |
| `sf agent preview end --help` | Flags: `--session-id` \| `--all`, `-n` \| `--authoring-bundle`, `-p/--no-prompt`, `--json`. "Displays the local directory where the session trace files are stored." Exit codes: 0, 2, 4, 5, 68 partial failure. Matches research. |
| `sf agent preview sessions --help` | Lists sessions in the local cache. |
| `sf agent trace read --help` | **Not in research.** `-s/--session-id` (required), `-f/--format summary\|detail\|raw` (default summary), `-d/--dimension actions\|grounding\|routing\|errors` (with `detail`), `-t/--turn`, `--json`. The `actions` dimension is described as including action name, input parameters, output and latency. Also `sf agent trace list` and `sf agent trace delete`. Trace contents not yet observed (needs an agent). |
| `sf agent validate --help` | Subcommand `authoring-bundle`. |
| `sf agent generate --help` | Subcommands `agent-spec`, `authoring-bundle`, `template`, `test-spec`. |
| `sf agent publish --help` | Subcommand `authoring-bundle`. |
| `agentia --version` | `command not found`. |

### Agentia install method (research, not yet run)

- `npm search agentia` lists `@copado/agentia-cli` ("Command-line interface for Agentia", oclif, maintainers `copado-user`, `releasecopado`, …) and `@copado/create-agentia-plugin`.
- `npm view @copado/agentia-cli dist-tags`: `latest` = `1.0.0-beta.0`, `beta` = `alpha` = `rc` = `1.0.0-rc.0`. `engines.node` = `>=18.0.0`. Homepage `https://github.com/Copado/agentia-cli`.
- Copado's docs (`https://developer.copado.com/docs`, fetched 2026-10-17) give `npm i -g @copado/agentia-cli@beta`, then `agentia setup`. CRT credentials are separate: `agentia auth set --crt`, and status via `agentia auth get --crt --json`, where automation should gate on `ready: true`.
- **Contradicts research:** the research quoted Agentia `0.122.0-alpha.1`. The current line is `1.0.0-*`, so every Agentia command and flag in the research must be re-checked after install.

## Phase 0, check 2: demo org (2026-10-17)

Script: `spikes/01-org.sh` (uses the production guard in `spikes/lib/guard.sh`). Result: **PASS**, with one open item (Agentforce in Setup needs your confirmation).

| Command | Output summary |
|---|---|
| `sf org list --json` | `interceptor-dev` → `YOUR_ADMIN_USERNAME`, Connected. Other orgs on this machine include production orgs and client sandboxes. **The global default `target-org` was a client sandbox**, so the project-local default was set with `sf config set target-org interceptor-dev --json` (success), and every script passes `-o interceptor-dev` explicitly. |
| `sf org display -o interceptor-dev --json` | Org Id `YOUR_ORG_ID`, instance URL `https://YOUR_MY_DOMAIN.develop.my.salesforce.com` (matches the known My Domain), `apiVersion` 68.0. Only non-secret fields are read. |
| `sf data query -q "SELECT Id, Name, IsSandbox, OrganizationType, InstanceName FROM Organization" --json` | `IsSandbox` false, `OrganizationType` "Developer Edition", instance USA1336. Non-production confirmed. |
| `sf data query -q "SELECT Id, DeveloperName, MasterLabel, Type, AgentType FROM BotDefinition" --json` | 0 records (no agents yet). The `Type` and `AgentType` fields are queryable. |
| `sf data query --use-tooling-api -q "SELECT Id, DeveloperName FROM GenAiPlannerDefinition"` | 0 records. |
| `sf data query --use-tooling-api -q "SELECT Id, DeveloperName FROM AiAuthoringBundle"` | Error: `sObject type 'AiAuthoringBundleDefVer' is not supported.` Not usable for listing bundles. |
| Running user | Profile System Administrator. Permission sets include `GenieAdmin`, `CopilotSalesforceAdmin`, `AgentforceServiceAgentBuilder`, `EinsteinGPTPromptTemplateManager`. |
| `sf project retrieve start -m Settings:AgentPlatform -m Settings:EinsteinGpt -m Settings:EinsteinCopilot -m Settings:Bot --target-metadata-dir … --unzip --json` | `enableAgentPlatform` = true, `enableEinsteinGptPlatform` = true, `enableEinsteinGptCopilot` = false, `enableBots` = false. `Settings:Agentforce` and `Settings:EinsteinAgent` are unknown types. |

### API version for Agent Script

- Org API 68.0; project `sourceApiVersion` 67.0. Both are above the v66.0 the prompt attributes to the Agentforce skill. **Not yet checked against the skill text itself** (done when the skill is loaded in Phase 1).

### Agentforce enabled?

- Metadata shows the Agent Platform and Einstein generative AI are enabled. `enableEinsteinGptCopilot` (the legacy Einstein Copilot / default assistant switch) is false. Whether that matters for an Agent Script employee agent is **unverified**. Needs a manual check in Setup → Agentforce Agents.

## Phase 0, check 1b: Agentia CLI (2026-10-17)

### Install

- `npm i -g @copado/agentia-cli@beta` failed with `EACCES` (`/usr/local/lib/node_modules` is owned by root).
- Installed without sudo, at your request: `npm i -g --prefix "$HOME/.npm-global" @copado/agentia-cli@beta`. Added `export PATH="$HOME/.npm-global/bin:$PATH"` to `~/.zshrc`. npm's global prefix config is unchanged.
- `agentia --version` → `@copado/agentia-cli/1.0.0-rc.0 darwin-arm64 node-v24.15.0`.
- `oclif.manifest.json` in the installed package lists **263 commands** (the docs page says 270, a news article 235/246).

### Command groups (`agentia --help`)

Topics: `adv`, `ai`, `auth`, `cicd`, `mcp`, `plugins`, `setup`, `testing`. Commands: `help`, `plugins`, `setup`, `update`.

### Auth

| Command | Output summary |
|---|---|
| `agentia auth get --help` | Flags `--adv`, `--ai`, `--cicd`, `--crt`, `--json`. Descriptions say "Show PAK…", so the output may contain secrets: always pipe it through a redaction filter. |
| `agentia auth get --crt --json` (redacted) | `credentials[0]`: label "PAK (CRT)", `missing: [domain, org, pak]`. Not ready. |
| `agentia auth set --help` | `--crt <pak>` (requires `--crt-org`), `--crt-domain <host>`, `--crt-org <id>`, `--local`. Stored "securely in the system keychain". |
| `agentia setup --help` | Interactive, no flags. Covers CICD, AI and CRT auth, Cursor MCP, local quality gates, AGENTS.md. Also updates `.gitignore`. |

### CRT (`agentia testing …`)

**Contradicts research.** Research used `agentia testing build run <job>`. That still exists, but there are also shorter forms: `testing run`, `testing status`, `testing logs`, `testing create`, `testing update`.

| Command | Output summary |
|---|---|
| `agentia testing run --help` | `testing run ID -p <project>`. **ID is a "CRT job/test ID"**, not a robot ID. Flags include `--wait-for-result`, `--timeout` (minutes, default 60), `--variable` (Robot Framework variable, repeatable), `--param KEY=VALUE` (execution parameter, repeatable), `--datatable TABLE_ID:1,2-4`, `--save-artifacts <file>`, `--xunit <file>`, `--no-exit-code`, `--branch`/`--tag`, `--test`, `--suite`, `--include`/`--exclude`, `--stream-logs` ("human output only"), `--watch` ("human output only"), `--dry-run`, `--json`. |
| `agentia testing create --help` | `-p <project> --name <name> --robot <robotId>` (required) plus `-f/--file` or `--dir` (upload Robot files), **or** `--git-url`/`--git-branch`/`--git-domain-credential` (Git-backed). Also `--dry-run`, `--suite-type`, `--timeout`. **So robot 28176 is the parent; a job/test is created under it, and that job ID is what `run` takes.** |
| `agentia testing status --help` | `-p <project> [--job <id>] [--status aborted\|executing\|failed\|finished\|queued\|succeeded] --json`. |
| `agentia testing logs --help` | `logs <buildId> -p <project> -j <job> [-o file] [--tail-lines N] [--json]`. |
| Topic `testing build` | `abort`, `get`, `latest`, `list`, `logs`, `run`, `search`. |
| Topic `testing job` | `create`, `delete`, `download`, `files`, `get`, `list`, `refs`, `run`, `update`, `upload`. |
| Topic `testing robot` | `create`, `delete`, `get`, `list`, `update`. |
| Topic `testing variable` | `create`, `delete`, `get`, `list`, `update` (variables/secrets). |
| Topic `testing data-table` | `create`, `delete`, `export`, `get`, `list`, `update`. |

Ways to pass run-specific values into CRT, from the help text (none proven yet): `--variable` on `testing run`, `--param`, data tables, or uploading a generated file before the run.

### Pipeline / quality gates

| Command | Output summary |
|---|---|
| `agentia cicd work test --help` | Runs the project-root **`.agentia_quality_gates.sh`** (`--local`, the default). `-e NAME=value` passes environment variables to it. `--cloud` is "not implemented yet". **This is a verified hook for a custom check: `interceptor gate` can be called from that script.** Not yet run. |
| `agentia cicd work submit --help` | Runs `.agentia_quality_gates.sh` first (unless `--skip-local-tests`), then pushes, registers commits, and calls headless work/submit (validate). `--done`/`--deploy` promotes. Needs Copado CICD auth and a user story. |
| `agentia cicd work promote --help` | "Experimental: skips Quality Gates." |
| `agentia cicd metadata dependency list --help` | "Retrieve metadata dependencies via the CICD gateway." `--from-changes --base-ref <ref>`, `--metadata-type/--metadata-name`, `--pipeline-id`, `--source-org-id`, `--source-credential-id`. Needs CICD auth and a Copado pipeline. **Whether it understands Agentforce topics or actions is unverified.** No other dependency or impact command exists in the manifest. |
| `agentia cicd health-check --help` | Not yet read. |

### AI, MCP, plugins

| Command | Output summary |
|---|---|
| `agentia ai agent ask --help` | `-p/--prompt` (required), `--agent plan\|build\|test\|release\|operate\|knowledge` (default knowledge), `--component`, `--sf-org`, `--user-story`, `--json`. **Contradicts research:** `--agent` is a fixed list of Copado AI agents, not an agent name. Needs AI auth (`auth set --ai`). |
| `agentia mcp start --help` | Starts a local MCP server over stdio. |
| `agentia plugins install --help` (topic) | Installs plugins "after checking them against the Agentia plugin catalog". `@copado/create-agentia-plugin` 0.4.0 on npm scaffolds plugins. |

## Phase 0, check 3: CRT readiness (2026-10-18)

Result: **PASS** for Agentia → CRT. CRT → Salesforce org login is **not yet set up** (see check 4).

| Command | Output summary |
|---|---|
| `agentia auth set --crt <pak> --crt-domain sg-robotic.copado.com --crt-org 983` | Run by you in your own terminal, with the PAK read by `read -rs` (never shown or written to a file). |
| `agentia auth get --crt --json` (redacted) | `ready: true`, `set: true`, `domain: sg-robotic.copado.com`, `orgId: "983"`, no `missing`, no `issues`. |
| `agentia testing project list --json` | Projects 18135, 18154, **18329 "Agent Interceptor"**. |
| `agentia testing robot list -p 18329 --json` | Robot **28176 "Interception Suite"**, `runEnvironment: cloud`, `os: linux`, `fwVersion: stable`, `suites: []`. |
| `agentia testing job list -p 18329 --json` | `[]` before Phase 0. |

## Phase 0, check 5 (done before 4): passing data into CRT (2026-10-18)

Result: **PASS** via `--variable`.

- Suite: `spikes/crt/discovery/discovery.robot`. It does not open a browser or contact Salesforce.
- `agentia testing create -p 18329 --robot 28176 --name "Phase0 Discovery" --file spikes/crt/discovery/discovery.robot --base-path spikes/crt [--dry-run] --json`: the dry run returns the plan (remote path `discovery/discovery.robot`, storage `snapshot`). The real run created **job 28200** under robot 28176. **So the ID `testing run` takes is the job ID (28200), not the robot ID (28176).**
- `agentia testing run 28200 -p 18329 --variable RUN_ID:p0-demo --wait-for-result --timeout 15 --json`:
  - The build config shows `executionParameters: [{key: "-v", type: "clp", value: "RUN_ID:p0-demo"}]`. So `--variable NAME:value` becomes Robot Framework `-v NAME:value`.
  - The test log printed `RUN_ID=p0-demo`, so the value arrived.
  - **On a failed run, `--json` prints only `{error: {message: "Testing run finished with status failed."}}`, exit 1, with no build ID.** On a pass (exit 0) it returns `result.{body, build, finalBuild, jobId, projectId, wait}`, where `finalBuild` has `status`, `xunitReport.testsuite.total.{tests, passes, failures, errors, skip}` and `logReportUrl`. In `body`/`build`, Agentia redacts the variable values as `[REDACTED]`. Agent Interceptor must therefore recover the build ID after a failure with `agentia testing status -p <project> --job <job> --json` (newest first; `result[0].id`).
- `agentia testing status -p 18329 --job 28200 --json`: an array of builds with `id`, `status`, `configuration.executionParameters`, `xunitReport`, `logReportUrl`, `duration`.
- `agentia testing logs <buildId> -p 18329 -j 28200 -o <file> --json`: writes the console log to the file. The JSON includes `result.log`.
- `agentia testing update 28200 -p 18329 --replace <local>:<remote> --base-path spikes/crt --message … --json`: replaces a file in the job (status 0).
- Other ways not yet tried: `--param`, data tables, and generating a file per run and uploading it with `testing update`.

### CRT runtime facts (from the discovery run, build 691633)

- Python modules importable in the CRT cloud robot: `requests` ✔, `jwt` ✔, `cryptography` ✔, `QWeb` ✔, `RequestsLibrary` ✔, `simple_salesforce` ✘.
- QForce exposes **217 keywords** (full list: `spikes/out/qforce-keywords.txt`, not committed). The ones that matter here, with signatures as reported by Robot's libdoc:
  - `Client Authenticate  domain, client_id, client_secret, timeout=None`: client credentials flow.
  - `Jwt Authenticate  client_id, username, private_key, *, sandbox=False, custom_url=None, timeout=None`.
  - `Authenticate  client_id, client_secret, username, password, …`: **DEPRECATED** (username-password flow). **Contradicts research**, which suggested it.
  - `Query Records  query, timeout=None`, `Get Record  sobject, oid`, `Verify Record  sobject, oid, partial_match=False, **data`, `Create Record  sobject, **data`, `Update Record  sobject, oid, **data`, `Delete Record  sobject, oid`, `Execute Apex  script`.
  - **Agentforce (not in research):** `Create Agentforce Session  my_domain, agent_id, bypass_user=True` ("using Agentforce API") and `Send Agentforce Message  session_id, prompt, sequence_id=1, timeout=60`. So CRT itself can hold the conversation through the Agent API. That would need a published, active agent and an External Client App.
- `agentia testing variable create --help`: `-p --key [--type clp|config|dataset|secret (default secret)] [--sensitive] [--robot|--job] [--value | --value-file | --value-stdin]`. `--value-stdin` lets you store a secret without putting it on the command line.

## Phase 0, check 4: CRT record check against the demo org (2026-10-18)

Script: `spikes/04-crt-record-check.sh 28201`. Suite: `spikes/crt/record-check/record_check.robot` (CRT **job 28201** "Phase0 Record Check", robot 28176). Result: **PASS**.

### Org changes made (each approved by you first)

| Component | Type | Purpose |
|---|---|---|
| `Agent_Interceptor_CRT` | ExternalClientApplication + ExtlClntAppGlobalOauthSettings + ExtlClntAppOauthSettings + ExtlClntAppOauthConfigurablePolicies | Client credentials flow, scope `Api` only, Local distribution, IP `Enforce`, refresh token policy `Zero`, run-as `YOUR_ADMIN_USERNAME`, `AdminApprovedPreAuthorized` limited to the permission set below. |
| `Agent_Interceptor_CRT_Access` | PermissionSet (no permissions) | Assigned to the run-as user. Listed in `commaSeparatedPermissionSet` (by API name, which deployed and worked). |

- `sf project deploy validate … --json` passed before the first deploy, and `sf project deploy start … --json` reported all four ECA components `Created`.
- **The metadata reference says the client credentials user "must have the API Only permission". In this org the System Administrator user worked without it** (deploy and token both succeeded). Live record checks therefore run with full admin rights. A dedicated API-only user is an option later (1 unused "Salesforce Integration" licence).
- Secrets: you copied the consumer key and secret from Setup and stored them in CRT yourself (`agentia testing variable create … --value-stdin`) as `SF_CLIENT_ID` and `SF_CLIENT_SECRET` on robot 28176. **`agentia testing variable list --json` returned the values in plain text while `sensitive` was false.** After `agentia testing variable update <id> -p 18329 --sensitive --json` (status 0) the list output shows them masked.

### Failures on the way (useful for the runbook)

| Symptom (from CRT log) | Cause | Fix |
|---|---|---|
| `MissingSchema: Invalid URL 'orgfarm-…/services/oauth2/token': No scheme supplied` | `Client Authenticate` `domain` needs the scheme | Pass `https://YOUR_MY_DOMAIN.develop.my.salesforce.com` |
| `invalid_client_id` / "client identifier invalid" | Extra text pasted with the consumer key (length 203, whitespace, no `3MVG` prefix, found with a shape-only check that logs length and prefix but never the value) | Re-stored the key: length 85, starts `3MVG` |
| `invalid_app_access` / "user is not admin approved to access this app" | `AdminApprovedPreAuthorized` with no permission set or profile listed | Permission set `Agent_Interceptor_CRT_Access`, assigned and listed in the policy |
| Spike stopped before cleanup and left a test record | `set -e` in the shared guard file | Removed `set -e` from `guard.sh`; cleanup now runs from an `EXIT` trap. The leftover record was deleted by hand (`sf data delete record … --json`). |

### Successful run (run ID `p0-20261018230552`)

1. `sf data create record -s Account -v "Name='AI-Test-<runId>' Description='before-<runId>'" --json` creates the test record.
2. `agentia testing run 28201 -p 18329 --wait-for-result --timeout 15 --json --variable SF_DOMAIN:https://… --variable RECORD_ID:<id> --variable EXPECTED_DESCRIPTION:before-<runId>` → exit 0, build 691651. Log: `ACTUAL|before-…|EXPECTED|before-…`, `| PASS |`.
3. `sf data update record -s Account -i <id> -v "Description='after-<runId>'" --json` changes the record.
4. The same run command → exit 1, build 691652. Log: `ACTUAL|after-…|EXPECTED|before-…`, `| FAIL |`.
5. `sf data delete record -s Account -i <id> --json` deletes the record.

Pass/fail is read back as the `agentia` exit code plus `agentia testing status --json` (`status`, `xunitReport`), and the evidence line comes from `agentia testing logs`.

## Phase 1: build (2026-10-18), not deployed yet

| Command | Output summary |
|---|---|
| `sf agent generate authoring-bundle --json --no-spec --name "Opportunity Assistant" --api-name Opportunity_Assistant -o interceptor-dev` | status 0. Created `aiAuthoringBundles/Opportunity_Assistant/Opportunity_Assistant.agent` and `Opportunity_Assistant.bundle-meta.xml` (`<bundleType>AGENT</bundleType>`, kept unchanged). The boilerplate was service-agent style (`config.default_agent_user: "NEW AGENT USER"`, MessagingSession linked variables, an escalation subagent with `@utils.escalate`, a router). All of it was replaced with the approved single-block employee design. |
| `node <skill>/scripts/index-agent.mjs …/Opportunity_Assistant.agent` | Local compiler `@sf-agentscript/agentforce` **2.9.27** (npm provider). `diagnostics: []`. One node `opportunity_assistant` (start_agent, no subagents) with tools `find_opportunity` and `update_opportunity_stage`. |
| `sf agent validate authoring-bundle --json --api-name Opportunity_Assistant -o interceptor-dev` | `{"status":0,"result":{"success":true}}`. The skill's CLI reference says this validates local files only; whether it contacted the org was not checked. The Apex targets were **not** in the org at the time and it still passed, so it does not check that action targets exist. |
| `sf project deploy validate --json -m ApexClass:… ×4 -m PermissionSet:Opportunity_Assistant_Access --test-level RunSpecifiedTests --tests OpportunityAssistantFindTest --tests OpportunityAssistantUpdateStageTest` | Check-only, nothing saved. `success: true`, **16 tests run, 0 failures**. Coverage: `OpportunityAssistantFind` 71/71 (100%), `OpportunityAssistantUpdateStage` 85/93 (91.4%). Uncovered: the thrown-exception branch of `Database.update` and the "save reported success but re-query differs" branch. The validation-rule-like path (a `SaveResult` with errors) **is** covered by a real failure: a Read Only user who owns the record can't edit it. |

## Phase 1: deploy (2026-10-18, approved by you)

| Command | Output summary |
|---|---|
| `sf project deploy start --json -m ApexClass:OpportunityAssistantFind -m ApexClass:OpportunityAssistantUpdateStage -m ApexClass:…FindTest -m ApexClass:…UpdateStageTest --test-level RunSpecifiedTests --tests … --wait 20` | success; 4 classes `Created`; 16 tests, 0 failures. |
| `sf project deploy start --json -m PermissionSet:Opportunity_Assistant_Access` + `sf org assign permset --json -n Opportunity_Assistant_Access` | `Created`; assigned to `YOUR_ADMIN_USERNAME`. |
| `sf project deploy start --json -m AiAuthoringBundle:Opportunity_Assistant --wait 20` | success; `AiAuthoringBundle Opportunity_Assistant Created`. Deployed **without** the preview workaround below. |

## Phase 1: simulated preview (2026-10-18)

Script: `spikes/10-preview.sh simulate <case> "<utterance>"`. Output goes to `spikes/out/preview/` (not committed). **4 conversations used.**

### CLI defect found: preview crashes for employee agents without `default_agent_user`

- `sf agent preview start --json --authoring-bundle Opportunity_Assistant --simulate-actions` → status 10 `PreviewStartFailed`: "Cannot read properties of undefined (reading 'replace')".
- Cause, read in the installed CLI source: `@salesforce/agents` 2.3.1 `lib/agents/scriptAgent.js:391` runs `this.agentJson.globalConfiguration.defaultAgentUser.replace(/'/g, "''")` with no null check. The same line exists in 2.2.0 and in the latest npm release (2.3.1, 2026-09-09). `@salesforce/plugin-agent` latest (2.2.3) depends on `^2.3.0`, so updating the CLI does not fix it.
- The local compiler confirms that without `access.default_agent_user` the compiled `global_configuration` has no `default_agent_user` key. With it, the key is present and there are 0 diagnostics. Putting it under `config:` gives the diagnostic "default_agent_user has moved from config to access".
- The CLI code then sets `bypassUser = false` for `AgentforceEmployeeAgent` when the user is valid. This contradicts the skill's warning that employee agents must omit `default_agent_user`, but only for preview: the skill's warning about **publish** is not tested yet.
- **Workaround (local file only):** `access: default_agent_user: "YOUR_ADMIN_USERNAME"`, with an explanatory comment in the `.agent` file. Preview then starts. Must be revisited before any publish. Logged in the decision log.

### Trace format (`sf agent trace read --json -s <session> -t <turn> -f detail -d actions`)

`result.detail[]` has one entry per action call: `{dimension: "actions", turn, planId, action, input (JSON string), output (JSON string), latencyMs, error}`. Session files go to `.sfdx/agents/Opportunity_Assistant/sessions/<sessionId>/` (path returned by `preview end`, which is git-ignored).

### Cases (simulated: action outputs are invented by the LLM, not real Apex)

| Case | Utterance | Actions in trace (in order) | Agent reply (exact) | Notes |
|---|---|---|---|---|
| happy | "Move the opportunity AI-Test-sim1 to Qualification" | `find_opportunity {opportunityName: AI-Test-sim1}` → mock `matchCount 1, opportunityId "OPP-00123"`; `update_opportunity_stage {newStage: Qualification, opportunityId: OPP-00123}` → mock `success true` | "The stage for opportunity AI-Test-sim1 is now Qualification. How else can I help with opportunities?" | Find-before-update order held; the ID came from the find output via the variable. |
| notfound | "What stage is the opportunity AI-Test-missing-sim2 in?" | `find_opportunity` → mock `matchCount 0` | "No opportunity matched the name "AI-Test-missing-sim2". Please check the name and let me know if you want to try again. How else can I help?" | No update offered, as designed. |
| ambiguous | "Update AI-Test-sim3 to Closed Won" | `find_opportunity` → mock `matchCount 1` (the simulator did **not** return several); `update_opportunity_stage` → mock success | "The stage for opportunity "AI-Test-sim3" is now Closed Won. …" | **Not testable in simulation:** the mock decides the match count. Needs live preview with two real records. |
| invalidstage | "Move the opportunity AI-Test-sim4 to Signed" | `find_opportunity` → mock single; `update_opportunity_stage {newStage: Signed}` → mock `success true, currentStage "Signed"` | "The opportunity "AI-Test-sim4" stage is now Signed. …" | **Not testable in simulation:** the mock accepted a stage the real Apex rejects. The agent's reply was faithful to the (mocked) output. Needs live preview. |

Takeaway: simulation shows routing, action order and variable binding. It **cannot** show data-dependent outcomes, and it can make the agent state things that are impossible in the org ("stage is now Signed"). Live preview is needed for the real cases.

## Phase 1: live preview (2026-10-19, approved by you)

Script: `spikes/11-live-preview.sh` (run ID `lv1019000033`). **5 conversations used** (case 3 is one session with two user messages). Runs as `--use-live-actions` against the deployed Apex. The session metadata says `mockMode: "Live Test"`, versus `"Mock"` for the simulated sessions.

### Temporary validation rule

- Source lives **outside `force-app`**: `spikes/metadata/vr-deploy/` (package.xml + `objects/Opportunity.object` holding only `AI_Test_Block_Closed_Won`) and `spikes/metadata/vr-remove/` (empty package.xml + `destructiveChanges.xml`).
- Formula: `AND(ISCHANGED(StageName), ISPICKVAL(StageName, "Closed Won"), BEGINS(Name, "AI-Test-"))`. Error: "Closed Won needs an approved quote first." It only ever affects `AI-Test-*` records.
- `sf project deploy validate --json --metadata-dir spikes/metadata/vr-deploy --single-package` → "No package.xml found". **Without** `--single-package` it succeeds (the directory root holds package.xml).
- Deployed only before case 5: `sf project deploy start --json --metadata-dir spikes/metadata/vr-deploy` → success. Removed in the script's EXIT trap with `--metadata-dir spikes/metadata/vr-remove` → success.
- Verified afterwards: Tooling `ValidationRule` on Opportunity → 0 rows. `SELECT COUNT() FROM Opportunity WHERE Name LIKE 'AI-Test-%'` → 0. Accounts → 0.

### Results (org state is the ground truth; replies quoted exactly)

| # | Case | Actions (from raw trace FunctionSteps, real outputs) | Agent reply | Org before → after |
|---|---|---|---|---|
| 1 | Happy path: "Move the opportunity AI-Test-lv1019000033-happy to Qualification" | `find_opportunity` → matchCount 1, real Id `006…`; `update_opportunity_stage {newStage: Qualification}` → `success: true`, "Stage changed from Prospecting to Qualification." | "The stage for opportunity "AI-Test-lv1019000033-happy" is now Qualification. Would you like to update another opportunity or need more details?" | Prospecting → **Qualification** ✔ |
| 2 | Not found: "What stage is the opportunity AI-Test-lv1019000033-missing in?" | `find_opportunity` → matchCount 0 | "No opportunity matched "AI-Test-lv1019000033-missing". Please check the name and let me know if you want to try again. How else can I help with opportunity lookups or stage changes?" | no record; nothing changed ✔ |
| 3 | Ambiguous: (1) "Update AI-Test-lv1019000033-amb to Closed Won" (2) "AI-Test-lv1019000033-amb-A" | Message 1: `find_opportunity` → matchCount 2 + candidates; **no update** (gate closed: `opportunityId` was ""). Message 2: `find_opportunity(amb-A)` → 1 match; `update_opportunity_stage {Closed Won}` → success | (1) lists both candidates, then "Which one do you want to update to Closed Won?" (2) "The stage for "AI-Test-lv1019000033-amb-A" has been changed from Prospecting to Closed Won. …" | amb-A Prospecting → **Closed Won**; amb-B **unchanged** (Prospecting) ✔ |
| 4 | Invalid stage: "Move the opportunity AI-Test-lv1019000033-inv to Signed" | `find_opportunity` → 1 match; `update_opportunity_stage {newStage: Signed}` → `success: false`, "Stage "Signed" isn't valid. Valid stages: …" | "The change was not saved. Stage "Signed" isn't valid. Valid stages are: Prospecting, … Closed Lost. The stage is still Prospecting. Which of these valid stages would you like to use?" | Prospecting → Prospecting ✔ (no change) |
| 5 | **Blocked save** (rule active): "Move the opportunity AI-Test-lv1019000033-blk to Closed Won" | `find_opportunity` → 1 match; `update_opportunity_stage {Closed Won}` → `success: false`, "The change was not saved: Closed Won needs an approved quote first.", `currentStage: Negotiation/Review` | **"The change was not saved: Closed Won needs an approved quote first. The stage is still Negotiation/Review. Would you like to move this opportunity to a different stage or need details about another opportunity?"** | Negotiation/Review → Negotiation/Review ✔ (blocked) |

### What this settles

- **What the agent says when a validation rule blocks the save:** it reports the failure honestly and quotes the rule's error message. With this (honest) action, the demo headline is **"Agent Interceptor proves the outcome and classifies it as `HONEST_FAILURE`, which still blocks release"**, not "false success caught". No false success was observed live. The only false claims seen were in **simulated** mode ("stage is now Signed"), where the mock invented a success.
- **Whose permissions live actions use in preview:** `LastModifiedBy.Username` on changed records is `YOUR_ADMIN_USERNAME`. **Caveat:** that is both the CLI's logged-in user and the `default_agent_user` workaround value, so this run cannot tell which of the two the runtime used.
- **Every write was the expected one:** only the targeted records changed. amb-B stayed untouched (the `UNEXPECTED_CHANGE` check would pass).

### Trace facts (needed for the Phase 2 conversation driver)

- `sf agent preview send --json` returns `result.messages[].planId`. The raw trace for that turn is `.sfdx/agents/<bundle>/sessions/<sessionId>/traces/<planId>.json`.
- Raw trace steps: `.plan[]` with `type == "FunctionStep"`. Action data is at `.function.{name, input, output}` (objects). Live outputs carry runtime keys `__action_execution_status__`, `__tool_idx__`, `__supports_result_display__`.
- **CLI pitfall:** `sf agent trace read -t N` numbers **every message**, including the welcome message (turn 1 = welcome, 2 = first user message, 3 = first agent reply, …). Asking for `-t 2` in a two-message conversation returned the **first** reply's plan. Its `detail` entries are labelled `turn: 2` but carry planId `ffda68dd…` of the first reply, so it would misreport which actions ran. `turn-index.json` in the session folder holds the real mapping. The spike now reads traces by planId (`spikes/10-preview.sh`).

## Phase 2: Agent Interceptor build and first end-to-end run (2026-10-19)

### Build and unit tests

- `interceptor/`: TypeScript (5.9.3) on Node, runtime dependency `yaml` 2.9.1 only. `npm test` = `tsc` + `node --test dist/test/*.test.js`.
- **39 unit tests, 39 pass** (offline). Fixtures are real recorded output, redacted: `preview-start.json`, `preview-send-blocked.json`, `trace-blocked.json` (FunctionSteps of the live blocked-save turn), `agentia-status-failed.json` (Phase 0 build), `agentia-logs-verified.json` (CRT build 691687 log with real IVERIFY lines). Code coverage was **not measured**.
- `node --test dist/test/` (a directory) fails on Node 24 with "Cannot find module"; a glob works.

### CRT job

- `interceptor crt-sync` → `agentia testing create -p 18329 --robot 28176 --name "Agent Interceptor Verify" --file …/crt/interceptor_verify.robot --base-path …/crt --json` → **job 28204** (now `crt.job` in `interceptor.config.yaml`).
- The generic suite receives checks as base64 JSON in `--variable CHECKS_B64:<…>` plus `SF_DOMAIN` and `RUN_ID`. It authenticates with `Client Authenticate` and logs one `IVERIFY|{"key","found","actual","pass"}` line per check (verified in the build 691687 log). It prints `IRUN|<runId>`, and the build is matched to the run via `configuration.executionParameters` `RUN_ID:<runId>`.

### First end-to-end demo scenario (`interceptor/demo/demo-scenario.sh`, approved by you; 3 live conversations)

| Step | Command | Agent reply (start) | CRT build | Org checks | Verdict / exit |
|---|---|---|---|---|---|
| Baseline | `interceptor run --action update_opportunity_stage` (`ir1019002928`) | "The stage for opportunity "AI-Test-ir1019002928-target" is now Closed Won. …" | 691688 `succeeded` | target.StageName = Closed Won ✔; bystander unchanged ✔ | **VERIFIED** (rule 5), exit 0 |
| Change | rule v1 `Opportunity.Closed_Won_Needs_Quote` (`ISCHANGED(StageName) && ISPICKVAL(StageName,"Closed Won")`) added under `force-app/…/validationRules/` and deployed (`sf project deploy start --json -m ValidationRule:Opportunity.Closed_Won_Needs_Quote`) | | | | |
| Gate | `interceptor gate` (`ir1019003022`). Impact: `added ValidationRule Opportunity.Closed_Won_Needs_Quote` → `update_opportunity_stage` ("validation rules run when Opportunity is saved, and update_opportunity_stage writes Opportunity"). `find_opportunity` not selected. | "The change was not saved: Closed Won needs an approved quote first. The stage is still Negotiation/Review. …" | 691690 `failed` | target.StageName = Negotiation/Review ✘; bystander ✔ | **HONEST_FAILURE** (rule 7), **exit 1** |
| Fix | rule v2 adds `Amount >= 50000`; deployed | | | | |
| Gate | `interceptor gate` (`ir1019003112`), same impact | "The stage for opportunity "AI-Test-ir1019003112-target" is now Closed Won. …" | 691691 `succeeded` | target ✔; bystander ✔ | **VERIFIED**, **exit 0** |
| Cleanup | EXIT trap: rule file removed; `sf project deploy start --json --metadata-dir interceptor/demo/remove` → `success: true` | | | | |

Afterwards: Tooling `ValidationRule` on Opportunity → 0. `AI-Test-%` Opportunities → 0. Every run's teardown reported no problems. Reports: `interceptor/runs/<runId>/report.md` (git-ignored).

## Phase 2: Agentia quality-gate integration (2026-10-19)

The Agentia CLI is obfuscated, so its contract was established with a probe script that only printed its environment and exited with a chosen code (no conversations used):

| Probe | Result |
|---|---|
| `agentia cicd work test --local --json -e PROBE_EXIT=0 -e INTERCEPTOR_BASE=HEAD` | exit 0, `{status: 0, result: {local: true, qualityGates: {exitCode: 0, output: "<script stdout>", ran: true, scriptPath: "<root>/.agentia_quality_gates.sh", skipped: false}}}`. The script runs with cwd = project root and no arguments. Environment includes `AGENTIA_APEX_RERUN_FAILED`, `AGENTIA_APEX_TEST_CLASSES` and every `-e` variable. |
| same with `PROBE_EXIT=1` / `2` | agentia exit 1, `error.message`: "Local quality gates failed (exit 1 \| 2) when running '.agentia_quality_gates.sh'. Re-run with --skip-local-tests to bypass local gates." |
| CICD auth / work item | **Not needed** for `--local`. |

Then the real `.agentia_quality_gates.sh` (calls `interceptor gate --base ${INTERCEPTOR_BASE:-HEAD}` and passes its exit code through):

| Run | Result |
|---|---|
| Clean tree: `agentia cicd work test --local --json` | status 0; output "Changes since HEAD: 0 metadata component(s) / No agent action is affected" (`ir1019082038`, 0 conversations). |
| `GATE_VIA=agentia SKIP_BASELINE=1 interceptor/demo/demo-scenario.sh` (approved; 2 conversations) | Rule v1: `agentia cicd work test --local` printed the interceptor output, verdict **HONEST_FAILURE** (`ir1019084010`, CRT build 691807 `failed`), and **agentia exited 1** ("Local quality gates failed (exit 1)"). Fix v2: verdict **VERIFIED** (`ir1019084103`, build 691808 `succeeded`), **agentia exited 0**. Rule deleted afterwards. |
| Agentia warning both times | "Failed to report local quality gates result: not on a feature/US-XXXX branch." Agentia tries to report the gate result back to a Copado user story; that needs a user-story branch and CICD setup, which this project does not have. |

`agentia cicd work submit` (which runs the same script before submitting) was **not run**: it needs Copado CICD auth, a project/pipeline and a user story.

## Phase 2: find_opportunity live (2026-10-19)

`interceptor gate --action find_opportunity` (`ir1019084215`, 1 conversation): the agent replied "The opportunity "AI-Test-ir1019084215-lookup" is in stage Qualification. Its close date is 2026-11-18 and the amount is 500.0. …". CRT build 691809 `succeeded`; checks `lookup.StageName = Qualification`, `lookup.Amount = 500`, `lookup.CloseDate = 2026-11-18` all pass → **VERIFIED**, exit 0.

Org after all Phase 2 runs: Opportunity validation rules 0; `AI-Test-%` Opportunities 0.

### Not yet done or verified

- Fix loop (`agentia ai agent ask`): Copado AI auth is not set up, so it is **not built**.
- `FALSE_SUCCESS`, `WRONG_ACTION` and `UNEXPECTED_CHANGE` are exercised only in unit tests, not live. The honest demo agent does not produce them.

## Phase 2: opt-in live tests (2026-10-21, approved by you; 4 conversations)

Pre-flight: `agentia auth get --crt --json` → `ready: true`; Opportunity validation rules 0; `AI-Test-%` Opportunities 0; unit tests 39 pass, 2 skipped.

`INTERCEPTOR_LIVE=1 node --test --test-concurrency=1 dist/test/live.test.js` → **exit 0, 2 tests, 2 pass**, 194.7 s (02:47:51Z–02:51:06Z):

| Test | Run | Verdict / exit | CRT build |
|---|---|---|---|
| find_opportunity VERIFIED | `ir1021081756` (gate) | VERIFIED / 0 | 692569 succeeded |
| demo scenario: baseline | `ir1021081836` (run) | VERIFIED / 0 | 692570 succeeded |
| demo scenario: rule v1 gate | `ir1021081927` (gate) | HONEST_FAILURE / **1** | 692574 failed |
| demo scenario: fix v2 gate | `ir1021082021` (gate) | VERIFIED / **0** | 692576 succeeded |

All teardowns reported no problems. Afterwards: Opportunity validation rules 0, `AI-Test-%` Opportunities 0, git working tree clean (rule file removed). Console output: `interceptor/runs/live-tests-console.txt` (git-ignored).

## Agentia MCP server + Agent Skill (2026-10-21)

Probed by sending JSON-RPC over stdio to `agentia mcp start` (`initialize`, `tools/list`, `tools/call`):

| Call | Result |
|---|---|
| `tools/list` | 222 tools, including `agentia_work_test` (runs `.agentia_quality_gates.sh`), `agentia_testing_run/status/logs`, `agentia_testing_build_get/list/latest/logs`. |
| `tools/call agentia_work_test {local: true}` (clean tree) | The tool **did run** `.agentia_quality_gates.sh`: run record `ir1021173611` (gate, 0 conversations, exit 0) has the same timestamp. But the tool result was `isError: true` with only "No work item recorded. Run `agentia cicd work set <work-item>` first." and none of the gate's output. **Unlike the CLI, the MCP tool expects a Copado work item**, so an AI agent gets an error instead of the gate result in this setup. |
| `tools/call agentia_testing_logs {build: 692574, project: 18329, job: 28204}` | Works (arguments must be numbers). Returns `{buildId, jobId, projectId, status: "failed", log: "[REDACTED]"}`: **the MCP server redacts the log text**. |
| `tools/call agentia_testing_build_get {build: 692574, job: 28204, project: 18329}` | Works. Returns `status: "failed"`, `logReportUrl`, `startTime`, `duration`, `robotId`. |
| `.mcp.json` launch command `sh -c 'PATH="$HOME/.npm-global/bin:/usr/local/bin:$PATH" exec agentia mcp start'` run with a bare environment | `initialize` returns `serverInfo {name: "@copado/agentia-cli", version: "1.0.0-rc.0"}`. |

Added:
- `.claude/skills/agent-interceptor/SKILL.md`, an Agent Skill. It tells an AI agent (Claude Code) how to run `interceptor gate`, read `runs/<runId>/run.json`, confirm the CRT build through the Agentia MCP tool `agentia_testing_build_get`, and explain the verdict in plain language.
- `.mcp.json`, which registers the Agentia MCP server for this project. Claude Code asks the user to approve project MCP servers the first time.
- **Not yet verified:** an AI agent actually loading the skill and calling the MCP tool end to end. No `claude` CLI is installed here for a headless run, so this is to be rehearsed in the Claude app before recording.

Screen-safe output for recordings: `INTERCEPTOR_SCREEN_SAFE=1` also masks Salesforce IDs (`00D…`, `005…`, `006…`, …) and e-mail-style usernames in everything Agent Interceptor prints or writes (unit test added). `report --html` now prints a relative path. Checked on run `ir1021081927`: the HTML report contains no IDs or usernames, and `explain` still works.
