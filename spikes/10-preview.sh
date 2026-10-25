#!/usr/bin/env bash
# Phase 1: run one preview conversation against the Opportunity_Assistant authoring bundle.
# Usage: spikes/10-preview.sh <simulate|live> <case-name> "<utterance 1>" ["<utterance 2>" ...]
# Writes start/send/end JSON and per-turn action traces to spikes/out/preview/<mode>-<case>/.
# Each call is ONE conversation (counts toward the per-run credit cap).
set -uo pipefail
cd "$(dirname "$0")/.."
source spikes/lib/guard.sh
guard_demo_org >/dev/null || exit 99
MODE="$1"; CASE="$2"; shift 2
case "$MODE" in
  simulate) MODE_FLAG=--simulate-actions ;;
  live) MODE_FLAG=--use-live-actions ;;
  *) echo "mode must be simulate or live" >&2; exit 3 ;;
esac
BUNDLE=Opportunity_Assistant
OUT="spikes/out/preview/$MODE-$CASE"; rm -rf "$OUT"; mkdir -p "$OUT"

sf agent preview start --json --authoring-bundle "$BUNDLE" $MODE_FLAG -o "$ORG_ALIAS" > "$OUT/start.json" 2>"$OUT/start.err"
SID=$(jq -r '.result.sessionId // empty' "$OUT/start.json")
if [[ -z "$SID" ]]; then echo "start failed:"; cat "$OUT/start.json"; exit 4; fi
echo "session started ($MODE)"

turn=0
for u in "$@"; do
  turn=$((turn+1))
  sf agent preview send --json --authoring-bundle "$BUNDLE" --session-id "$SID" -u "$u" -o "$ORG_ALIAS" > "$OUT/send-$turn.json" 2>"$OUT/send-$turn.err"
  echo "USER[$turn]: $u"
  echo "AGENT[$turn]: $(jq -r '[.result.messages[]?.message] | join(" / ")' "$OUT/send-$turn.json")"
  # "sf agent trace read -t N" numbers every message (welcome, user, agent), not user turns,
  # so read the turn's plan by the planId that "send" returns instead.
  PLAN=$(jq -r '[.result.messages[]?.planId | select(.)][0] // empty' "$OUT/send-$turn.json")
  TRACES=".sfdx/agents/$BUNDLE/sessions/$SID/traces"
  if [[ -n "$PLAN" && -f "$TRACES/$PLAN.json" ]]; then
    jq '{planId: "'"$PLAN"'", actions: [(.plan // .steps)[] | select(.type == "FunctionStep") | .function | {name, input, output}]}' \
      "$TRACES/$PLAN.json" > "$OUT/trace-actions-$turn.json"
  else
    echo '{"planId": null, "actions": []}' > "$OUT/trace-actions-$turn.json"
  fi
done
sf agent preview end --json --authoring-bundle "$BUNDLE" --session-id "$SID" -o "$ORG_ALIAS" > "$OUT/end.json" 2>"$OUT/end.err"
echo "ended: status=$(jq -r '.status' "$OUT/end.json") traces=$(jq -r '.result.tracesPath // .result | tostring' "$OUT/end.json" | head -c 200)"
