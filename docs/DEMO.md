# Agent Interceptor: demo script (about 5 minutes)

**Story:** someone adds a harmless-looking validation rule. The agent wasn't touched, so nobody re-tests it. Agent Interceptor notices that the rule affects the agent, asks the agent to do the job for real, checks the org through Copado Robotic Testing, and Agentia's quality gate blocks the change until it's fixed.

Everything below was run for real on 2026-10-19 (see [VERIFICATION_LOG.md](VERIFICATION_LOG.md), Phase 2). Each step uses 1 live conversation, 3 in total.

## Before you start (not on camera)

- `cd ~/Projects/agent-interceptor`, on a clean tree (`git status` shows nothing to commit).
- `agentia auth get --crt --json` shows `ready: true`; `sf org display -o interceptor-dev --json` works.
- `(cd interceptor && npm run build)`.
- Open in the browser: the CRT project "Agent Interceptor" (robot "Interception Suite", job "Agent Interceptor Verify"), and the org's Opportunities list.
- No rule present: Setup → Object Manager → Opportunity → Validation Rules is empty.

## 0:00 The agent and the gap (45 s)

Show `force-app/main/default/aiAuthoringBundles/Opportunity_Assistant/Opportunity_Assistant.agent`: two actions, `find_opportunity` and `update_opportunity_stage`.

Say: "When the agent says 'it's now Closed Won', that sentence comes from a language model. A test that checks the reply can pass while the record never changed. Agent Interceptor checks the record."

## 0:45 Baseline: it works today (60 s)

```bash
node interceptor/dist/src/cli.js run --action update_opportunity_stage
```

Point at, in order:
- `org 00D… (Developer Edition) ok`: the production guard.
- `1 conversation(s) with LIVE actions (cap 10)`: the credit cap.
- `creating 2 test record(s)`: a target and a bystander, both named `AI-Test-<runId>-…`.
- The agent's reply: "… is now Closed Won."
- `verifying 2 field check(s) with crt` → **VERIFIED** "… checked by Copado Robotic Testing (via Agentia)".

In the CRT tab, show the new run of "Agent Interceptor Verify" (green). Its log has `IVERIFY|{"key": "target.StageName", … "actual": "Closed Won", "pass": true}`.

## 1:45 The change (30 s)

```bash
mkdir -p force-app/main/default/objects/Opportunity/validationRules
cp interceptor/demo/rule/v1-block-all.validationRule-meta.xml force-app/main/default/objects/Opportunity/validationRules/Closed_Won_Needs_Quote.validationRule-meta.xml
sf project deploy start --json -o interceptor-dev -m ValidationRule:Opportunity.Closed_Won_Needs_Quote
```

Say: "A new rule: Closed Won needs an approved quote. Nobody touched the agent."

## 2:15 The gate blocks it (75 s)

```bash
agentia cicd work test --local
```

Point at, in order:
- `Running local quality gates (.agentia_quality_gates.sh)`: Agentia runs our gate.
- `added ValidationRule Opportunity.Closed_Won_Needs_Quote` → `update_opportunity_stage` "because … validation rules run when Opportunity is saved, and update_opportunity_stage writes Opportunity". `find_opportunity` was **not** selected (it only reads).
- The agent's honest reply: "The change was not saved: Closed Won needs an approved quote first."
- **HONEST_FAILURE** "… org has "Negotiation/Review" … This still blocks release."
- Agentia: "Local quality gates failed (exit 1)". In CRT, the run is red.

Optional: `node interceptor/dist/src/cli.js explain <runId>` (the runId is printed on the run line).

Say: "This agent told the truth, which is good, but the change still breaks what users ask the agent to do, so it doesn't ship. If the agent had claimed success, the same check would say FALSE_SUCCESS."

## 3:30 Fix and re-run (60 s)

```bash
cp interceptor/demo/rule/v2-large-deals-only.validationRule-meta.xml force-app/main/default/objects/Opportunity/validationRules/Closed_Won_Needs_Quote.validationRule-meta.xml
sf project deploy start --json -o interceptor-dev -m ValidationRule:Opportunity.Closed_Won_Needs_Quote
agentia cicd work test --local
```

The fix: only deals of 50,000 or more need a quote. The test deal is 1,000, so **VERIFIED** and Agentia passes (exit 0).

## 4:30 Evidence and cleanup (30 s)

```bash
node interceptor/dist/src/cli.js report <runId> --html
```

Open the HTML report: conversation, actions from the trace, CRT build link, expected vs actual for each field, and "deleted after the run" for the test data.

Cleanup:

```bash
rm force-app/main/default/objects/Opportunity/validationRules/Closed_Won_Needs_Quote.validationRule-meta.xml
sf project deploy start --json -o interceptor-dev --metadata-dir interceptor/demo/remove
```

## One-command version

`interceptor/demo/demo-scenario.sh` does all of the above, including cleanup in an exit trap. With `GATE_VIA=agentia` the gate steps go through `agentia cicd work test --local`. It prints `DEMO SCENARIO: PASS` when the gate returns 1 and then 0.

## If something goes wrong on stage

| You see | Do |
|---|---|
| `INCONCLUSIVE` with a CRT error | Open the `logReportUrl` from `report <runId>`; rerun the step |
| `PreviewStartFailed … reading 'replace'` | The `access.default_agent_user` workaround was removed from the `.agent` file; restore it |
| The gate says "No agent action is affected" | The rule file isn't under `force-app/…/validationRules/`, or it was committed (the gate diffs against `HEAD`) |
