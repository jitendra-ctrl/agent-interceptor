# Agent Interceptor

An Agentforce agent can say "Done, I've updated the record" while the record never changed: a validation rule blocked the save, a Flow failed, a permission was missing. A test that only checks the reply still passes.

**Agent Interceptor treats the agent's reply as a claim and checks the org.** For a metadata change, it:

1. works out which agent actions the change can affect (git diff → agent definition → Apex);
2. asks the agent to do the job, with live actions, on its own `AI-Test-…` records in a non-production org;
3. checks the records in **Copado Robotic Testing**, started from the terminal with **Agentia Headless**;
4. gives one verdict per action (`VERIFIED`, `FALSE_SUCCESS`, `HONEST_FAILURE`, `WRONG_ACTION`, `UNEXPECTED_CHANGE`, `INCONCLUSIVE`) with the evidence;
5. blocks promotion through Agentia's local quality gate (`agentia cicd work test --local`) until every affected action is verified.

Built for Copado's Agentia Headless Virtual Hackathon (2026).

## Repository

| Path | What |
|---|---|
| `interceptor/` | Agent Interceptor (TypeScript CLI), CRT suite, specs, demo script, tests |
| `force-app/main/default/` | Demo org metadata: the Opportunity Assistant agent (Agent Script), its Apex actions and tests, permission sets, the External Client App CRT uses |
| `.agentia_quality_gates.sh` | Agentia local quality gate → `interceptor gate` |
| `.claude/skills/agent-interceptor/`, `.mcp.json` | Agent Skill + Agentia MCP server, so an AI agent (Claude Code) can run the check, confirm it in CRT and explain it |
| `docs/` | [Low-level design](docs/LLD.md), [demo script](docs/DEMO.md), [runbook](docs/RUNBOOK.md), [verification log](docs/VERIFICATION_LOG.md), [plan](docs/PLAN.md), [Agent Spec](docs/agent/Opportunity_Assistant-AgentSpec.md) |
| `spikes/` | Phase 0–1 proof-of-concept scripts |

## Quick start

Prerequisites (details in the [runbook](docs/RUNBOOK.md)): Node 18+, Salesforce CLI authorised to the demo org as `interceptor-dev`, Agentia CLI with CRT credentials (`agentia auth get --crt --json` → `ready: true`), and the metadata in `force-app/` deployed.

```bash
cd interceptor && npm ci && npm run build && npm test
```

```bash
node dist/src/cli.js impact
```

```bash
node dist/src/cli.js gate --action update_opportunity_stage
```

From the project root, through Agentia:

```bash
agentia cicd work test --local
```

The whole demo scenario (baseline → blocking rule → fix), with cleanup:

```bash
interceptor/demo/demo-scenario.sh
```

`gate` exit codes: `0` verified (or nothing affected), `1` intercepted, `2` inconclusive, `3` configuration/usage error or non-demo org.

## Use it with your own org

The org-specific values in this repo are placeholders. Replace them before deploying or running:

| Placeholder | Where | What to put |
|---|---|---|
| `YOUR_ORG_ID` | `interceptor/interceptor.config.yaml` (`org.expectedOrgId`) | Your Developer Edition org ID (`sf org display --json` → `result.id`). The production guard refuses any other org. |
| `YOUR_MY_DOMAIN` | `interceptor/interceptor.config.yaml` (`org.expectedInstanceUrl`) | Your My Domain, as in `https://<my-domain>.develop.my.salesforce.com` |
| `YOUR_ADMIN_USERNAME` | `force-app/…/Opportunity_Assistant.agent` (`access.default_agent_user`), `force-app/…/Agent_Interceptor_CRT.ecaOauthPlcy-meta.xml` (`clientCredentialsFlowUser`) | The org user that runs the client-credentials flow and previews the agent |
| `you@example.com` | `force-app/…/Agent_Interceptor_CRT.eca-meta.xml` (`contactEmail`) | A contact e-mail for the External Client App |
| CRT `project` / `robot` / `job` | `interceptor/interceptor.config.yaml` (`crt`) | Your Copado Robotic Testing project and robot; `interceptor crt-sync` creates the job and prints its ID |

The evidence in `docs/VERIFICATION_LOG.md` uses the same placeholders where the original run showed these values.

## Status

Working and verified on 2026-10-19:
- impact analysis;
- live conversations via `sf agent preview`;
- CRT verification through Agentia;
- all verdicts (the live demo produces `VERIFIED` and `HONEST_FAILURE`; the other verdicts are covered by unit tests);
- reports;
- the Agentia local quality gate;
- 41 unit tests (plus 2 opt-in live tests).

Not built:
- the AI fix loop (needs Copado AI auth);
- an Agent API conversation driver;
- `agentia cicd work submit` / user-story integration.

See [LLD §17](docs/LLD.md#17-limitations-and-future-work).
