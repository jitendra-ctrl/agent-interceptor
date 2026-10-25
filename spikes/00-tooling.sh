#!/usr/bin/env bash
# Phase 0 check 1: tooling versions and command availability.
set -uo pipefail
cd "$(dirname "$0")/.."
pass=true
node_major=$(node --version | sed 's/^v//; s/\..*//')
echo "node $(node --version)"; (( node_major >= 18 )) || pass=false
sf --version 2>/dev/null | grep -v 'update available'
agent_plugin=$(sf plugins --json 2>/dev/null | jq -r '(if type=="array" then . else .result end)[] | select(.name=="@salesforce/plugin-agent") | .version')
echo "plugin-agent ${agent_plugin:-MISSING}"; [[ -n "$agent_plugin" ]] || pass=false
for c in "agent preview start" "agent preview send" "agent preview end" "agent trace read" "agent validate authoring-bundle"; do
  if sf ${c} --help >/dev/null 2>&1; then echo "ok: sf $c"; else echo "MISSING: sf $c"; pass=false; fi
done
if command -v agentia >/dev/null; then echo "agentia $(agentia --version)"; else echo "agentia MISSING"; pass=false; fi
$pass && echo "RESULT: PASS" || echo "RESULT: FAIL"
