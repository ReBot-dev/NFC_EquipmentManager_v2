# NFC Equipment Manager V2

NFC リーダーを使った Web ベースの備品管理システムです。  
Raspberry Pi 等の SBC + NFC リーダーをサーバーとして運用し、ブラウザから貸出・返却・登録を操作します。

A web-based equipment management system using an NFC reader.  
Runs on an SBC (e.g. Raspberry Pi) with an NFC reader as the server, operated from a browser.

> V1（デスクトップ GUI 版 / Desktop GUI version）: [NFC_EquipmentManager](https://github.com/ReBot-dev/NFC_EquipmentManager)

---

## 概要 / Overview

社員証と物品に貼った NFC タグをスキャンするだけで、Google スプレッドシートに貸出・返却記録を残せます。  
V1 の後継として GUI をブラウザに移行し、LAN 内の複数端末から同時アクセス可能になりました。

Scan NFC tags on employee ID cards and items to record borrowing and returns in Google Sheets.  
As the successor to V1, the GUI has moved to a browser, enabling simultaneous access from multiple devices on the LAN.

---

## 機能 / Features

- NFC カードの貸出 / 返却登録（社員証 → 物品の順にタッチ、またはその逆）
- 未登録 NFC タグの社員証・物品としての新規登録
- 貸出中一覧 / 返却履歴 / 社員一覧 / 物品一覧の表示
- 不具合報告フォーム
- SSE（Server-Sent Events）による NFC 検知のリアルタイム通知

---

- Borrow / return registration via NFC (touch employee card → item, or vice versa)
- New registration of unregistered NFC tags as employee cards or items
- View current borrow list / return history / employee list / item list
- Bug report form
- Real-time NFC detection via SSE (Server-Sent Events)

---

## ハードウェア構成 / Hardware

| 機器 / Device | 用途 / Purpose |
|---|---|
| Raspberry Pi / Khadas VIM 等 SBC | サーバー本体 / Server |
| PC/SC 対応 NFC リーダー（例: Sony RC-S380） | NFC タグ読み取り / NFC tag reading |
| モニター（または LAN 経由の PC / スマホ） | ブラウザ操作 / Browser access |

---

## システム構成 / Architecture

```
Browser (HTML/JS)
    ↕ HTTP / SSE
FastAPI (main.py)
    ├── NfcReader (nfc_reader.py)  ← pyscard で NFC 読み取り / NFC reading
    └── SheetsManager (sheets.py)  ← gspread で Google Sheets 操作 / Sheets access
```

---

## Google スプレッドシートの準備 / Google Sheets Setup

スプレッドシート名は `Equipment_Manager`（`backend/config.py` で変更可）。  
Spreadsheet name: `Equipment_Manager` (configurable in `backend/config.py`).

以下のシートを作成してください / Create the following sheets:

| シート名 / Sheet | 列構成 / Columns |
|---|---|
| 社員マスタ | 氏名 / IDm / メールアドレス |
| 物品マスタ | 物品名 / IDm / 貸出中の社員 / 最終貸出日時 |
| 貸出中一覧 | 申請日時 / 申請者 / 物品名 / 返却予定日 |
| 返却履歴 | 返却日時 / 物品名 / 返却者 / 予定返却日 |
| 不具合報告 | 対応状況 / 報告日時 / 報告者 / 不具合内容 |

Google Cloud Console でサービスアカウントを作成し、スプレッドシートへの編集権限を付与してから JSON キーファイルをダウンロードしてください。  
Create a service account on Google Cloud Console, grant it edit access to the spreadsheet, and download the JSON key file.

---

## インストール / Installation

```bash
git clone https://github.com/ReBot-dev/NFC_EquipmentManager_V2.git
cd NFC_EquipmentManager_V2

python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn gspread pyscard
```

ダウンロードしたサービスアカウント JSON を `backend/service_account.json` として配置します。  
Place the service account JSON as `backend/service_account.json`.

---

## 設定 / Configuration

`backend/config.py` を環境に合わせて編集します / Edit `backend/config.py` for your environment:

```python
CREDENTIALS_FILE = "service_account.json"  # サービスアカウント JSON のパス / path
SPREADSHEET_NAME = "Equipment_Manager"      # スプレッドシート名 / spreadsheet name
HOST = "0.0.0.0"
PORT = 8000
```

---

## 起動 / Usage

```bash
./run.sh
```

ブラウザで `http://localhost:8000` を開きます（LAN 経由では `http://<サーバーのIP>:8000`）。  
Open `http://localhost:8000` in a browser (or `http://<server IP>:8000` over LAN).

---

## systemd サービス（自動起動）/ systemd Service (Auto-start)

```bash
sudo cp equipment-manager.service /etc/systemd/system/
```

`equipment-manager.service` 内の `WorkingDirectory` と `ExecStart` のパスを自身の環境に合わせて編集してから：  
Edit the `WorkingDirectory` and `ExecStart` paths in `equipment-manager.service` to match your environment, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable equipment-manager
sudo systemctl start equipment-manager
```

---

## 依存ライブラリ / Dependencies

| ライブラリ / Library | 用途 / Purpose |
|---|---|
| fastapi | Web フレームワーク / framework |
| uvicorn | ASGI サーバー / server |
| gspread | Google Sheets API クライアント / client |
| pyscard | PC/SC NFC リーダー / reader interface |

---

## ライセンス / License

MIT License
