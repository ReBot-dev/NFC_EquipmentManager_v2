#!/bin/bash

# Start the Equipment Manager server.
# Usage: ./run.sh
#
# Requires a Python virtual environment at ./venv with fastapi, uvicorn, etc.
# Create one with: python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

source "$SCRIPT_DIR/venv/bin/activate"

cd "$SCRIPT_DIR/backend"
python -m uvicorn main:app --host 0.0.0.0 --port 8000
