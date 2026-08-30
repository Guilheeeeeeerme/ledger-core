#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
BASE="http://localhost:${PORT}"

fail() {
  echo "$1" >&2
  exit 1
}

parse_json_field() {
  local field="$1"
  node -e '
    let data = "";
    process.stdin.on("data", chunk => { data += chunk; });
    process.stdin.on("end", () => {
      const parsed = JSON.parse(data);
      const key = process.argv[1];
      process.stdout.write(parsed[key] == null ? "" : String(parsed[key]));
    });
  ' "${field}"
}

health="$(curl -fsS "${BASE}/api/health")" || fail "health check failed on ${BASE}"
health_status="$(printf '%s' "${health}" | parse_json_field status)"
[ "${health_status}" = "ok" ] || fail "health status is not ok"

curl -fsS "${BASE}/api/accounts" >/dev/null || fail "accounts request failed"

transaction_id="$(node -e "console.log(require('crypto').randomUUID())")"

curl -fsS -X POST "${BASE}/api/transactions" \
  -H 'content-type: application/json' \
  -d "{\"transactionId\":\"${transaction_id}\",\"sourceAccountId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"destinationAccountId\":\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\",\"amount\":2500,\"currency\":\"BRL\"}" \
  >/dev/null || fail "transfer POST failed"

for _ in $(seq 1 20); do
  body="$(curl -fsS "${BASE}/api/transactions/${transaction_id}")" || fail "transaction poll failed"
  status="$(printf '%s' "${body}" | parse_json_field status)"
  if [ "${status}" = "completed" ]; then
    exit 0
  fi
  if [ "${status}" = "failed" ]; then
    fail "transfer ${transaction_id} failed"
  fi
  sleep 0.5
done

fail "transfer ${transaction_id} did not complete"
