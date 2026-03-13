"""
Google Sheets 操作モジュール

スプレッドシートの読み書きだけを担当する。
GUI表示やNFC読み取りには一切関与しない。
"""

import gspread
from datetime import datetime


class SheetsManager:
    """
    Google Sheets との全やりとりをまとめたクラス。

    なぜクラスにするのか？
    - spreadsheet オブジェクト（接続情報）を1箇所で保持できる
    - 現行コードのようにグローバル変数に頼らなくて済む
    - テスト時にモック（偽物）に差し替えやすい
    """

    def __init__(self, credentials_file: str, spreadsheet_name: str):
        """
        初期化：Google Sheets に接続する。

        Args:
            credentials_file: サービスアカウントJSONファイルのパス
            spreadsheet_name: スプレッドシートの名前
        """
        gc = gspread.service_account(filename=credentials_file)
        self.spreadsheet = gc.open(spreadsheet_name)

    # --------------------------------------------------
    # データ取得系（GET系APIから呼ばれる）
    # --------------------------------------------------

    def get_all_ids(self) -> dict:
        """社員・物品の全IDと名前を取得する"""
        emp_sheet = self.spreadsheet.worksheet("社員マスタ")
        item_sheet = self.spreadsheet.worksheet("物品マスタ")

        return {
            "employee_ids": emp_sheet.col_values(2)[1:],
            "employee_names": emp_sheet.col_values(1)[1:],
            "item_ids": item_sheet.col_values(2)[1:],
            "item_names": item_sheet.col_values(1)[1:],
        }

    def get_borrow_list(self) -> list[list[str]]:
        """貸出中一覧を取得（新しい順）"""
        ws = self.spreadsheet.worksheet("貸出中一覧")
        data = ws.get_all_values()
        if len(data) <= 1:
            return []
        rows = data[1:]
        rows.reverse()
        return rows

    def get_return_list(self) -> list[list[str]]:
        """返却履歴を取得（新しい順）"""
        ws = self.spreadsheet.worksheet("返却履歴")
        data = ws.get_all_values()
        if len(data) <= 1:
            return []
        rows = data[1:]
        rows.reverse()
        return rows

    def get_employee_list(self) -> list[list[str]]:
        """社員一覧を取得（氏名, メール）"""
        ws = self.spreadsheet.worksheet("社員マスタ")
        data = ws.get_all_values()
        if len(data) <= 1:
            return []
        return [[row[0], row[2]] for row in data[1:]]

    def get_item_list(self) -> list[list[str]]:
        """物品一覧を取得（物品名, 貸出者, 最終貸出日時）"""
        ws = self.spreadsheet.worksheet("物品マスタ")
        data = ws.get_all_values()
        if len(data) <= 1:
            return []
        return [[row[0], row[2], row[3]] for row in data[1:]]

    def get_bug_list(self) -> list[list[str]]:
        """不具合報告一覧を取得（新しい順）"""
        ws = self.spreadsheet.worksheet("不具合報告")
        data = ws.get_all_values()
        if len(data) <= 1:
            return []
        rows = data[1:]
        rows.reverse()
        return rows

    # --------------------------------------------------
    # ID照合系（NFC読み取り後に呼ばれる）
    # --------------------------------------------------

    def identify_card(self, idm: str) -> dict:
        """
        NFCカードのIDmから、社員か物品かを判定する。

        Returns:
            {"type": "employee", "name": "田中太郎"} or
            {"type": "item", "name": "プロジェクター"} or
            {"type": "unknown"}
        """
        ids = self.get_all_ids()

        if idm in ids["employee_ids"]:
            idx = ids["employee_ids"].index(idm)
            return {"type": "employee", "name": ids["employee_names"][idx]}

        if idm in ids["item_ids"]:
            idx = ids["item_ids"].index(idm)
            return {"type": "item", "name": ids["item_names"][idx]}

        return {"type": "unknown"}

    def get_employee_borrowed_items(self, employee_name: str) -> list[dict]:
        """指定された社員が現在借りている物品の一覧"""
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
        """
        物品が貸出中かどうかを確認する。

        Returns:
            貸出中なら {"borrower": "...", "return_date": "..."}, そうでなければ None
        """
        ws = self.spreadsheet.worksheet("貸出中一覧")
        all_data = ws.get_all_records()
        for row in all_data:
            if row["物品名"] == item_name:
                return {
                    "borrower": row.get("申請者", ""),
                    "return_date": row.get("返却予定日", ""),
                }
        return None

    # --------------------------------------------------
    # 書き込み系（POST系APIから呼ばれる）
    # --------------------------------------------------

    def register_employee(self, idm: str, name: str, email: str):
        """新しい社員を登録する"""
        ws = self.spreadsheet.worksheet("社員マスタ")
        ws.append_row([name, idm, email])

    def register_item(self, idm: str, item_name: str):
        """新しい物品を登録する"""
        ws = self.spreadsheet.worksheet("物品マスタ")
        ws.append_row([item_name, idm])

    def submit_borrow(self, employee_name: str, item_name: str, return_date: str):
        """貸出を記録する（貸出中一覧に追加 + 物品マスタを更新）"""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # 貸出中一覧に追加
        ws = self.spreadsheet.worksheet("貸出中一覧")
        ws.append_row([now, employee_name, item_name, return_date])

        # 物品マスタの貸出者と日時を更新
        ws_master = self.spreadsheet.worksheet("物品マスタ")
        cell = ws_master.find(item_name, in_column=1)
        if cell:
            ws_master.update_cell(cell.row, 3, employee_name)
            ws_master.update_cell(cell.row, 4, now)

    def return_item(self, item_name: str, borrower: str, scheduled_date: str):
        """返却を処理する（履歴に追加 + 貸出中一覧から削除）"""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # 返却履歴に追加
        ws_history = self.spreadsheet.worksheet("返却履歴")
        ws_history.append_row([now, item_name, borrower, scheduled_date])

        # 貸出中一覧から削除
        ws = self.spreadsheet.worksheet("貸出中一覧")
        cell = ws.find(item_name, in_column=3)
        if cell:
            ws.delete_rows(cell.row)

    def submit_bug_report(self, reporter: str, description: str):
        """不具合報告を記録する"""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ws = self.spreadsheet.worksheet("不具合報告")
        ws.append_row(["未対応", now, reporter, description])
