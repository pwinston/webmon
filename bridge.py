"""NapariBridge class.

Communicates between the webmon.py (the Flask-SocketIO app) and the
NapariClient (the napari shared memory client).
"""
import logging
import time
from queue import Empty, Queue
from threading import Thread, get_ident
from typing import Optional

from flask_socketio import SocketIO

from napari_client import NapariClient

LOGGER = logging.getLogger("webmon")

# Number of milliseconds between sending/receiving data.
POLL_INTERVAL_MS = 16.7
POLL_INTERVAL_SECONDS = POLL_INTERVAL_MS / 1000


class ChartMessages:
    def __init__(self):
        self.keys = ['frame_time', 'load_chunk']
        self._messages = {key: [] for key in self.keys}
        self._last_time = None

    def clear(self) -> None:
        for values in self._messages.values():
            values.clear()

    def add_chart_message(self, message) -> bool:
        """If this is a chart message add it and return True.

        A chart mesage is like:

        {
            "frame_time": {
                "delta_ms" 16.7
            }
        }

        """
        for key in self.keys:
            if key in message:
                one_message = message[key]
                self._messages[key].append(one_message)
                return True

        return False  # Not a chart message.

    @property
    def messages(self):
        return self._messages

    def log_counts(self) -> None:
        for key, values in self.messages.items():
            LOGGER.info("Key %s: %d values", key, len(values))


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
    _commands : Queue
        set_command() puts command into this queue.
    """

    def __init__(self, socketio: SocketIO, client: NapariClient):
        self._socketio = socketio
        self._client = client
        self._commands = Queue()
        self._frame_number = 0
        self._chart_messages = ChartMessages()
        self._last_emit = None

    def send_command(self, command: dict) -> None:
        """Set this command to napari.

        Put the given command into the self._commands queue. The background
        task will send it to napari.

        Parameters
        ----------
        command : dict
            The command to send to napari.
        """
        self._commands.put(command)

    def start_background_task(self) -> Thread:
        """Start our background task.

        Return
        ------
        Thread
            A Thread-compatible object.
        """
        return self._socketio.start_background_task(
            target=self._background_task
        )

    def _background_task(self) -> None:
        """Background task that shuttles data to/from napari and the WebUI."""
        LOGGER.info("Webmon: Start background task thread_id=%d", get_ident())

        while True:
            self._frame_number += 1

            # LOGGER.info("Sleeping %f", poll_seconds)
            self._socketio.sleep(POLL_INTERVAL_SECONDS)

            if self._client is None:
                continue  # Can't do much without a client.

            self._process_messages_from_napari()
            self._process_poll_data()
            self._send_commands_to_napari()

    def _process_poll_data(self) -> None:
        poll_data = self._client.get_napari_data("poll")
        if poll_data is None:
            return  # No poll data

        # Extract the tile data.
        tile_data = self._get_tile_data(poll_data)

        # Send it to the viewer.
        self._socketio.emit('set_tile_data', tile_data, namespace='/test')

    def _get_tile_data(self, poll_data) -> Optional[dict]:
        """Return the latest tile data from the poll_data

        Return
        ------
        Optional[dict]
            The tile data data or None if there was none.
        """
        layers = poll_data['layers']
        for _key, layer_data in layers.items():
            # Right now we just return the first octree layer's data. Once
            # the viewer can deal with it, we can send all the layers, and
            # it can offer some type of menu to choose which layer to
            # display tiles for.
            return layer_data

        return None  # No layers?

    def _send_commands_to_napari(self) -> None:
        """Send all pending commands to napari."""
        while True:
            try:
                command = self._commands.get_nowait()
            except Empty:
                return  # No more commands to send.

            if self._client is None:
                LOGGER.warning("Cannot send command (no client): %s", command)
            else:
                self._client.send_message(command)

    def _process_messages_from_napari(self) -> None:
        """Send napari messages to the web client"""
        while True:
            message = self._client.get_one_napari_message()

            if message is None:
                return  # No more messages.

            # Try adding it as a chart message. We store these up and only
            # send them when the web client asks for them. Otherwise the
            # web client would bog down with too many messages.
            if not self._chart_messages.add_chart_message(message):
                # Was not a chart message so just pass it to the web client.
                self._socketio.emit(
                    'napari_message', message, namespace='/test'
                )

    def emit_chart_data(self):
        messages = self._chart_messages.messages

        for key, values in messages.items():
            LOGGER.info("Sending %s: %d values", key, len(values))

        if self._last_emit is None:
            self._last_emit = time.time()
        else:
            now = time.time()
            elapsed = now - self._last_emit
            LOGGER.info("last emit: %f", elapsed)
            self._last_emit = now

        self._socketio.emit('chart_data', messages, namespace='/test')
        self._chart_messages.clear()

