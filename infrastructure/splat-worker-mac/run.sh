#!/usr/bin/env bash
#
# Run the native macOS Brush splat worker. Loads ./.env, then execs the
# worker inside the local venv. Designed to be the launchd ProgramArguments
# target as well as a manual `./run.sh`.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ ! -x .venv/bin/python ]; then
  echo "venv missing — run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

exec .venv/bin/python worker.py
