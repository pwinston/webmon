"""NapariBridge class.

Communicates between the webmon.py (the Flask-SocketIO app) and the
NapariClient (the napari shared memory client).
"""
import json
import logging
from queue import Empty, Queue
from threading import Thread, get_ident
from typing import Optional

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
    _commands : Queue
        set_command() puts command into this queue.
    """

    def __init__(self, socketio: SocketIO, client: NapariClient):
        self._socketio = socketio
        self._client = client
        self._commands = Queue()
        self._frame_number = 0

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

            # Send the tile data from napari to the WebUI.
            self._emit_tile_data()

            # Send queued commands to napari.
            self._send_commands_to_napari()

    def _emit_tile_data(self) -> None:
        """Emit the tile data to the web client."""
        try:
            tile_data = self._get_tile_data()
        except KeyError:
            LOGGER.error("KeyError with")
            return  # No data or format was not as expected.

        # Send it to the viewer.
        LOGGER.info("emit: set_tile_data %d", self._frame_number)
        self._socketio.emit('set_tile_data', tile_data, namespace='/test')

    def _get_tile_data(self) -> Optional[dict]:
        """Return the latest tile data from napari.

        Return
        ------
        Optional[dict]
            The data for napari or None if there was none.
        """
        poll_data = self._client.get_napari_data("poll")
        if poll_data is None:
            return None

        layers = poll_data['layers']
        for _key, layer_data in layers.items():
            # Right now we just return the first octree layer's data. Once
            # the viewer can deal with it, we can send all the layers, and
            # it can offer some type of menu to choose with layer to
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
        """Process messages from napari."""
        while True:
            message = self._client.get_one_napari_message()

            if message is None:
                return  # No more messages.

            try:
                # Send the message to the web client.
                data = message['load']
                LOGGER.info("send_load_data: %s", json.dumps(data))
                self._socketio.emit('send_load_data', data, namespace='/test')
            except KeyError:
                LOGGER.info(
                    "Ignoring unknown message: %s", json.dumps(message)
                )
