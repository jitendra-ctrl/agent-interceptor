#!/usr/bin/env bash
# Phase 0 check 2: demo org identity, non-production, API version, Agentforce settings, existing agents.
set -uo pipefail
cd "$(dirname "$0")/.."
source spikes/lib/guard.sh
guard_demo_org
sf org display -o "$ORG_ALIAS" --json 2>/dev/null | jq -c '.result | {username, apiVersion, connectedStatus}'
echo "BotDefinition rows: $(sf data query -o "$ORG_ALIAS" --json -q 'SELECT Id, DeveloperName FROM BotDefinition' 2>/dev/null | jq '.result.totalSize')"
out=spikes/out/settings; rm -rf "$out"; mkdir -p "$out"
sf project retrieve start -o "$ORG_ALIAS" --json --unzip --target-metadata-dir "$out" \
  -m Settings:AgentPlatform -m Settings:EinsteinGpt -m Settings:EinsteinCopilot -m Settings:Bot >/dev/null 2>&1
grep -rhoE '<(enableAgentPlatform|enableEinsteinGptPlatform|enableEinsteinGptCopilot|enableBots)>[a-z]+<' "$out" | tr -d '<' | sed 's/>/ = /'
