"""NapariBridge class.

Communicates between the Flask-SocketIO app and the NapariClient.
"""
import json
import logging
from queue import Empty, Queue
from threading import Thread, get_ident

from flask_socketio import SocketIO

from napari_client import NapariClient

LOGGER = logging.getLogger("webmon")

# Number of milliseconds between sending/receiving data.
POLL_INTERVAL_MS = 16.7
POLL_INTERVAL_SECONDS = POLL_INTERVAL_MS / 1000


class NapariBridge:
    """Bridge between webmon and NapariClient.

    Parameters
    ----------
    socketio : SocketIO
        The main SocketIO instance.
    client : NapariClient
        The client that's talking to napari.

    Attributes
    ----------
    commands : Queue
        set_command() puts command into this queue.
    """

    def __init__(self, socketio: SocketIO, client: NapariClient):
        self.socketio = socketio
        self.client = client
        self.commands = Queue()

    def send_command(self, command) -> None:
        """Put into queue for background_task to send."""
        self.commands.put(command)

    def start_background_task(self) -> Thread:
        """Start our background task."""
        return self.socketio.start_background_task(target=self._task)

    def _task(self) -> None:
        """Send data to/from the viewer and napari."""
        tid = get_ident()
        LOGGER.info("Webmon: Background task thread_id=%d", tid)

        while True:
            # LOGGER.info("Sleeping %f", poll_seconds)
            self.socketio.sleep(POLL_INTERVAL_SECONDS)

            self._send_commands()  # Send any pending commands.

            # We just send the whole thing every time right now. Need
            # a good way to avoid sending redundant/identical data.
            if self.client is not None:
                tile_data = self.client.napari_data['tile_data']
                self.socketio.emit(
                    'set_tile_data', tile_data, namespace='/test'
                )

            self._process_messages()

    def _send_commands(self) -> None:
        """Send all pending commands."""
        while True:
            try:
                command = self.commands.get_nowait()
            except Empty:
                break  # No more commands to send.

            if self.client is None:
                LOGGER.info("Send Command (no client): %s", command)
            else:
                self.client.send_command(command)

    def _process_messages(self) -> None:
        while True:
            message = self.client.get_napari_message()

            if message is None:
                return  # No more messages.

            try:
                data = message['load']
                LOGGER.info("send_load_data: %s", json.dumps(data))
                self.socketio.emit('send_load_data', data, namespace='/test')
            except KeyError:
                LOGGER.info(
                    "Ignoring unknown message: %s", json.dumps(message)
                )
