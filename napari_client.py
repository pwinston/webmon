"""Shared Memory Test Client

This client connects to napari's shared memory monitor.
"""
import sys
import time
import os
import json
from multiprocessing.shared_memory import ShareableList
import base64
from threading import Thread

# Slots in our ShareableList. Some day we should receive these slot numbers
# from NAPARI_MON_CLIENT config. That would lbe much more flexible.
SLOT_FRAME_NUMBER = 0
SLOT_JSON_BLOB = 1


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
    json_str = shared_list[SLOT_JSON_BLOB].rstrip()
    return json.loads(json_str)


class MonitorClient(Thread):
    """Client for napari shared memory monitor."""

    def __init__(self, config: dict, client_name="?"):
        super().__init__()
        self.config = config
        self.client_name = client_name

        # We update this with the last frame we've received from napari.
        self.frame_number = 0

        # Defaults for data we expect to read from napari. The
        # web server uses this, but we could design the web side
        # so that no defaults are required.
        self.tile_config = {"rows": 10, "cols": 10}
        self.tile_state = {"seen": [[0, 0], [5, 5]]}

        if config is not None:
            # Connect to the shared resources, just one list right now.
            list_name = config['shared_list_name']
            self._log(f"Connecting to shared list {list_name}")
            self.shared_list = ShareableList(name=list_name)
            self._log(f"Connected to shared list {list_name}")

        # Start our thread so we can poll napari.
        self.start()

    def _log(self, message):
        print(f"Client {self.client_name}: {message}")

    def _log_tiled_data(self, data):
        self._log(f"{data['num_created']=}")
        self._log(f"{data['num_deleted']=}")
        self._log(f"{data['duration_ms']=}")

    def run(self):
        """Periodically check shared memory for new data."""

        self._log(f"Running...")
        while True:
            # Only poll if we are connected, but keep the thread
            # alive either way. Might be useful for debugging.
            if self.config is not None:
                self._poll()

            # TBD what is a good poll interval. But realize we are
            # just checking a single integer in shared memory
            # each time. So not much effor.t
            time.sleep(0.01)

    def _poll(self):
        """See if there is now information in shared mem."""

        # Check napari's current frame.
        frame_number = self.shared_list[SLOT_FRAME_NUMBER]

        # If we already processed this frame, bail out.
        if frame_number == self.frame_number:
            return

        # Process this new frame.
        self._on_new_frame(frame_number)
        self.from_number = frame_number

    def _on_new_frame(self, frame_number):
        """There is a new frame, grab the latest JSON blob."""
        self._log(f"Frame number:{frame_number}")

        # The the JSON blob frame shared memory.
        data = _get_data(self.shared_list)

        # As debug, print it out.
        print(json.dumps(data))

        # Process the new information from napari.
        self._process_new_data(data)

    def _process_new_data(self, data):
        """We have new data from napari, process it.

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

    def set_params(self, params):
        """The web UI sent us new state."""
        print(f"showGrid {params['showGrid']}")


def create_napari_client():
    """Napari monitor client."""
    # Optional name in case we are running multiple client processes,
    # so we tell prints apart, etc.
    client_name = "?" if len(sys.argv) < 2 else sys.argv[1]

    # The config will be None if not launch from napari. But still
    # start some client to do some limitted tested. Some day we could
    # have fake-napari thread updating us for better testing.
    config = _get_client_config()
    return MonitorClient(config, client_name)
