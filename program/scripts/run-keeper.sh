#!/usr/bin/env bash
# Supervise the frontier keeper: it must outlive transient RPC failures,
# because a stopped keeper means the map stops growing for live players —
# and, at UTC midnight, a day that never opens for anyone.
#
# Restarting on exit is also how a code change reaches a long-lived keeper.
# The keeper deliberately exits on errors it can never recover from (a closed
# program id, an IDL that no longer decodes) so this loop re-execs it against
# the current source. A keeper that swallowed those instead once retried a
# deleted program for five days while looking perfectly healthy.
#
# Usage: REGION=0 scripts/run-keeper.sh   (each region needs its own process;
# they must not share KEEPER_HEALTH_PORT.)
cd "$(dirname "$0")/.."
export REGION="${REGION:-0}"
export KEEPER_HEALTH_PORT="${KEEPER_HEALTH_PORT:-$((8787 + REGION))}"
echo "$(date -u +%H:%M:%S) keeper region $REGION, health :$KEEPER_HEALTH_PORT" >&2
while true; do
  npx tsx scripts/frontier-keeper.ts
  echo "$(date -u +%H:%M:%S) keeper region $REGION exited ($?), restarting in 5s" >&2
  sleep 5
done
