#!/usr/bin/env bash
# Server-side deploy helper for a future demo host. Not run by anything today.
#   ./deploy.sh <registry/image@sha256:digest>   back up, deploy a pinned image, roll back if unhealthy
#   ./deploy.sh --rollback                        return to the previously deployed image
# Expects compose.yaml, compose.prod.yaml and .env next to it. Data lives in the `data` volume; every deploy
# takes an online SQLite backup first, and migrations only add tables or columns (docs/DEPLOYMENT.md).
set -euo pipefail
cd "$(dirname "$0")"

history_file=.deploy-history
compose=(docker compose -f compose.yaml -f compose.prod.yaml)

current_image() { tail -n 1 "$history_file" 2>/dev/null || true; }

start() {
  local image="$1"
  IMAGE="$image" "${compose[@]}" pull app
  IMAGE="$image" "${compose[@]}" up -d --wait --wait-timeout 90 app demo-api
}

backup() {
  if "${compose[@]}" ps --status running app | grep -q app; then
    "${compose[@]}" exec -T app /nodejs/bin/node dist/cli.js backup
  fi
}

if [[ "${1:-}" == "--rollback" ]]; then
  previous=$(tail -n 2 "$history_file" | head -n 1)
  [[ -n "$previous" ]] || { echo "no previous image recorded" >&2; exit 1; }
  backup
  start "$previous"
  echo "$previous" >> "$history_file"
  echo "rolled back to $previous"
  exit 0
fi

image="${1:?usage: deploy.sh <image@digest> | --rollback}"
[[ "$image" == *@sha256:* ]] || { echo "refusing to deploy an unpinned image: $image" >&2; exit 1; }

previous=$(current_image)
backup
if start "$image"; then
  echo "$image" >> "$history_file"
  echo "deployed $image"
else
  echo "new image unhealthy, restoring ${previous:-nothing}" >&2
  [[ -n "$previous" ]] && start "$previous"
  exit 1
fi
