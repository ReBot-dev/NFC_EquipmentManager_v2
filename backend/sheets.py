"""Google Sheets operations module."""

import gspread
from datetime import datetime


class SheetsManager:
    """Manages all interactions with Google Sheets."""

    def __init__(self, credentials_file: str, spreadsheet_name: str):
        gc = gspread.service_account(filename=credentials_file)
        self.spreadsheet = gc.open(spreadsheet_name)

    # --- Read operations ---

    def get_all_ids(self) -> dict:
        """Get all employee/item IDs and names."""
        emp_sheet = self.spreadsheet.worksheet("社員マスタ")
        item_sheet = self.spreadsheet.worksheet("物品マスタ")

        return {
            "employee_ids": emp_sheet.col_values(2)[1:],
            "employee_names": emp_sheet.col_values(1)[1:],
            "item_ids": item_sheet.col_values(2)[1:],
            "item_names": item_sheet.col_values(1)[1:],
        }

    def get_borrow_list(self) -> list[list[str]]:
        """Get active borrow list (newest first)."""
        ws = self.spreadsheet.worksheet("貸出中一覧")
        data = ws.get_all_values()
        if len(data) <= 1:
            return []
        rows = data[1:]
        rows.reverse()
        return rows

    def get_return_list(self) -> list[list[str]]:
        """Get return history (newest first)."""
        ws = self.spreadsheet.worksheet("返却履歴")
        data = ws.get_all_values()
        if len(data) <= 1:
            return []
        rows = data[1:]
        rows.reverse()
        return rows

    def get_employee_list(self) -> list[list[str]]:
        """Get employee list (name, email)."""
        ws = self.spreadsheet.worksheet("社員マスタ")
        data = ws.get_all_values()
        if len(data) <= 1:
            return []
        return [[row[0], row[2]] for row in data[1:]]

    def get_item_list(self) -> list[list[str]]:
        """Get item list (name, borrower, last borrow date)."""
        ws = self.spreadsheet.worksheet("物品マスタ")
        data = ws.get_all_values()
        if len(data) <= 1:
            return []
        return [[row[0], row[2], row[3]] for row in data[1:]]

    def get_bug_list(self) -> list[list[str]]:
        """Get bug report list (newest first)."""
        ws = self.spreadsheet.worksheet("不具合報告")
        data = ws.get_all_values()
        if len(data) <= 1:
            return []
        rows = data[1:]
        rows.reverse()
        return rows

    # --- Card identification ---

    def identify_card(self, idm: str) -> dict:
        """Identify an NFC card as employee, item, or unknown."""
        ids = self.get_all_ids()

        if idm in ids["employee_ids"]:
            idx = ids["employee_ids"].index(idm)
            return {"type": "employee", "name": ids["employee_names"][idx]}

        if idm in ids["item_ids"]:
            idx = ids["item_ids"].index(idm)
            return {"type": "item", "name": ids["item_names"][idx]}

        return {"type": "unknown"}

    def get_employee_borrowed_items(self, employee_name: str) -> list[dict]:
        """Get items currently borrowed by an employee."""
        ws = self.spreadsheet.worksheet("貸出中一覧")
        all_data = ws.get_all_records()
        return [
            {
                "item_name": row.get("物品名", ""),
                "return_date": row.get("返却予定日", ""),
            }
            for row in all_data
            if row.get("申請者", "") == employee_name
        ]

    def is_item_borrowed(self, item_name: str) -> dict | None:
        """Check if an item is currently borrowed. Returns borrow info or None."""
        ws = self.spreadsheet.worksheet("貸出中一覧")
        all_data = ws.get_all_records()
        for row in all_data:
            if row["物品名"] == item_name:
                return {
                    "borrower": row.get("申請者", ""),
                    "return_date": row.get("返却予定日", ""),
                }
        return None

    # --- Write operations ---

    def register_employee(self, idm: str, name: str, email: str):
        """Register a new employee."""
        ws = self.spreadsheet.worksheet("社員マスタ")
        ws.append_row([name, idm, email])

    def register_item(self, idm: str, item_name: str):
        """Register a new item."""
        ws = self.spreadsheet.worksheet("物品マスタ")
        ws.append_row([item_name, idm])

    def submit_borrow(self, employee_name: str, item_name: str, return_date: str):
        """Record a borrow (add to borrow list + update item master)."""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        ws = self.spreadsheet.worksheet("貸出中一覧")
        ws.append_row([now, employee_name, item_name, return_date])

        ws_master = self.spreadsheet.worksheet("物品マスタ")
        cell = ws_master.find(item_name, in_column=1)
        if cell:
            ws_master.update_cell(cell.row, 3, employee_name)
            ws_master.update_cell(cell.row, 4, now)

    def return_item(self, item_name: str, borrower: str, scheduled_date: str):
        """Process a return (add to history + remove from borrow list)."""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        ws_history = self.spreadsheet.worksheet("返却履歴")
        ws_history.append_row([now, item_name, borrower, scheduled_date])

        ws = self.spreadsheet.worksheet("貸出中一覧")
        cell = ws.find(item_name, in_column=3)
        if cell:
            ws.delete_rows(cell.row)

    def submit_bug_report(self, reporter: str, description: str):
        """Submit a bug report."""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ws = self.spreadsheet.worksheet("不具合報告")
        ws.append_row(["未対応", now, reporter, description])
