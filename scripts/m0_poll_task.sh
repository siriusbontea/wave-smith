#!/usr/bin/env bash
# M0 helper: poll one engine task to terminal state, print progress transitions.
# Usage: m0_poll_task.sh <task_id> [timeout_s]
# Exits 0 on success (status 1), 1 on failure (status 2), 2 on timeout.
set -euo pipefail
TASK_ID="$1"
TIMEOUT="${2:-900}"
BASE="http://127.0.0.1:8001"
START=$(date +%s)
LAST=""
while true; do
  NOW=$(date +%s); ELAPSED=$((NOW - START))
  if (( ELAPSED > TIMEOUT )); then echo "TIMEOUT after ${ELAPSED}s"; exit 2; fi
  RESP=$(curl -sf -X POST "$BASE/query_result" -H 'Content-Type: application/json' \
    -d "{\"task_id_list\": [\"$TASK_ID\"]}")
  STATUS=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data'][0]['status'])")
  PROG=$(echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data'][0]
r = json.loads(d['result']) if d['result'] else []
if r and isinstance(r, list):
    el = r[0]
    print(f\"progress={el.get('progress','?')} stage={el.get('stage','?')}\")
else:
    print('no-result-yet')
")
  LINE="[${ELAPSED}s] status=$STATUS $PROG"
  if [[ "$LINE" != "$LAST" ]]; then echo "$LINE"; LAST="$LINE"; fi
  if [[ "$STATUS" == "1" ]]; then echo "$RESP" > /tmp/m0_last_result.json; echo "SUCCEEDED in ${ELAPSED}s (full result: /tmp/m0_last_result.json)"; exit 0; fi
  if [[ "$STATUS" == "2" ]]; then echo "$RESP" > /tmp/m0_last_result.json; echo "FAILED after ${ELAPSED}s (full result: /tmp/m0_last_result.json)"; exit 1; fi
  sleep 1
done
