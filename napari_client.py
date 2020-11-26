"""Shared Memory Test Client

This client connects to napari's shared memory monitor.
"""
import base64
import json
import os
import logging
from multiprocessing.managers import SharedMemoryManager
from multiprocessing.shared_memory import ShareableList
import sys
import time
from threading import Thread
from typing import Optional

LOGGER = logging.getLogger("webmon")

# Slots in our ShareableList. Some day we should receive these slot numbers
# from NAPARI_MON_CLIENT config. That would be much more flexible.
FRAME_NUMBER = 0
FROM_NAPARI = 1

BUFFER_SIZE = 1024 * 1024

DUMP_DATA_FROM_NAPARI = False


def _get_client_config() -> dict:
    """Get config information from napari.

    Napari passes us a base64 encoded JSON blob in an environment
    variable. We read it on startup so that we know how to connect
    back to napari. Could contain more information in the future
    like multiple shared resources, etc.
    """
    env_str = os.getenv("NAPARI_MON_CLIENT")
    if env_str is None:
        return None

    env_bytes = env_str.encode('ascii')
    config_bytes = base64.b64decode(env_bytes)
    config_str = config_bytes.decode('ascii')

    return json.loads(config_str)


class MonitorClient(Thread):
    """Client for napari shared memory monitor.

    Napari launches us, we get config information from our NAPARI_MON_CLIENT
    environment variable. We get the shared memory name from that, and in
    the future more things napari needs to tell us.

    We connect to the ShareableList and then poll looking at the frame 
    number. Just checking a single int in shared memory. When it increments
    we grab the contents of the FROM_NAPARI slot.

    We store the data from napari in attributes that webmon.py can access.
    We should Named
    """

    def __init__(self, config: dict, client_name="?"):
        super().__init__()
        assert config
        self.config = config
        self.client_name = client_name

        LOGGER.info("Starting MonitorClient process %s", os.getpid())
        self.napari_data = None
        self.napari_data_new = False

        server_port = config['server_port']
        LOGGER.info("Connecting to port %d...", server_port)

        # These are callbacks napari provides. We could get a list of callbacks
        # from the config. But we can do anything with them unless we modify
        # our source anyway, so does it matter this is manual?
        SharedMemoryManager.register('shutdown_event')
        SharedMemoryManager.register('command_queue')

        self._manager = SharedMemoryManager(
            address=('localhost', config['server_port']),
            authkey=str.encode('napari'),
        )
        self._manager.connect()

        # Get the shared resources.
        self._shutdown = self._manager.shutdown_event()
        self._commands = self._manager.command_queue()

        # We update this with the last frame we've received from napari.
        self.frame_number = 0

        # As a quick hack until we have better "changed detection", just
        # compare the new and old strings.
        self.last_json_str = None

        # Connect to the shared resources, just one list right now.
        list_name = config['shared_list_name']
        LOGGER.info("Connecting to shared list %s", list_name)
        self.shared_list = ShareableList(name=list_name)

        # Start our thread so we can poll napari.
        self.start()

    def run(self) -> None:
        """Check shared memory for new data."""

        LOGGER.info("MonitorClient thread is running...")

        while True:
            if not self._poll():
                LOGGER.info("Exiting...")
                break

            # TBD what is a good poll interval is.
            time.sleep(0.01)

        # Hard exiting is bad, but it does not sound easy to gracefully
        # exit a Flask-SocketIO server. If this is messing up the viewer
        # we'll need to do better.
        sys.exit(0)

    def _poll(self) -> bool:
        """See if there is now information in shared mem."""

        # LOGGER.info("Poll...")
        try:
            if self._shutdown.is_set():
                # We sometimes do see the shutdown event was set. But usually
                # we just get ConnectionResetError, because napari is exiting.
                LOGGER.info("Shutdown event was set.")
                return False  # Stop polling
        except ConnectionResetError:
            LOGGER.info("ConnectionResetError.")
            return False  # Stop polling

        # Check napari's current frame.
        try:
            frame_number = self.shared_list[FRAME_NUMBER]
        except ValueError:
            # Not sure why we get this ValueError sometimes:
            # "not enough values to unpack (expected 1, got 0)"
            # Seems like it should be save to read from a a single
            # int form a ShareableList! Need to investigate.
            LOGGER.error("ValueError reading frame index.")

        # If we already processed this frame, bail out.
        if frame_number == self.frame_number:
            # LOGGER.info("Same frame %d", self.frame_number)
            return True  # Keep polling

        # Process this new frame.
        self._on_new_frame(frame_number)
        self.frame_number = frame_number

        return True  # Keep polling

    def _on_new_frame(self, frame_number) -> None:
        """There is a new frame, grab the latest JSON blob."""
        # LOGGER.info("New frame %d", frame_number)

        # Get the JSON blob frame shared memory.
        json_str = self.shared_list[FROM_NAPARI].rstrip()

        try:
            if json_str == self.last_json_str:
                return  # nothing is now

            self.napari_data = json.loads(json_str)
            self.napari_data_new = True
            self.last_json_str = json_str

            if DUMP_DATA_FROM_NAPARI:
                pretty_str = json.dumps(self.napari_data, indent=4)
                LOGGER.info("New data from napari: %s", pretty_str)

        except json.decoder.JSONDecodeError:
            LOGGER.error("Parsing data from napari: %s", json_str)

    def post_command(self, command) -> None:
        """Send new command to napari.
        """
        if not self.connected:
            return

        self._log(f"Posting command {command}")

        try:
            self._commands.put(command)
        except ConnectionRefusedError:
            self._log("ConnectionRefusedError")

    def stop(self) -> None:
        """Call on shutdown. TODO_MON: no one calls this yet?"""
        self._manager.shutdown()

    def _log_tiled_data(self, data) -> None:
        LOGGER.info("data['num_created'] = %s", data['num_created'])
        LOGGER.info("data['num_deleted'] = %s", data['num_deleted'])
        LOGGER.info("data['duration_ms'] = %s", data['duration_ms'])


def create_napari_client(client_name) -> Optional[MonitorClient]:
    """Napari monitor client."""
    config = _get_client_config()
    if config is None:
        return None
    return MonitorClient(config, client_name)
