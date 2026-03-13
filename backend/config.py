"""
設定ファイル

ハードコードされていた値をここに集約する。
VIM4にデプロイするときはここだけ変えればよい。
"""

# Google Sheets 設定
CREDENTIALS_FILE = "service_account.json"
SPREADSHEET_NAME = "Equipment_Manager"

# サーバー設定
HOST = "0.0.0.0"
PORT = 8000
