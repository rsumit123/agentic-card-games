#!/usr/bin/env bash
set -euo pipefail
API=${1:?api origin, e.g. https://api.example.com}; PLAY=${2:?frontend origin, e.g. https://play.example.com}
curl -fsS "$API/healthz" >/dev/null && echo "healthz ok"
curl -fsS -o /dev/null -D - -X OPTIONS "$API/tables" -H "Origin: $PLAY" -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-csrf-token" | grep -i "access-control-allow-origin: $PLAY" && echo "cors ok"
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/auth/me"); [ "$code" = "401" ] && echo "auth/me anonymous ok"
