"""NapariBridge class.

Communicates between the Flask-SocketIO app and the NapariClient.
"""
import logging
from queue import Empty, Queue
from threading import get_ident

from flask_socketio import SocketIO

from napari_client import NapariClient

LOGGER = logging.getLogger("webmon")


class NapariBridge:

    # Number of seconds between sending/receiving data.
    POLL_INTERVAL_MS = 100

    def __init__(self, socketio: SocketIO, client: NapariClient):
        self.socketio = socketio
        self.client = client
        self.commands = Queue()

    def send_command(self, command) -> None:
        """Put into queue for background_task to send."""
        self.commands.put(command)

    def background_task(self) -> None:
        """Send data to/from the viewer and napari."""
        poll_seconds = self.POLL_INTERVAL_MS / 1000
        tid = get_ident()
        LOGGER.info("Webmon: Background task thread_id=%d", tid)

        while True:
            # LOGGER.info("Sleeping %f", poll_seconds)
            self.socketio.sleep(poll_seconds)

            if self.client is None:
                continue

            self._send_commands()  # Send any pending commands.

            # We just send the whole thing every time. We could potentially
            # only send if the data had changed since the last time
            # we sent it. To cut down the spamming viewer with repeated
            # data.
            tile_data = self.client.napari_data['tile_data']
            self.socketio.emit('set_tile_data', tile_data, namespace='/test')

    def _send_commands(self) -> None:
        """Send all pending commands."""
        while True:
            try:
                command = self.commands.get_nowait()
            except Empty:
                break  # No more commands to end.
            LOGGER.info("Send command to napari: %s", command)
            self.client.send_command(command)
