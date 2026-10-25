# Plan

Submission deadline: **Mon 26 Oct 2026**. Written 18 Oct after Phase 0. Dates are targets; the protection order from the brief applies if time runs short:
(1) demo agent with live actions → (2) demo scenario end to end with CRT verification → (3) honest verdicts and the evidence report → (4) impact analysis → (5) fix loop → (6) polish.

## Milestones

| Date | Milestone | Checkpoint |
|---|---|---|
| Sun 18 Oct | Phase 0 complete: tooling, org, CRT auth, CRT record check, passing data into CRT | **(a)**, waiting for go-ahead |
| Mon 19 Oct | Agent Spec `docs/agent/Opportunity_Assistant-AgentSpec.md` written | **(b)** |
| Mon 19 – Tue 20 Oct | Apex actions + tests (≥ 85%) deployed. Authoring bundle generated, `.agent` written and validated. Simulated preview. | |
| Tue 20 Oct | Live preview: happy path, not found, ambiguous, invalid stage, blocked save (temporary validation rule). Replies and traces logged. | **(c)** |
| Wed 21 Oct | Interceptor core: config + schema, spec loader, test data setup/teardown, `sfPreviewDriver`, `localSoqlVerifier`, claim classifier, verdicts, report JSON | |
| Thu 22 Oct | `crtVerifier`: generate the per-run suite, pass values with `--variable`, read back status/xunit/logs, recover the build ID after a failure | |
| Fri 23 Oct | `gate` + exit codes. Demo scenario end to end (baseline pass → add validation rule → gate 1 → remove → gate 0). `.agentia_quality_gates.sh` hook for `agentia cicd work test --local`. | **(d)** |
| Sat 24 Oct | Impact analysis (diff → `.agent` → Apex SObject refs, plus manual mapping). `explain`, `report --html`. Fix loop only if Copado AI auth is available. | |
| Sun 25 Oct | Unit test pass with recorded fixtures, opt-in live tests, LLD (21 sections), DEMO.md, README, RUNBOOK | |
| Mon 26 Oct | Buffer, rehearse the demo, submit | |

## Progress (updated 2026-10-21)

| Milestone | Status |
|---|---|
| Phase 0 (checkpoint a) | done 10-18 |
| Agent Spec (checkpoint b) | approved 10-18 |
| Agent built, simulated + live preview (checkpoint c) | done 10-19 |
| Agent Interceptor core, CRT verifier, gate, reports, impact | done 10-19 |
| First end-to-end run (checkpoint d) | done 10-19 (`ir1019003022` exit 1, `ir1019003112` exit 0) |
| Agentia quality gate (`.agentia_quality_gates.sh`) | done 10-19, verified via `agentia cicd work test --local` |
| Opt-in live tests | 2/2 pass on 10-21 (4 conversations) |
| LLD, DEMO, RUNBOOK, README | written 10-19 |
| Fix loop | not started (needs Copado AI auth) |

## Design adjustments from Phase 0 (details in `VERIFICATION_LOG.md`)

1. **CRT job, not robot.** `agentia testing run` takes a job/test ID. Robot 28176 is the parent. Agent Interceptor will own one CRT job (created with `agentia testing create`, updated per release with `agentia testing update`) and pass run values with `--variable`.
2. **Failed runs hide the build ID under `--json`.** The CRT verifier gets it from `agentia testing status --job <id> --json` straight after the run.
3. **CRT login uses client credentials** (`Client Authenticate`) via the External Client App `Agent_Interceptor_CRT`. The username-password `Authenticate` keyword is deprecated.
4. **Pipeline hook exists:** `agentia cicd work test --local` and `cicd work submit` run the project-root `.agentia_quality_gates.sh`. `interceptor gate` goes there. Remote/cloud quality gates are "not implemented yet" in Agentia. `cicd work submit` also needs Copado CICD auth and a user story, which we don't have yet.
5. **Dependency analysis:** `agentia cicd metadata dependency list` exists but needs a Copado CICD pipeline and credential IDs, and it is unknown whether it understands Agentforce actions. Agent Interceptor's own `.agent` + Apex parser is the primary path; Agentia's analyzer is optional.
6. **`agentia ai agent ask --agent`** takes a fixed list (`plan|build|test|release|operate|knowledge`) and needs Copado AI auth. The fix loop depends on that auth.
7. **New option:** QForce has `Create Agentforce Session` / `Send Agentforce Message` (Agent API), so CRT could hold the conversation itself. That requires a published, active agent and extra ECA scopes. Default stays `sf agent preview` (works on a draft authoring bundle); revisit at checkpoint (c).
8. **Preview needs `access.default_agent_user` (CLI defect).** `sf agent preview start --authoring-bundle` crashes for an employee agent without it (`@salesforce/agents` 2.3.1). Workaround: set it to the admin user in the local `.agent` only. Must be checked before any publish.
9. **Read traces by planId, not `sf agent trace read -t`.** The `-t` turn numbering counts every message. The conversation driver will use `send`'s `planId` and the raw trace files.
10. **Headline changes to "outcome proven / honest failure blocks release".** Live, the agent reported the blocked save truthfully. `FALSE_SUCCESS` stays a supported verdict (and is what simulation produced), but the demo will not stage it with a lying action.

## Resolved in Phase 1

- Trace contents: action name, inputs and outputs per FunctionStep (see `VERIFICATION_LOG.md`).
- Agent reply on a blocked save: honest, quotes the validation error.
- Permissions: records were modified by the admin user. Logged-in user vs `default_agent_user` couldn't be separated, because both are the admin.

## Still unknown

- Whether `enableEinsteinGptCopilot = false` matters after **publish** (it does not block draft preview: simulated and live preview both worked).
- Whether publish succeeds with the `default_agent_user` workaround in place (not attempted).
