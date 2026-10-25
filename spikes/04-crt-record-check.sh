#!/usr/bin/env bash
# Phase 0 check 4: a CRT test passes when a test record holds the expected value,
# then fails after the value changes. Creates and deletes its own AI-Test-<runId> record.
# Usage: spikes/04-crt-record-check.sh <crtJobId> [--keep-data]
set -uo pipefail
cd "$(dirname "$0")/.."
source spikes/lib/guard.sh
guard_demo_org
export PATH="$HOME/.npm-global/bin:$PATH"
JOB="${1:?crt job id}"; KEEP="${2:-}"
PROJECT=18329
DOMAIN="https://YOUR_MY_DOMAIN.develop.my.salesforce.com"
RUN_ID="p0-$(date +%Y%m%d%H%M%S)"
OUT="spikes/out/$RUN_ID"; mkdir -p "$OUT"

rec=$(sf data create record -o "$ORG_ALIAS" --json -s Account -v "Name='AI-Test-$RUN_ID' Description='before-$RUN_ID'")
ID=$(jq -r '.result.id' <<<"$rec")
echo "created Account AI-Test-$RUN_ID id=$ID"
cleanup() {
  [[ "$KEEP" == "--keep-data" || -z "$ID" || "$ID" == "null" ]] && return
  sf data delete record -o "$ORG_ALIAS" --json -s Account -i "$ID" 2>/dev/null | jq -c '{deleted: .result.id}'
}
trap cleanup EXIT

crt_run() { # expected-value label
  agentia testing run "$JOB" -p "$PROJECT" --wait-for-result --timeout 15 --json \
    --variable "SF_DOMAIN:$DOMAIN" --variable "RECORD_ID:$ID" --variable "EXPECTED_DESCRIPTION:$1" \
    > "$OUT/run-$2.json" 2>&1
  local code=$?
  local build
  build=$(agentia testing status -p "$PROJECT" --job "$JOB" --json 2>/dev/null | jq -r '.result[0].id')
  agentia testing logs "$build" -p "$PROJECT" -j "$JOB" -o "$OUT/log-$2.txt" --json >/dev/null 2>&1
  echo "$2: exit=$code build=$build $(grep -hE 'ACTUAL\||\| (PASS|FAIL) \|' "$OUT/log-$2.txt" | head -3 | tr '\n' ' ')"
  return $code
}

crt_run "before-$RUN_ID" baseline; base=$?
sf data update record -o "$ORG_ALIAS" --json -s Account -i "$ID" -v "Description='after-$RUN_ID'" >/dev/null
crt_run "before-$RUN_ID" changed; changed=$?

if [[ $base -eq 0 && $changed -ne 0 ]]; then echo "RESULT: PASS (baseline passed, changed record failed)"; else echo "RESULT: FAIL (baseline=$base changed=$changed)"; fi
