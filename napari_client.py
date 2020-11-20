"""Shared Memory Test Client

This client connects to napari's shared memory monitor.
"""
from dataclasses import dataclass
import time
import os
import json
from multiprocessing.shared_memory import ShareableList
import base64
from threading import Thread

# Slots in our ShareableList. Some day we should receive these slot numbers
# from NAPARI_MON_CLIENT config. That would be much more flexible.
FRAME_NUMBER = 0
FROM_NAPARI = 1
TO_NAPARI = 2


@dataclass
class NapariState:
    """State coming from napari.

    May not really need this class. Just pass the full dict around,
    but for now to be clear and in case it's helpful.
    """

    # Defaults for data we expect to read from napari. The web server uses
    # this, but we should probably design the web side so that no defaults
    # are required.
    tile_config: dict = None
    tile_state: dict = None

    def update(self, data) -> None:
        """Process this new data from napari.

        We want to be resilient here in case we are dealing with a
        different version of napari, or it's just configured differently
        that we expect. No don't crash no matter what.
        """

        try:
            self.tile_config = data['tile_config']
        except KeyError:
            pass

        try:
            self.tile_state = data['tile_state']
        except KeyError:
            pass


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


def _get_data(shared_list):
    """Get the JSON blob from napari's shared memory."""


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
        self.config = config
        self.client_name = client_name
        self.napari_state = NapariState()

        # We update this with the last frame we've received from napari.
        self.frame_number = 0

        if self.config is not None:
            # Connect to the shared resources, just one list right now.
            list_name = config['shared_list_name']
            self._log(f"Connecting to shared list {list_name}")
            self.shared_list = ShareableList(name=list_name)
            self._log(f"Connected to shared list {list_name}")

        # TODO_MON: We need to check if we really connected to napri's
        # share memory or not. Surely there could be errors.
        self.connected = self.config is not None

        # Start our thread so we can poll napari.
        self.start()

    def _log(self, message) -> None:
        print(f"Client {self.client_name}: {message}")

    def _log_tiled_data(self, data) -> None:
        self._log(f"{data['num_created']=}")
        self._log(f"{data['num_deleted']=}")
        self._log(f"{data['duration_ms']=}")

    def run(self) -> None:
        """Periodically check shared memory for new data."""

        self._log(f"Running...")
        while True:
            # Only poll if we are connected, but keep the thread
            # alive either way. Might be useful for debugging.
            if self.connected:
                self._poll()

            # TBD what is a good poll interval. But realize we are
            # just checking a single integer in shared memory
            # each time. So not much effor.t
            time.sleep(0.01)

    def _poll(self) -> None:
        """See if there is now information in shared mem."""

        # Check napari's current frame.
        frame_number = self.shared_list[FRAME_NUMBER]

        # If we already processed this frame, bail out.
        if frame_number == self.frame_number:
            return

        # Process this new frame.
        self._on_new_frame(frame_number)
        self.frame_number = frame_number

    def _on_new_frame(self, frame_number) -> None:
        """There is a new frame, grab the latest JSON blob."""
        self._log(f"Frame number:{frame_number}")

        # Get the JSON blob frame shared memory.
        json_str = self.shared_list[FROM_NAPARI].rstrip()
        data = json.loads(json_str)

        # As debug, print it out.
        self._log(f"Data from napari: {json_str}")

        # Process the new information from napari.
        self.napari_state.update(data)

    def set_params(self, params) -> None:
        """Send new Web UI state to napari.

        This is very ad hoc, we need a real queue or handshake or something.
        For now we just throw it in and expect napari to read it out.
        """
        if self.connected:
            json_str = json.dumps(params)
            self._log(f"Pass params to napari {json_str}")
            self.shared_list[TO_NAPARI] = json.dumps(json_str)


def create_napari_client(client_name) -> MonitorClient:
    """Napari monitor client."""
    # The config will be None if not launch from napari. But still
    # start some client to do some limitted tested. Some day we could
    # have fake-napari thread updating us for better testing.
    config = _get_client_config()
    return MonitorClient(config, client_name)
