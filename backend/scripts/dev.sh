#!/usr/bin/env bash
# Start the API against real FastF1 data.
#   ./scripts/dev.sh            real data
#   GP_USE_FIXTURES=1 ./scripts/dev.sh   synthetic data
set -euo pipefail
cd "$(dirname "$0")/.."
export GP_USE_FIXTURES="${GP_USE_FIXTURES:-0}"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
