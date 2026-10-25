#!/usr/bin/env bash
# Phase 1 live preview: 5 conversations against Opportunity_Assistant with LIVE actions,
# on AI-Test-<runId> records created here. The temporary validation rule is deployed only
# for the blocked-save case. An EXIT trap always removes the rule and deletes the records.
# Usage: spikes/11-live-preview.sh [--keep-data]
set -uo pipefail
cd "$(dirname "$0")/.."
source spikes/lib/guard.sh
guard_demo_org || exit 99
KEEP="${1:-}"
RUN_ID="lv$(date +%m%d%H%M%S)"
P="AI-Test-$RUN_ID"
OUT="spikes/out/live-$RUN_ID"; mkdir -p "$OUT"
VR_DEPLOYED=0
CREATED_IDS=()

echo "run $RUN_ID: 5 conversations will be used (cap 10)."

cleanup() {
  if [[ $VR_DEPLOYED -eq 1 ]]; then
    sf project deploy start --json --metadata-dir spikes/metadata/vr-remove -o "$ORG_ALIAS" --wait 10 2>/dev/null \
      | jq -c '{rule_removed: .result.success}'
  fi
  if [[ "$KEEP" != "--keep-data" ]]; then
    for id in "${CREATED_IDS[@]}"; do
      sf data delete record --json -s Opportunity -i "$id" -o "$ORG_ALIAS" 2>/dev/null | jq -c '{deleted: .result.id}'
    done
  fi
}
trap cleanup EXIT

create() { # name stage
  local id
  id=$(sf data create record --json -s Opportunity -o "$ORG_ALIAS" \
    -v "Name='$1' StageName='$2' CloseDate=$(date -v+30d +%Y-%m-%d) Amount=1000" 2>/dev/null | jq -r '.result.id')
  CREATED_IDS+=("$id"); echo "$id"
}
state() { # label
  sf data query --json -o "$ORG_ALIAS" \
    -q "SELECT Id, Name, StageName, LastModifiedBy.Username, LastModifiedDate FROM Opportunity WHERE Name LIKE '$P%' ORDER BY Name" 2>/dev/null \
    | jq -c '[.result.records[] | {Name, StageName, LastModifiedBy: .LastModifiedBy.Username, LastModifiedDate}]' > "$OUT/state-$1.json"
  echo "  state[$1]: $(cat "$OUT/state-$1.json")"
}
conv() { # case utterances...
  local c="$1"; shift
  ./spikes/10-preview.sh live "$RUN_ID-$c" "$@"
  for f in spikes/out/preview/live-$RUN_ID-$c/trace-actions-*.json; do
    jq -c '.actions[] | {name, input, output: (.output | del(.__tool_idx__, .__supports_result_display__))}' "$f"
  done
}

create "$P-happy" Prospecting >/dev/null
create "$P-amb-A" Prospecting >/dev/null
create "$P-amb-B" Prospecting >/dev/null
create "$P-inv" Prospecting >/dev/null
create "$P-blk" "Negotiation/Review" >/dev/null
state before

echo "== case 1 happy";     conv happy "Move the opportunity $P-happy to Qualification"; state after-happy
echo "== case 2 notfound";  conv notfound "What stage is the opportunity $P-missing in?"; state after-notfound
echo "== case 3 ambiguous"; conv ambiguous "Update $P-amb to Closed Won" "$P-amb-A"; state after-ambiguous
echo "== case 4 invalid";   conv invalid "Move the opportunity $P-inv to Signed"; state after-invalid

echo "== deploying temporary validation rule"
sf project deploy start --json --metadata-dir spikes/metadata/vr-deploy -o "$ORG_ALIAS" --wait 10 2>/dev/null > "$OUT/vr-deploy.json"
if [[ "$(jq -r '.result.success' "$OUT/vr-deploy.json")" == "true" ]]; then VR_DEPLOYED=1; echo "  rule deployed"; else echo "  rule deploy FAILED"; cat "$OUT/vr-deploy.json"; exit 5; fi
echo "== case 5 blocked";   conv blocked "Move the opportunity $P-blk to Closed Won"; state after-blocked
echo "run $RUN_ID done"
