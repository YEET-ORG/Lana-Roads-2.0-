#!/usr/bin/env bash
# Supervise the frontier keeper: it must outlive transient RPC failures,
# because a stopped keeper means the map stops growing for live players.
#
# Restarting on exit is also how a code change reaches a long-lived keeper.
# The keeper deliberately exits on errors it can never recover from (a closed
# program id, an IDL that no longer decodes) so this loop re-execs it against
# the current source. A keeper that swallowed those instead once retried a
# deleted program for five days while looking perfectly healthy.
#
# Usage: REGION=0 MODES=1 scripts/run-keeper.sh
#
# One process per (region, mode). Regions are separate worlds, and modes must
# be separated too: the keeper walks its MODES list in order within one cycle,
# so a paid world spending minutes creating sectors on a throttled RPC starves
# the casual world behind it — which is the one everybody actually plays. Give
# casual its own process and it can never wait on paid.
#
# Each process needs its own KEEPER_HEALTH_PORT.
cd "$(dirname "$0")/.."
export REGION="${REGION:-0}"
export CASUAL_DAY="${CASUAL_DAY:-20713}"
MODE_PORT_OFFSET="${MODES%%,*}"
MODE_PORT_OFFSET="${MODE_PORT_OFFSET:-0}"
export KEEPER_HEALTH_PORT="${KEEPER_HEALTH_PORT:-$((8787 + REGION * 2 + MODE_PORT_OFFSET))}"
echo "$(date -u +%H:%M:%S) keeper region $REGION modes ${MODES:-1}, health :$KEEPER_HEALTH_PORT" >&2
while true; do
  npx tsx scripts/frontier-keeper.ts
  echo "$(date -u +%H:%M:%S) keeper region $REGION modes ${MODES:-1} exited ($?), restarting in 5s" >&2
  sleep 5
done
