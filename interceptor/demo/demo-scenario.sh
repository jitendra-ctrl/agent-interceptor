#!/usr/bin/env bash
# End-to-end demo scenario (live, 3 conversations):
#   1. baseline run          → update_opportunity_stage VERIFIED
#   2. add validation rule v1 (blocks every Closed Won), deploy, gate → exit 1 (HONEST_FAILURE)
#   3. fix: rule v2 (only deals ≥ 50,000), deploy, gate               → exit 0 (VERIFIED)
# An EXIT trap removes the rule file from force-app and deletes the rule from the org.
# Options (environment):
#   GATE_VIA=agentia   run the gate steps through `agentia cicd work test --local`
#                      (which runs .agentia_quality_gates.sh) instead of `interceptor gate`
#   SKIP_BASELINE=1    skip step 1 (saves one conversation)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$PKG/.." && pwd)"
RULE_FILE="$ROOT/force-app/main/default/objects/Opportunity/validationRules/Closed_Won_Needs_Quote.validationRule-meta.xml"
ALIAS=interceptor-dev
CLI=(node "$PKG/dist/src/cli.js")
DEPLOYED=0
step() { printf '\n==== %s\n' "$*"; }
AGENTIA="$(command -v agentia || echo "$HOME/.npm-global/bin/agentia")"
gate() {
  if [[ "${GATE_VIA:-interceptor}" == agentia ]]; then
    (cd "$ROOT" && "$AGENTIA" cicd work test --local)
  else
    "${CLI[@]}" gate
  fi
}

cleanup() {
  step "cleanup"
  rm -f "$RULE_FILE"; rmdir "$(dirname "$RULE_FILE")" 2>/dev/null; rmdir "$(dirname "$(dirname "$RULE_FILE")")" 2>/dev/null
  if [[ $DEPLOYED -eq 1 ]]; then
    (cd "$ROOT" && sf project deploy start --json --metadata-dir "$HERE/remove" -o "$ALIAS" --wait 10 2>/dev/null | jq -c '{rule_deleted_from_org: .result.success}')
  fi
  echo "rule file present: $([[ -f "$RULE_FILE" ]] && echo yes || echo no)"
}
trap cleanup EXIT

deploy_rule() { # version-file
  mkdir -p "$(dirname "$RULE_FILE")"
  cp "$HERE/rule/$1" "$RULE_FILE"
  local out
  out=$(cd "$ROOT" && sf project deploy start --json -o "$ALIAS" -m ValidationRule:Opportunity.Closed_Won_Needs_Quote --wait 10 2>/dev/null)
  if [[ "$(jq -r '.result.success' <<<"$out")" != "true" ]]; then echo "deploy failed: $out"; exit 3; fi
  DEPLOYED=1
  echo "deployed $1"
}

[[ -f "$RULE_FILE" ]] && { echo "rule file already exists; refusing"; exit 3; }

if [[ -z "${SKIP_BASELINE:-}" ]]; then
  step "1. baseline: interceptor run --action update_opportunity_stage"
  "${CLI[@]}" run --action update_opportunity_stage; echo "exit=$?"
fi

step "2. change: add validation rule v1 (blocks every Closed Won) and deploy it"
deploy_rule v1-block-all.validationRule-meta.xml
step "2b. gate via ${GATE_VIA:-interceptor} (impact from git diff against HEAD)"
gate; GATE1=$?; echo "gate exit=$GATE1 (expected 1)"

step "3. fix: rule v2 (only deals of 50,000 or more) and deploy it"
deploy_rule v2-large-deals-only.validationRule-meta.xml
step "3b. gate via ${GATE_VIA:-interceptor}"
gate; GATE2=$?; echo "gate exit=$GATE2 (expected 0)"

step "result"
if [[ $GATE1 -eq 1 && $GATE2 -eq 0 ]]; then echo "DEMO SCENARIO: PASS"; else echo "DEMO SCENARIO: FAIL (gate1=$GATE1 gate2=$GATE2)"; exit 1; fi
