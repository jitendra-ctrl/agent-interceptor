#!/usr/bin/env bash
# Production guard: refuses to continue unless the target is the demo Developer Edition org.
# Usage: source spikes/lib/guard.sh; guard_demo_org
# (no set -e here: callers decide their own error handling)

ORG_ALIAS="${ORG_ALIAS:-interceptor-dev}"
EXPECTED_ORG_ID="YOUR_ORG_ID"
EXPECTED_INSTANCE="https://YOUR_MY_DOMAIN.develop.my.salesforce.com"

guard_demo_org() {
  local display org
  display=$(sf org display -o "$ORG_ALIAS" --json 2>/dev/null)
  local id instance
  id=$(jq -r '.result.id' <<<"$display")
  instance=$(jq -r '.result.instanceUrl' <<<"$display")
  org=$(sf data query -o "$ORG_ALIAS" --json \
    -q "SELECT Id, IsSandbox, OrganizationType FROM Organization" 2>/dev/null)
  local type sandbox
  type=$(jq -r '.result.records[0].OrganizationType' <<<"$org")
  sandbox=$(jq -r '.result.records[0].IsSandbox' <<<"$org")
  if [[ "$id" != "$EXPECTED_ORG_ID" || "$instance" != "$EXPECTED_INSTANCE" || "$type" != "Developer Edition" ]]; then
    echo "GUARD FAIL: alias $ORG_ALIAS is not the demo Developer Edition org (id=$id type=$type sandbox=$sandbox)" >&2
    exit 99
  fi
  echo "guard ok: $ORG_ALIAS id=$id type=$type sandbox=$sandbox"
}
