"""
FastAPI メインアプリケーション

ブラウザからのリクエストを受け取り、sheets.py に処理を委譲する。
NFCカード検出はSSE（Server-Sent Events）でブラウザにリアルタイム通知する。
"""

import asyncio
import json

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from config import CREDENTIALS_FILE, SPREADSHEET_NAME
from sheets import SheetsManager
from nfc_reader import NfcReader

# --- アプリ初期化 ---
app = FastAPI()
sheets = SheetsManager(CREDENTIALS_FILE, SPREADSHEET_NAME)
nfc = NfcReader()


@app.on_event("startup")
def startup():
    """サーバー起動時にNFCリーダーの監視スレッドを開始する"""
    nfc.start()


# --- リクエストの「型」を定義する（Pydantic モデル） ---

class EmployeeRegister(BaseModel):
    idm: str
    name: str
    email: str

class ItemRegister(BaseModel):
    idm: str
    item_name: str

class BorrowRequest(BaseModel):
    employee_name: str
    item_name: str
    return_date: str

class ReturnRequest(BaseModel):
    item_name: str
    borrower: str
    scheduled_date: str

class BugReport(BaseModel):
    reporter: str
    description: str


# --------------------------------------------------
# SSE エンドポイント（NFC読み取りのリアルタイム通知）
#
# ブラウザ側:
#   const es = new EventSource('/api/nfc/stream');
#   es.onmessage = (e) => { console.log(e.data); };
#
# データの流れ:
#   NFCスレッド → Queue → このエンドポイント → SSE → ブラウザ
# --------------------------------------------------

@app.get("/api/nfc/start")
def nfc_start_listening():
    """ブラウザが「カード待ち画面」に入ったときに呼ぶ"""
    nfc.set_listening(True)
    return {"status": "listening"}


@app.get("/api/nfc/stop")
def nfc_stop_listening():
    """ブラウザが「カード待ち画面」を離れたときに呼ぶ"""
    nfc.set_listening(False)
    return {"status": "stopped"}


@app.get("/api/nfc/stream")
async def nfc_stream():
    """
    SSEエンドポイント: NFCカードが検出されるたびにイベントを送信する。

    SSEのデータ形式:
      data: {"idm": "AB CD EF 12"}\n\n

    「data:」で始まる行がイベントデータ。
    最後に空行2つ(\n\n)で1イベントの終わりを示す。
    これはSSEの仕様（RFC）で決まっているフォーマット。
    """
    async def event_generator():
        nfc.set_listening(True)
        try:
            while True:
                try:
                    # 最大30秒待つ。タイムアウトしたらキープアライブを送る
                    idm = await asyncio.wait_for(nfc.wait_for_card(), timeout=30.0)
                    yield f"data: {json.dumps({'idm': idm})}\n\n"
                except asyncio.TimeoutError:
                    # キープアライブ（接続が切れていないか確認）
                    # コロン始まりはSSEのコメント（ブラウザは無視する）
                    yield ": keepalive\n\n"
        finally:
            nfc.set_listening(False)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",    # キャッシュしない
            "Connection": "keep-alive",      # 接続を維持する
        },
    )


# --------------------------------------------------
# GET エンドポイント（データ取得）
# --------------------------------------------------

@app.get("/api/borrow_list")
def get_borrow_list():
    """貸出中一覧を返す"""
    return sheets.get_borrow_list()


@app.get("/api/return_list")
def get_return_list():
    """返却履歴を返す"""
    return sheets.get_return_list()


@app.get("/api/employee_list")
def get_employee_list():
    """社員一覧を返す"""
    return sheets.get_employee_list()


@app.get("/api/item_list")
def get_item_list():
    """物品一覧を返す"""
    return sheets.get_item_list()


@app.get("/api/bug_list")
def get_bug_list():
    """不具合報告一覧を返す"""
    return sheets.get_bug_list()


@app.get("/api/identify/{idm}")
def identify_card(idm: str):
    """NFCカードのIDmから社員/物品を判定する"""
    return sheets.identify_card(idm)


@app.get("/api/employee/{name}/borrowed")
def get_employee_borrowed(name: str):
    """指定社員が現在借りている物品一覧"""
    return sheets.get_employee_borrowed_items(name)


@app.get("/api/item/{item_name}/status")
def get_item_status(item_name: str):
    """物品の貸出状態を確認する"""
    result = sheets.is_item_borrowed(item_name)
    if result:
        return {"borrowed": True, **result}
    return {"borrowed": False}


# --------------------------------------------------
# POST エンドポイント（データ書き込み）
# --------------------------------------------------

@app.post("/api/register/employee")
def register_employee(data: EmployeeRegister):
    """新しい社員を登録する"""
    sheets.register_employee(data.idm, data.name, data.email)
    return {"status": "ok", "message": f"{data.name}の登録が完了しました"}


@app.post("/api/register/item")
def register_item(data: ItemRegister):
    """新しい物品を登録する"""
    sheets.register_item(data.idm, data.item_name)
    return {"status": "ok", "message": f"{data.item_name}の登録が完了しました"}


@app.post("/api/borrow")
def submit_borrow(data: BorrowRequest):
    """貸出を記録する"""
    sheets.submit_borrow(data.employee_name, data.item_name, data.return_date)
    return {
        "status": "ok",
        "message": f"{data.employee_name}が{data.item_name}を借りました（返却予定: {data.return_date}）",
    }


@app.post("/api/return")
def return_item(data: ReturnRequest):
    """返却を処理する"""
    sheets.return_item(data.item_name, data.borrower, data.scheduled_date)
    return {"status": "ok", "message": f"{data.item_name}の返却が完了しました"}


@app.post("/api/bug_report")
def submit_bug_report(data: BugReport):
    """不具合報告を送信する"""
    sheets.submit_bug_report(data.reporter, data.description)
    return {"status": "ok", "message": "不具合報告を受け付けました"}


# --------------------------------------------------
# フロントエンド配信
# --------------------------------------------------

app.mount("/static", StaticFiles(directory="../frontend"), name="static")


@app.get("/")
def serve_frontend():
    """トップページ（index.html）を返す"""
    return FileResponse("../frontend/index.html")
