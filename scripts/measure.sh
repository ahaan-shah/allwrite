#!/bin/bash
# Total PSS (memory actually used) of a running allwrite and its WebKit processes.
# Usage: scripts/measure.sh [pid]
pid=${1:-$(pgrep -x allwrite | head -1)}
[ -z "$pid" ] && { echo "allwrite is not running"; exit 1; }
pids="$pid"
frontier="$pid"
while [ -n "$frontier" ]; do
  next=""
  for p in $frontier; do next="$next $(pgrep -P "$p" | tr '\n' ' ')"; done
  frontier=$(echo $next)
  pids="$pids $frontier"
done
for p in $pids; do
  [ -r "/proc/$p/smaps_rollup" ] || continue
  awk -v name="$(cat /proc/$p/comm)" '/^Pss:/{printf "%-22s %7.1f MB\n", name, $2/1024; print $2 > "/dev/stderr"}' "/proc/$p/smaps_rollup"
done 2> >(awk '{t+=$1} END{printf "%-22s %7.1f MB\n", "TOTAL", t/1024}')
sleep 0.1
