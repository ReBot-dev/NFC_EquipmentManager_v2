"""
NFC リーダー監視モジュール

別スレッドでNFCカードリーダーを常時ポーリングし、
カードが検出されたら asyncio.Queue に結果を入れる。

メインスレッド（FastAPI）は Queue からイベントを取り出して
SSE でブラウザに送信する。

構造:
    [NFCスレッド] → Queue → [FastAPIのSSEエンドポイント] → ブラウザ
"""

import asyncio
import threading
import time

from smartcard.System import readers
from smartcard.util import toHexString


class NfcReader:
    """
    NFCカードリーダーを監視するクラス。

    使い方:
        reader = NfcReader()
        reader.start()          # 監視開始（別スレッド）
        idm = await reader.wait_for_card()  # カードが来るまで待つ
        reader.stop()           # 監視停止
    """

    def __init__(self):
        # asyncio.Queue: スレッド間でデータを受け渡すための「箱」
        # NFCスレッドが入れて、FastAPIスレッドが取り出す
        self._queue: asyncio.Queue = asyncio.Queue()
        self._running = False
        self._thread: threading.Thread | None = None
        # 読み取りを受け付けるかどうかのフラグ
        # ブラウザが「カード待ち」画面のときだけ True にする
        self._listening = False

    def start(self):
        """監視スレッドを開始する"""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        # daemon=True: メインプログラムが終了したらこのスレッドも自動で終わる
        self._thread.start()

    def stop(self):
        """監視スレッドを停止する"""
        self._running = False

    def set_listening(self, value: bool):
        """読み取りの受付ON/OFF（ブラウザが待機画面のときだけON）"""
        self._listening = value
        # リスニング開始時にキューをクリア（古いデータを捨てる）
        if value:
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    break

    async def wait_for_card(self) -> str:
        """カードが検出されるまで待つ（非同期）"""
        return await self._queue.get()

    def _poll_loop(self):
        """
        NFCリーダーをポーリングするループ（別スレッドで実行される）

        現行コードの read_nfc_id() を常駐型に変えたもの。
        違い:
          - 現行: ボタン押下時に100回ループして終了
          - 新:   常にループし続け、カードが来たら Queue に入れる
        """
        GET_UID_COMMAND = [0xFF, 0xCA, 0x00, 0x00, 0x00]
        last_idm = None  # 同じカードの連続読み取りを防ぐ
        last_read_time = 0

        while self._running:
            # リスニング中でなければ何もしない
            if not self._listening:
                time.sleep(0.3)
                continue

            try:
                r = readers()
                if len(r) == 0:
                    time.sleep(1)
                    continue

                reader = r[0]
                connection = reader.createConnection()
                try:
                    connection.connect()
                    data, sw1, sw2 = connection.transmit(GET_UID_COMMAND)

                    if sw1 == 0x90 and sw2 == 0x00:
                        idm = toHexString(data)
                        now = time.time()

                        # 同じカードを2秒以内に再読み取りしない
                        # （カードを置きっぱなしにしたときの連続読み取り防止）
                        if idm != last_idm or (now - last_read_time) > 2.0:
                            last_idm = idm
                            last_read_time = now
                            # Queue に入れる（FastAPI側が取り出す）
                            self._queue.put_nowait(idm)

                except Exception:
                    pass  # カードが無い場合は例外が出るが、正常動作
                finally:
                    try:
                        connection.disconnect()
                    except Exception:
                        pass

            except Exception:
                pass

            time.sleep(0.1)  # CPU負荷を抑えるための短い待機
