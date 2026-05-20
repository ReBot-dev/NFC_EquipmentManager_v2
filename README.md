# NFC Equipment Manager V2

NFC リーダーを使った Web ベースの備品管理システムです。  
Raspberry Pi 等の SBC + NFC リーダーをサーバーとして運用し、ブラウザから貸出・返却・登録を操作します。

> V1（デスクトップ GUI 版）はこちら: [NFC_EquipmentManager](https://github.com/ReBot-dev/NFC_EquipmentManager)

## 概要

社員証と物品に貼った NFC タグをスキャンするだけで、Google スプレッドシートに貸出・返却記録を残せます。  
V1 の後継として GUI をブラウザに移行し、LAN 内の複数端末から同時アクセス可能になりました。

## 機能

- NFC カードの貸出 / 返却登録（社員証 → 物品の順にタッチ、またはその逆）
- 未登録 NFC タグの社員証・物品としての新規登録
- 貸出中一覧 / 返却履歴 / 社員一覧 / 物品一覧の表示
- 不具合報告フォーム
- SSE（Server-Sent Events）による NFC 検知のリアルタイム通知

## ハードウェア構成

| 機器 | 用途 |
|------|------|
| Raspberry Pi / Khadas VIM 等 SBC | サーバー本体 |
| PC/SC 対応 NFC リーダー（例: Sony RC-S380） | NFC タグ読み取り |
| モニター（またはネットワーク経由の PC/スマホ） | ブラウザ操作 |

## システム構成

```
Browser (HTML/JS)
    ↕ HTTP / SSE
FastAPI (main.py)
    ├── NfcReader (nfc_reader.py)  ← pyscard で NFC 読み取り
    └── SheetsManager (sheets.py)  ← gspread で Google Sheets 操作
```

## Google スプレッドシートの準備

スプレッドシート名は `Equipment_Manager`（`backend/config.py` で変更可）。

以下のシートを作成してください：

| シート名 | 列構成 |
|----------|--------|
| 社員マスタ | 氏名 / IDm / メールアドレス |
| 物品マスタ | 物品名 / IDm / 貸出中の社員 / 最終貸出日時 |
| 貸出中一覧 | 申請日時 / 申請者 / 物品名 / 返却予定日 |
| 返却履歴 | 返却日時 / 物品名 / 返却者 / 予定返却日 |
| 不具合報告 | 対応状況 / 報告日時 / 報告者 / 不具合内容 |

Google Cloud Console でサービスアカウントを作成し、スプレッドシートへの編集権限を付与してから JSON キーファイルをダウンロードしてください。

## インストール

```bash
git clone https://github.com/ReBot-dev/NFC_EquipmentManager_V2.git
cd NFC_EquipmentManager_V2

python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn gspread pyscard
```

ダウンロードしたサービスアカウント JSON を `backend/service_account.json` として配置します。

## 設定

`backend/config.py` を環境に合わせて編集します：

```python
CREDENTIALS_FILE = "service_account.json"  # サービスアカウント JSON のパス
SPREADSHEET_NAME = "Equipment_Manager"      # スプレッドシート名
HOST = "0.0.0.0"
PORT = 8000
```

## 起動

```bash
./run.sh
```

ブラウザで `http://localhost:8000` を開きます（LAN 経由では `http://<サーバーのIP>:8000`）。

## systemd サービス（自動起動）

```bash
sudo cp equipment-manager.service /etc/systemd/system/
```

`equipment-manager.service` 内の `WorkingDirectory` と `ExecStart` のパスを自身の環境に合わせて編集してから：

```bash
sudo systemctl daemon-reload
sudo systemctl enable equipment-manager
sudo systemctl start equipment-manager
```

## 依存ライブラリ

| ライブラリ | 用途 |
|------------|------|
| fastapi | Web フレームワーク |
| uvicorn | ASGI サーバー |
| gspread | Google Sheets API クライアント |
| pyscard | PC/SC NFC リーダーインターフェース |
