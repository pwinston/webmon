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
from queue import Queue
from threading import Event, Thread
from typing import Callable, NamedTuple, Optional

from lib.numpy_json import NumpyJSON

LOGGER = logging.getLogger("webmon")

BUFFER_SIZE = 1024 * 1024

# Results in a lot of log spam.
LOG_DATA_FROM_NAPARI = False

# TBD what is a good poll interval is.
POLL_INTERVAL_MS = 100


class SharedResources(NamedTuple):
    """Napari exposes these shared resources."""

    shutdown: Optional[Event] = None
    commands: Optional[Queue] = None
    data: Optional[dict] = None


def _get_client_config() -> dict:
    """Get config information from napari.

    Napari passes us a base64 encoded JSON blob in an environment
    variable. We read it on startup so that we know how to connect
    back to napari. Could contain more information in the future
    like multiple shared resources, etc.
    """
    env_str = os.getenv("NAPARI_MON_CLIENT")
    if env_str is None:
        print("NapariClient: NAPARI_MON_CLIENT not defined")
        return None

    env_bytes = env_str.encode('ascii')
    config_bytes = base64.b64decode(env_bytes)
    config_str = config_bytes.decode('ascii')

    return json.loads(config_str)


def _log_env(all_vars=False):
    """Log our environment."""
    for key, value in os.environ.items():
        if all_vars or "NAPARI" in key:
            LOGGER.info("%s = %s", key, value)


class NapariClient(Thread):
    """Client for napari shared memory monitor.

    Napari launches us. We get config information from our NAPARI_MON_CLIENT
    environment variable. That contains a port number to connect to.
    We connect our SharedMemoryManager to that port.

    We get these resources from the manager:

    1) shutdown_event()

    If this is set napari is exiting. Ususally it exists so fast we get
    at ConnectionResetError exception instead of see this was set. We have
    no clean way to exit the SocketIO server yet.

    2) command_queue()

    We put command onto this queue for napari to execute.

    3) data()

    Data from napari's monitor.add() command.
    """

    def __init__(self, config: dict, on_shutdown: Callable[[], None]):
        super().__init__()
        assert config
        self.config = config
        self.on_shutdown = on_shutdown

        self.napari_data = {}

        pid = os.getpid()
        LOGGER.info("NapariClient: starting process %s", pid)
        _log_env()

        server_port = config['server_port']
        LOGGER.info("NapariClient: connecting to port %d.", server_port)

        # Right now we just need to magically know these callback names,
        # maybe we can come up with a better way.
        napari_api = ['shutdown_event', 'command_queue', 'data']
        for name in napari_api:
            SharedMemoryManager.register(name)

        # Connect to napari's shared memory.
        self._manager = SharedMemoryManager(
            address=('localhost', config['server_port']),
            authkey=str.encode('napari'),
        )
        self._manager.connect()

        # Get the shared resources.
        self._shared = SharedResources(
            self._manager.shutdown_event(),
            self._manager.command_queue(),
            self._manager.data(),
        )

        # Start our thread so we can poll napari.
        self.start()

    def run(self) -> None:
        """Thread that communicates with napari."""

        tid = threading.get_ident()
        LOGGER.info("NapariClient: thread %d started.", tid)

        poll_interval_seconds = POLL_INTERVAL_MS / 1000

        while True:
            try:
                if not self._poll():
                    break  # Exit thread.
            except ConnectionResetError:
                LOGGER.info("NapariClient: ConnectionResetError.")
                break  # Exit thread.

            # Sleep until ready to poll again.
            time.sleep(poll_interval_seconds)

        LOGGER.info("NapariClient: thread %d is exiting.", tid)

        # Notify webmon that we shutdown.
        self.on_shutdown()

    def _poll(self) -> bool:
        """Process data to/from napari.

        Return
        ------
        bool
            Return True if we should keep polling.

        Note
        ----
        Today Napari signals its shutdown event and then immediately exits.
        Therefore most of the time we get a ConnectionResetError and never
        actually see that the event was signaled.

        This is fine for now. If we need a cleaner shutdown sequence we
        could have napari wait on a shutdown event from each running
        client. With a short 1-2 second timeout so it never hangs. Then
        both napari and the client would have the chance to do some
        final cleanup.
        """
        if self._shared.shutdown.is_set():
            LOGGER.info("NapariClient: napari signaled shutdown.")
            return False  # Stop polling.

        # Do we need to copy here? Otherwise are we referring directly to
        # the version in shared memory? That might change out from under
        # us, but as long it does so safely, maybe that's okay?
        self.napari_data['tile_data'] = {
            "tile_config": self._shared.data.get('tile_config'),
            "tile_state": self._shared.data.get('tile_state'),
        }

        if LOG_DATA_FROM_NAPARI:
            pretty_str = NumpyJSON.dumps(self.napari_data, indent=4)
            LOGGER.info("NapariClient: New data from napari: %s", pretty_str)

        return True  # Keep polling

    def send_command(self, command) -> None:
        """Send new command to napari.
        """
        LOGGER.info("Sending command %s", command)

        try:
            # Put on the shared command queue.
            self._shared.commands.put(command)
        except ConnectionRefusedError:
            self._log("NapariClient: ConnectionRefusedError")

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
        return cls(config, on_shutdown)
