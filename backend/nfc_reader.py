"""
NFC reader monitoring module.

Polls the NFC card reader in a separate thread and pushes
detected card IDs to an asyncio.Queue for the SSE endpoint.
"""

import asyncio
import threading
import time

from smartcard.System import readers
from smartcard.util import toHexString


class NfcReader:
    """Monitors NFC card reader in a background thread."""

    def __init__(self):
        self._queue: asyncio.Queue = asyncio.Queue()
        self._running = False
        self._thread: threading.Thread | None = None
        self._listening = False

    def start(self):
        """Start the monitoring thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def stop(self):
        """Stop the monitoring thread."""
        self._running = False

    def set_listening(self, value: bool):
        """Enable/disable card detection (only active on card-waiting screen)."""
        self._listening = value
        if value:
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    break

    async def wait_for_card(self) -> str:
        """Wait for a card to be detected (async)."""
        return await self._queue.get()

    def _poll_loop(self):
        """Poll NFC reader continuously (runs in separate thread)."""
        GET_UID_COMMAND = [0xFF, 0xCA, 0x00, 0x00, 0x00]
        last_idm = None
        last_read_time = 0

        while self._running:
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

                        # Prevent duplicate reads within 2 seconds
                        if idm != last_idm or (now - last_read_time) > 2.0:
                            last_idm = idm
                            last_read_time = now
                            self._queue.put_nowait(idm)

                except Exception:
                    pass
                finally:
                    try:
                        connection.disconnect()
                    except Exception:
                        pass

            except Exception:
                pass

            time.sleep(0.1)
