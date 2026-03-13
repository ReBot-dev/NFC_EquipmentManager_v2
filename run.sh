#!/bin/bash

# Equipment Manager 起動スクリプト
# 使い方: ./run.sh

# このスクリプトがあるフォルダに移動
cd "$(dirname "$0")"

# 仮想環境を有効化
source /home/khadas/venv/bin/activate

# バックエンドフォルダに移動して起動
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
