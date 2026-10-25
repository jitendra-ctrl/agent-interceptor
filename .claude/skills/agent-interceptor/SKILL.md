---
name: agent-interceptor
description: Explains Agent Interceptor results and checks whether a Salesforce change is safe to ship for the Opportunity Assistant agent. TRIGGER when the user asks why the quality gate, the release check, `agentia cicd work test` or `interceptor gate` blocked, failed or stopped their change; what the last check or run found; whether a change can ship or be promoted; or about a verdict such as HONEST_FAILURE, FALSE_SUCCESS, WRONG_ACTION, UNEXPECTED_CHANGE or INCONCLUSIVE. Reads interceptor/runs/<runId>/run.json, confirms the result in Copado Robotic Testing through the Agentia MCP server (agentia_testing_build_get), and explains it in plain language.
---

# Agent Interceptor

Agent Interceptor treats the agent's reply as a claim and checks the org. It lives in `interceptor/`
(CLI: `node interceptor/dist/src/cli.js`), and its design is in `docs/LLD.md`. Every run writes
`interceptor/runs/<runId>/run.json`.

## Explain a result ("why was my change blocked?", "what did the check find?")

1. Pick the run to explain, using the file-search and read tools (no shell needed) on `interceptor/runs/*/run.json`:
   - if the user named a runId, read `interceptor/runs/<runId>/run.json`;
   - if they ask why something was **blocked, failed or stopped**, take the newest run (latest `startedAt`) whose
     `exitCode` is 1 or 2. A later passing run doesn't answer that question;
   - otherwise take the newest run.
   Explain that run as it was recorded. Don't inspect the current `force-app` files to second-guess it.
2. Read that `run.json`. For each entry in `results[]`, note:
   - `verdict.kind` and `verdict.explanation`;
   - `conversation.turns[].reply`: what the agent said;
   - `conversation.turns[].actions[]`: which actions really ran, with their `output`;
   - `verification.checks[]`: expected vs actual value in the org;
   - `verification.evidence.buildId`, `crtJob` and `crtProject`.
3. Confirm the result independently in Copado Robotic Testing. Call the Agentia MCP tool
   `agentia_testing_build_get` with numbers `{ "build": <buildId>, "job": <crtJob>, "project": <crtProject> }`.
   A failing check should show build `status` "failed"; all checks passing should show "succeeded".
   Mention the build's `logReportUrl`. (Over MCP the build log text comes back redacted, so use the
   status and the run.json checks; don't ask for the log.)
4. Answer in plain language, in this order:
   - the verdict and what it means (with the runId and gate exit code);
   - which change was tested and why (from `impact.impacted[].paths`);
   - what the agent said;
   - what the org actually holds;
   - what CRT reported;
   - the most likely cause, taken from the action's `message` output;
   - what would make it pass.

   Keep it short. Quote values exactly. Never call `INCONCLUSIVE` a pass.

## Run the check ("can I ship this?")

- `node interceptor/dist/src/cli.js gate` (from the repo root). Exit codes: 0 verified or nothing affected,
  1 intercepted, 2 inconclusive, 3 config, usage or not the demo org.
- This talks to the agent with **live actions** in the demo org: one conversation per affected action.
  It creates and deletes `AI-Test-` records. Run it only when the user asked for the check to run.
- Then explain the result as above.

## Rules

- Don't change org metadata or records yourself. Don't run deploys.
- Don't print credentials, tokens or record IDs in the answer.
- The demo agent reports failures honestly. When the verdict is `HONEST_FAILURE`, say the agent told the
  truth but the change still breaks what users ask it to do, so it should not ship.
