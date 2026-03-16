"""
FastAPI application for Equipment Manager.

Handles browser requests and delegates to sheets.py for data operations.
NFC card detection is streamed to the browser via SSE (Server-Sent Events).
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

# --- App initialization ---
app = FastAPI()
sheets = SheetsManager(CREDENTIALS_FILE, SPREADSHEET_NAME)
nfc = NfcReader()


@app.on_event("startup")
def startup():
    """Start NFC reader monitoring thread on server startup."""
    nfc.start()


# --- Request models ---

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


# --- SSE endpoint (NFC real-time notification) ---

@app.get("/api/nfc/start")
def nfc_start_listening():
    """Called when browser enters card-waiting screen."""
    nfc.set_listening(True)
    return {"status": "listening"}


@app.get("/api/nfc/stop")
def nfc_stop_listening():
    """Called when browser leaves card-waiting screen."""
    nfc.set_listening(False)
    return {"status": "stopped"}


@app.get("/api/nfc/stream")
async def nfc_stream():
    """SSE endpoint: sends an event each time an NFC card is detected."""
    async def event_generator():
        nfc.set_listening(True)
        try:
            while True:
                try:
                    idm = await asyncio.wait_for(nfc.wait_for_card(), timeout=30.0)
                    yield f"data: {json.dumps({'idm': idm})}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            nfc.set_listening(False)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


# --- GET endpoints ---

@app.get("/api/borrow_list")
def get_borrow_list():
    return sheets.get_borrow_list()


@app.get("/api/return_list")
def get_return_list():
    return sheets.get_return_list()


@app.get("/api/employee_list")
def get_employee_list():
    return sheets.get_employee_list()


@app.get("/api/item_list")
def get_item_list():
    return sheets.get_item_list()


@app.get("/api/bug_list")
def get_bug_list():
    return sheets.get_bug_list()


@app.get("/api/identify/{idm}")
def identify_card(idm: str):
    """Identify an NFC card as employee/item/unknown."""
    return sheets.identify_card(idm)


@app.get("/api/employee/{name}/borrowed")
def get_employee_borrowed(name: str):
    """Get items currently borrowed by an employee."""
    return sheets.get_employee_borrowed_items(name)


@app.get("/api/item/{item_name}/status")
def get_item_status(item_name: str):
    """Check if an item is currently borrowed."""
    result = sheets.is_item_borrowed(item_name)
    if result:
        return {"borrowed": True, **result}
    return {"borrowed": False}


# --- POST endpoints ---

@app.post("/api/register/employee")
def register_employee(data: EmployeeRegister):
    sheets.register_employee(data.idm, data.name, data.email)
    return {"status": "ok", "message": f"{data.name}の登録が完了しました"}


@app.post("/api/register/item")
def register_item(data: ItemRegister):
    sheets.register_item(data.idm, data.item_name)
    return {"status": "ok", "message": f"{data.item_name}の登録が完了しました"}


@app.post("/api/borrow")
def submit_borrow(data: BorrowRequest):
    sheets.submit_borrow(data.employee_name, data.item_name, data.return_date)
    return {
        "status": "ok",
        "message": f"{data.employee_name}が{data.item_name}を借りました（返却予定: {data.return_date}）",
    }


@app.post("/api/return")
def return_item(data: ReturnRequest):
    sheets.return_item(data.item_name, data.borrower, data.scheduled_date)
    return {"status": "ok", "message": f"{data.item_name}の返却が完了しました"}


@app.post("/api/bug_report")
def submit_bug_report(data: BugReport):
    sheets.submit_bug_report(data.reporter, data.description)
    return {"status": "ok", "message": "不具合報告を受け付けました"}


# --- Frontend serving ---

app.mount("/static", StaticFiles(directory="../frontend"), name="static")


@app.get("/")
def serve_frontend():
    return FileResponse("../frontend/index.html")
