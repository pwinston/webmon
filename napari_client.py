"""MonitorClient class.

A shared memory client for napari.

This client connects to napari's shared memory monitor.
"""
from typing import NamedTuple, Optional
import base64
import json
import os
import logging
from threading import Event, Thread
from queue import Queue
from multiprocessing.managers import SharedMemoryManager
import time


LOGGER = logging.getLogger("webmon")

BUFFER_SIZE = 1024 * 1024

DUMP_DATA_FROM_NAPARI = False

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
        print("MonitorClient: NAPARI_MON_CLIENT not defined")
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


class MonitorClient(Thread):
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

    def __init__(self, config: dict, client_name="?"):
        super().__init__()
        assert config
        self.config = config
        self.client_name = client_name

        self.running = True
        self.napari_data = None

        LOGGER.info("Starting MonitorClient process %s", os.getpid())
        _log_env()

        server_port = config['server_port']
        LOGGER.info("Connecting to port %d...", server_port)

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
        """Check shared memory for new data."""

        LOGGER.info("MonitorClient thread is running...")

        while True:
            if not self._poll():
                break

            time.sleep(POLL_INTERVAL_MS / 1000)

        LOGGER.info("Exiting thread...")

        # webmon checks this and stops/exits.
        self.running = False

    def _poll(self) -> bool:
        """See if there is now information in shared mem."""

        # LOGGER.info("Poll...")
        try:
            if self._shared.shutdown.is_set():
                # We sometimes do see the shutdown event was set. But usually
                # we just get ConnectionResetError, because napari is exiting.
                LOGGER.info("Shutdown event was set.")
                return False  # Stop polling
        except ConnectionResetError:
            LOGGER.info("ConnectionResetError.")
            return False  # Stop polling

        # Do we need to copy here?
        self.napari_data = {
            "tile_config": self._shared.data.get('tile_config'),
            "tile_state": self._shared.data.get('tile_state'),
        }

        if DUMP_DATA_FROM_NAPARI:
            pretty_str = json.dumps(self.napari_data, indent=4)
            LOGGER.info("New data from napari: %s", pretty_str)

        return True  # Keep polling

    def post_command(self, command) -> None:
        """Send new command to napari.
        """
        LOGGER.info(f"Posting command {command}")

        try:
            self._shared.commands.put(command)
        except ConnectionRefusedError:
            self._log("ConnectionRefusedError")

    def stop(self) -> None:
        """Call on shutdown. TODO_MON: no one calls this yet?"""
        self._manager.shutdown()


def create_napari_client(client_name) -> Optional[MonitorClient]:
    """Napari monitor client."""
    config = _get_client_config()
    if config is None:
        return None
    return MonitorClient(config, client_name)
