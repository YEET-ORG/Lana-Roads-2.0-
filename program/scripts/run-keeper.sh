#!/usr/bin/env bash
# Supervise the frontier keeper: it must outlive transient RPC failures,
# because a stopped keeper means the map stops growing for live players.
cd "$(dirname "$0")/.."
while true; do
  npx tsx scripts/frontier-keeper.ts
  echo "$(date -u +%H:%M:%S) keeper exited ($?), restarting in 5s" >&2
  sleep 5
done
