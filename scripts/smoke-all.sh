#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

for port in 3000 3001 3002 3003 3004 3005; do
  echo "smoke PORT=${port}"
  PORT="${port}" "${ROOT}/smoke.sh"
done
