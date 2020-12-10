"""NapariClient class.

A shared memory client for napari, for use inside webmon.
"""
import base64
import json
import logging
import os
import threading
import time
from multiprocessing.managers import SharedMemoryManager
from queue import Empty, Queue
from threading import Event, Thread
from typing import Callable, NamedTuple, Optional

from lib.numpy_json import NumpyJSON

LOGGER = logging.getLogger("webmon")

BUFFER_SIZE = 1024 * 1024

# Don't always log since it results in a lot of log span. Maybe make this
# a command line option.
LOG_DATA_FROM_NAPARI = False

# TBD what is a good poll interval is, but certainly we don't need to
# to go faster than 60Hz.
POLL_INTERVAL_MS = 16.7
POLL_INTERVAL_SECONDS = POLL_INTERVAL_MS / 1000


class NapariRemoteAPI(NamedTuple):
    """Napari exposes these shared resources.

    Right now the only way to know what resources napari exposes is looking
    at the MonitorApi code in napari in the file:
        napari/components/experimental/monitor._api.py - https://git.io/JIVPb
    """

    RESOURCES = [
        'napari_data',
        'napari_messages',
        'napari_shutdown',
        'client_data',
        'client_messages',
    ]

    napari_data: dict
    napari_messages: Queue
    napari_shutdown: Event

    client_data: dict
    client_messages: Queue

    @classmethod
    def from_manager(cls, manager):
        return cls(
            manager.napari_messages(),
            manager.napari_data(),
            manager.napari_shutdown(),
            manager.client_messages(),
            manager.client_data(),
        )


def _get_client_config() -> dict:
    """Get config information from napari.

    Napari passes us a base64 encoded JSON blob in an environment variable.
    We decode it on startup. It contains the server_port that we give
    to the SharedMemoryManager so it can connect to napari.

    Return
    ------
    dict
        The parsed configuration.
    """
    env_str = os.getenv("NAPARI_MON_CLIENT")
    if env_str is None:
        LOGGER.error("NAPARI_MON_CLIENT not defined")
        return None

    env_bytes = env_str.encode('ascii')
    config_bytes = base64.b64decode(env_bytes)
    config_str = config_bytes.decode('ascii')

    return json.loads(config_str)


def _log_env(all_vars=False) -> None:
    """Log environment variables that we care about."""
    for key, value in os.environ.items():
        if all_vars or "NAPARI" in key:
            LOGGER.info("%s = %s", key, value)


class NapariClient(Thread):
    """Shared memory client for napari.

    Napari launches this process. We get config information from our
    NAPARI_MON_CLIENT environment variable. We connect our
    SharedMemoryManager to the server_port specified in that config file.

    See napari's MonitorApi in  for
    documention on the shared resources that napari exposes.

    Parameters
    ----------
    config : dict
        The parsed configuration from the NAPARI_MON_CLIENT env variable.
    on_shutdown : Callable[[], None]
        We call then when shutting down.
    """

    def __init__(self, config: dict, on_shutdown: Callable[[], None]):
        super().__init__()
        self.config = config
        self._on_shutdown = on_shutdown
        self._running = False

        # Data plucked out of self._remote.data, we might get rid of this
        # and use the data from the shared dict directly?
        self.napari_data = {}

        LOGGER.info("Starting process %s", os.getpid())
        _log_env()  # Log our startup environment.

        server_port = config['server_port']
        LOGGER.info("connecting to napari on port %d.", server_port)

        # We have to register these before creating the SharedMemoryManager.
        # Note that we don't have to give the types, just the names.
        # Although to use them we probably want to know the types!
        for name in NapariRemoteAPI.RESOURCES:
            SharedMemoryManager.register(name)

        # Connect to napari's shared memory on the server_port that napari
        # passed us in our NAPARI_MON_CLIENT configuration.
        self._manager = SharedMemoryManager(
            address=('localhost', config['server_port']),
            authkey=str.encode('napari'),
        )
        self._manager.connect()

        # Get the shared resources as a convenient named tuple.
        self._remote = NapariRemoteAPI.from_manager(self._manager)

        # Start our thread which will poll napari.
        self.start()

    def run(self) -> None:
        """Thread that communicates with napari.

        Poll until we see the napari_shutdown event was set, or we get a
        connection error. Right now napari does not wait after signaling a
        shutdown, so more than 9/10 times the first indication we receive
        the napari is shutting down is getting a connection error.

        Which is fine for now. But a graceful handshake-exit might be
        something to look into. Obviously napari should have a short
        timeout so if the client is hung, it still exits quickly.
        """

        self._running = True
        tid = threading.get_ident()
        LOGGER.info("Started NapariClient.run with thread_id = %d.", tid)

        while True:
            try:
                if not self._poll():
                    break  # Shutdown event, exit the thread.
            except ConnectionResetError:
                LOGGER.info("ConnectionResetError polling napari.")
                break  # Napari exited, exit the thread.

            # Sleep until ready to poll again.
            time.sleep(POLL_INTERVAL_SECONDS)

        LOGGER.info("Thread %d is exiting.", tid)

        # Notify webmon that we shutdown.
        self._running = False
        self._on_shutdown()

    def _poll(self) -> bool:
        """Communicate with napari.

        Return
        ------
        bool
            Return True if we should keep polling.
        """
        if self._remote.napari_shutting_down.is_set():
            LOGGER.info("Napari signaled shutdown.")
            return False  # Stop polling.

        # Do we need to copy here? Otherwise are we referring directly to
        # the version in shared memory? That might might be good: no copy
        # unless we really reference the data? But could it change out from
        # under us? Do we care as long as it's done safely, and we get the
        # latest version? TBD.
        self.napari_data['tile_data'] = {
            "tile_config": self._remote.data.get('tile_config'),
            "tile_state": self._remote.data.get('tile_state'),
        }

        if LOG_DATA_FROM_NAPARI:
            pretty_str = NumpyJSON.dumps(self.napari_data, indent=4)
            LOGGER.info("New data from napari: %s", pretty_str)

        return True  # Keep polling

    def send_command(self, command) -> None:
        """Send new command to napari.
        """
        LOGGER.info("Sending command %s", command)

        try:
            # Put on the shared command queue.
            self._remote.commands.put(command)
        except ConnectionRefusedError:
            LOGGER.error("ConnectionRefusedError sending command to napari.")

    def get_napari_message(self) -> dict:
        """Get one message from napari.

        Return
        ------
        dict
            The message.
        """
        if not self._running:
            return None  # Cannot get message from napari.

        try:
            while True:
                try:
                    message = self._remote.client_messages.get_nowait()
                except ConnectionResetError:
                    LOGGER.error(
                        "ConnectionResetError getting messages from napari"
                    )
                    return None

                assert isinstance(message, dict)  # For now.
                LOGGER.info("Message from napari: %s", json.dumps(message))
                return message
        except Empty:
            return None  # No more messages.

    @classmethod
    def create(cls, on_shutdown: Callable[[], None]):
        """Create and return the NapariClient instance.

        Parameters
        ----------
        on_shutdown : Callable[[], None]
            NapariClient will call this when it shuts down.

        Return
        ------
        Optional[NapariClient]
            The newly created client or None on error.
        """
        config = _get_client_config()
        if config is None:
            return None
        LOGGER.info("Creating NapariClient pid=%s", os.getpid())
        return cls(config, on_shutdown)
