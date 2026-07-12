#!/usr/bin/env sh
set -e
mkdir -p "${UPLOAD_DIR:-./uploads}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
