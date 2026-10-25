#!/usr/bin/env bash
# Agentia local quality gate (run by `agentia cicd work test --local` and before
# `agentia cicd work submit`): Agent Interceptor checks, in the org, that every agent
# action affected by this change still does what the agent claims.
#   exit 0 verified / nothing affected, 1 intercepted, 2 inconclusive, 3 config or usage error
# Options as environment variables (pass with `agentia cicd work test -e NAME=value`):
#   INTERCEPTOR_BASE      git ref to diff against (default: HEAD = uncommitted changes)
#   INTERCEPTOR_VERIFIER  crt (default, from config) or local (dev loop, labelled "not CRT")
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
CLI="$ROOT/interceptor/dist/src/cli.js"
if [[ ! -f "$CLI" ]]; then
  echo "Agent Interceptor is not built: run (cd interceptor && npm ci && npm run build)" >&2
  exit 3
fi
ARGS=(gate --base "${INTERCEPTOR_BASE:-HEAD}")
[[ -n "${INTERCEPTOR_VERIFIER:-}" ]] && ARGS+=(--verifier "$INTERCEPTOR_VERIFIER")
node "$CLI" "${ARGS[@]}"
