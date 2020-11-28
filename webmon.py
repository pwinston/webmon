"""webmon

Proof of concept napari monitor client and Flask-SocketIO web server.

We start up MonitorClient to monitor napari's shared memory. When it
sees new information we push it out to any connected web browsers.

Modified from https://github.com/ageller/FlaskTest
"""
import json
import logging
import os
from pathlib import Path
from threading import Lock

import click
import numpy as np
from flask import Flask, render_template, session
from flask_socketio import SocketIO, emit

from napari_client import create_napari_client

LOGGER = logging.getLogger("webmon")

client = None


class NumpyJSONEncoder(json.JSONEncoder):
    """A JSONEncoder that also converts ndarray's to lists.

    We might want to also derive from flask.jsonJSONEncoder which supports
    "datetime, UUID, dataclasses and Markup objects"?
    """

    def default(self, o):
        if isinstance(o, np.ndarray):
            return o.tolist()
        return json.JSONEncoder.default(self, o)


class NumpyJSON:
    """So SocketIO can encode numpy arrays for us."""

    @staticmethod
    def dumps(obj, *args, **kwargs):
        kwargs.update({"cls": NumpyJSONEncoder})
        return json.dumps(obj, *args, **kwargs)

    @staticmethod
    def loads(obj, *args, **kwargs):
        return json.loads(obj, *args, **kwargs)


# Set this variable to "threading", "eventlet" or "gevent" to test the
# different async modes, or leave it set to None for the application to choose
# the best option based on installed packages.
async_mode = None

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'

socketio = SocketIO(app, async_mode=async_mode, json=NumpyJSON)
thread = None
thread_lock = Lock()

# global variables to hold the params and camera
params = None
updateParams = False

# number of seconds between updates
poll_interval_seconds = 0.01

last_frame_number = None

# Hack way to avoid spamming the viewer with duplicate data.
last_json_str = ""


def numpy_dumps(data: dict) -> str:
    """Return data as a JSON string.

    Under the hood socketio.emit() will serialize to JSON and it will choke
    on numpy data, so we convert to JSON ourselves ahead of time.

    Return
    ------
    str
        The JSON string.
    """
    return json.dumps(data, cls=NumpyJSONEncoder)


def background_thread() -> None:
    """Send data to/from the viewer and napari."""
    global params, updateParams, last_json_str
    while True:
        socketio.sleep(poll_interval_seconds)

        if client is None:
            LOGGER.info("Client is None, keep trying.")
            continue  # Still starting up?

        if not client.running:
            LOGGER.info("Client not running, exiting background thread.")
            socketio.stop()  # Does not work?
            return

        if updateParams:
            # Post data from viewer to napari.
            LOGGER.info("Post command to napari: %s", params)
            client.post_command(params)
        updateParams = False

        # Set new napari data to viewer
        data = client.napari_data
        json_str = numpy_dumps(data)
        if json_str == last_json_str:
            continue  # Nothing new.

        data_len = len(json_str)
        LOGGER.info(json_str)
        LOGGER.info("Emit set_tile_data: %d chars", data_len)
        socketio.emit('set_tile_data', data, namespace='/test')
        last_json_str = json_str


@socketio.on_error_default
def default_error_handler(e):
    LOGGER.error(e)


# Testing the connection.
@socketio.on('connection_test', namespace='/test')
def connection_test(message):
    session['receive_count'] = session.get('receive_count', 0) + 1
    emit(
        'connection_response',
        {'data': message['data'], 'count': session['receive_count']},
    )


# Sending data.
@socketio.on('input_data_request', namespace='/test')
def input_data_request(message):
    session['receive_count'] = session.get('receive_count', 0) + 1
    data = {'client': "webmon", 'pid': os.getpid()}
    emit('input_data_response', json.dumps(data))


# Receive data from viewers.
@socketio.on('gui_input', namespace='/test')
def gui_input(message):
    global params, updateParams
    updateParams = True
    params = message


# Background task, sends data to viewers.
@socketio.on('connect', namespace='/test')
def from_gui():
    LOGGER.info("connect")
    global thread
    with thread_lock:
        if thread is None:
            LOGGER.info("Create thread")
            thread = socketio.start_background_task(target=background_thread)


# We just have one page, but could have many.
@app.route("/viewer")
def viewer():
    return render_template("viewer.html")


def _log_to_file(path: str) -> None:
    """Log "napari.async" messages to the given file.

    Parameters
    ----------
    path : str
        Log to this file path.
    """
    try:
        # Nuke/reset log for now.
        Path(path).unlink()
    except FileNotFoundError:
        pass  # It didn't exist yet.

    fh = logging.FileHandler(path)
    LOGGER.addHandler(fh)
    LOGGER.setLevel(logging.DEBUG)
    LOGGER.info("Writing log to %s", path)


@click.command()
@click.option('--log_path', default=None, help="Path to write the log file")
def main(log_path: str) -> None:
    """Start webmon and the napari MonitorClient."""
    if log_path is not None:
        _log_to_file(log_path)

    LOGGER.info("Webmon: Starting process %d", os.getpid())

    global client
    client = create_napari_client("webmon")

    if client is None:
        print("ERROR: MonitorClient not created.")
        return

    # Start it up
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)

    # When done...
    LOGGER.info("Exiting process %s...", os.getpid())


if __name__ == "__main__":
    main()
