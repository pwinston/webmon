"""Shared Memory Test Client
"""
import sys
import time
import os
import json
from multiprocessing.shared_memory import ShareableList
import base64
from threading import Thread

# Slots in our ShareableList, this is probably not a good system, but
# it's an easy way to prototype.
SLOT_FRAME_NUMBER = 0
SLOT_JSON_BLOB = 1


def _get_client_config() -> dict:
    env_str = os.getenv("NAPARI_MON_CLIENT")
    if env_str is None:
        return None

    env_bytes = env_str.encode('ascii')
    config_bytes = base64.b64decode(env_bytes)
    config_str = config_bytes.decode('ascii')

    return json.loads(config_str)


def _get_data(shared_list):
    json_str = shared_list[SLOT_JSON_BLOB].rstrip()
    return json.loads(json_str)


class MonitorClient(Thread):
    """Example client for napari shared memory monitor."""

    def __init__(self, config: dict, client_name="?"):

        self.config = config
        self.client_name = client_name
        self._last_frame = 0

        # Connect to the shared resources, just one list right now.
        list_name = config['shared_list_name']
        self._log(f"Connecting to shared list {list_name}")
        self.shared_list = ShareableList(name=list_name)
        self._log(f"Connected to shared list {list_name}")

        self.frame_time = 0  # test updating this
        self.start()

    def _log(self, message):
        print(f"Client {self.client_name}: {message}")

    def _log_tiled_data(self, data):
        self._log(f"{data['num_created']=}")
        self._log(f"{data['num_deleted']=}")
        self._log(f"{data['duration_ms']=}")

    def run(self):
        """Check shared memory for new data and decode it."""

        self._log(f"Running...")
        while True:
            self._poll()
            time.sleep(0.1)

    def _poll(self):
        self._log(f"Polling...")
        frame_number = self.shared_list[SLOT_FRAME_NUMBER]
        if frame_number == self._last_frame:
            return  # Nothing new

        # New frame
        self._on_new_frame(frame_number)
        self._last_frame = frame_number

    def _on_new_frame(self, frame_number):
        """There is a new frame, grab the latest JSON blob."""
        self._log(f"Frame number:{frame_number}")
        data = _get_data(self.shared_list)

        if 'frame_time' in data:
            frame_time = data['frame_time']
            self._log(f"Frame rate: {frame_time}")
            self.frame_time = frame_time

        try:
            self._log_tiled_data(data['tiled_image_layer'])
        except KeyError:
            pass  # no tiled data, no big deal


def create_client():
    """Example napari monitor client."""
    config = _get_client_config()
    if config is None:
        print("Client: Exiting since no NAPARI_MON_CLIENT env var set")
        return None

    # Name is just so if we are running multiple clients we can tell
    # their prints apart.
    client_name = "?" if len(sys.argv) < 2 else sys.argv[1]

    return MonitorClient(config, client_name)


if __name__ == '__main__':
    main()
