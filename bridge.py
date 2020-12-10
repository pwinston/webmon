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
    _commands : Queue
        set_command() puts command into this queue.
    """

    def __init__(self, socketio: SocketIO, client: NapariClient):
        self._socketio = socketio
        self._client = client
        self._commands = Queue()

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
        """Background task that shuttled data to/from napari and the WebUI."""
        LOGGER.info("Webmon: Start background task thread_id=%d", get_ident())

        while True:
            # LOGGER.info("Sleeping %f", poll_seconds)
            self._socketio.sleep(POLL_INTERVAL_SECONDS)

            # Empty the self._commands queue, sending commmands to napari.
            self._send_commands_to_napari()

            # We just send the whole thing every time right now. Need
            # a good way to avoid sending redundant/identical data?
            if self._client is not None:

                # Get latest data from the client.
                tile_data = self._client.napari_data['tile_data']

                print(f"tile_data: {tile_data}")

                # Send it to the viewer.
                self._socketio.emit(
                    'set_tile_data', tile_data, namespace='/test'
                )

            self._process_messages_from_napari()

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
                self._client.send_command(command)

    def _process_messages_from_napari(self) -> None:
        """Process message from napari."""
        if self._client is None:
            return

        while True:
            message = self._client.get_napari_message()

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
