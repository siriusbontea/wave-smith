#!/usr/bin/env bash
# scripts/smoke.sh — end-to-end against the REAL engine (spec §12 M7).
# Requires: engine running on ENGINE_URL, models downloaded, ffmpeg present.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then set -a; source .env; set +a; fi

ENGINE_URL="${ENGINE_URL:-http://127.0.0.1:8001}"
PORT="${PORT:-3000}"
APP="http://127.0.0.1:${PORT}"

echo "==> Health (engine)"
curl -sf "${ENGINE_URL}/health" >/dev/null || { echo "Engine not reachable at ${ENGINE_URL}"; exit 1; }

echo "==> Start app (production)"
pnpm build
MOCK_ENGINE=0 pnpm start --hostname 127.0.0.1 --port "$PORT" &
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null || true' EXIT

for i in $(seq 1 60); do
  if curl -sf "${APP}/api/health" | grep -q '"app":"ok"'; then break; fi
  sleep 1
done
curl -sf "${APP}/api/health" >/dev/null || { echo "App health failed"; exit 1; }

echo "==> Forge (short generation)"
JOB=$(curl -sf -X POST "${APP}/api/generate" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"smoke test jingle","variations":1,"durationS":15}' )
JOB_ID=$(echo "$JOB" | python3 -c 'import sys,json; print(json.load(sys.stdin)["jobId"])')

echo "==> Poll job"
for i in $(seq 1 900); do
  STATUS=$(curl -sf "${APP}/api/jobs" | python3 -c "
import sys,json
jobs=json.load(sys.stdin)['jobs']
j=next(x for x in jobs if x['id']=='${JOB_ID}')
print(j['status'])
")
  if [[ "$STATUS" == "succeeded" || "$STATUS" == "failed" ]]; then break; fi
  sleep 1
done
[[ "$STATUS" == "succeeded" ]] || { echo "Job failed: $STATUS"; exit 1; }

SONG_ID=$(curl -sf "${APP}/api/jobs" | python3 -c "
import sys,json
jobs=json.load(sys.stdin)['jobs']
j=next(x for x in jobs if x['id']=='${JOB_ID}')
print(j['result']['songIds'][0])
")

echo "==> Audio Range 206"
curl -sf -H 'Range: bytes=0-99' -o /dev/null -w '%{http_code}\n' "${APP}/api/audio/${SONG_ID}/take.wav" | grep -q 206 || {
  # mp3 master from mock-less real engine may be wav — list songs for path
  PATH_REL=$(curl -sf "${APP}/api/songs/${SONG_ID}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["audioPath"])')
  CODE=$(curl -sf -H 'Range: bytes=0-99' -o /dev/null -w '%{http_code}' "${APP}/api/audio/${PATH_REL}")
  [[ "$CODE" == "206" ]] || { echo "Range failed: $CODE"; exit 1; }
}

echo "✅ smoke.sh passed"
