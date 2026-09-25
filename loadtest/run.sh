#!/usr/bin/env bash
# Menjalankan satu skenario k6 terhadap stack Docker Compose (profil app harus sudah hidup).
#
#   ./loadtest/run.sh <skenario> [NAMA=nilai ...]
#
# Contoh:
#   ./loadtest/run.sh spike-join VUS=1000
#   ./loadtest/run.sh oversubscribe USERS=20000 VUS=2000
#
# Hasil ringkas tersimpan di loadtest/results/<n>-<skenario>.json; metrik k6 juga dikirim ke Prometheus
# sehingga tampil di dashboard Grafana (http://localhost:3001) berdampingan dengan metrik server.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "pemakaian: $0 <no-queue|spike-join|e2e-queue|oversubscribe|bot-attack|soak> [NAMA=nilai ...]" >&2
  exit 1
fi

scenario="$1"
shift

env_args=()
for pair in "$@"; do
  env_args+=("-e" "$pair")
done

cd "$(dirname "$0")/../infra"

# MSYS_NO_PATHCONV: di Git Bash (Windows), cegah /scripts diubah menjadi path Windows.
MSYS_NO_PATHCONV=1 docker compose --env-file loadtest.env --profile app --profile loadtest run --rm --no-deps \
  -e MACHINE="${MACHINE:-unknown}" "${env_args[@]}" \
  k6 run -o experimental-prometheus-rw "/scripts/scenarios/${scenario}.js"
