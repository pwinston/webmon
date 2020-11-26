"""webmon

Proof of concept napari monitor client and Flask-SocketIO web server.

We start up MonitorClient to monitor napari's shared memory. When it
sees new information we push it out to any connected web browsers.

Modified from https://github.com/ageller/FlaskTest
"""
import os
import json
import logging
from threading import Lock
from pathlib import Path

import click
from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit

from napari_client import create_napari_client

LOGGER = logging.getLogger("webmon")

app = Flask(__name__)

client = None

# Set this variable to "threading", "eventlet" or "gevent" to test the
# different async modes, or leave it set to None for the application to choose
# the best option based on installed packages.
async_mode = None

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, async_mode=async_mode)
thread = None
thread_lock = Lock()

# global variables to hold the params and camera
params = None
updateParams = False

# number of seconds between updates
poll_interval_seconds = 0.01

last_frame_number = None


def background_thread() -> None:
    """Send data to/from the viewer and napari."""
    global params, updateParams
    while True:
        socketio.sleep(poll_interval_seconds)

        if client is None:
            continue  # Still starting up?

        if updateParams:
            # Post data from viewer to napari.
            client.post_command(params)

        if client.napari_data_new:
            # Set new napari data to viewer
            data = client.napari_data
            data_len = len(client.last_json_str)
            LOGGER.info("Emit set_tile_data: %d chars", data_len)
            socketio.emit('set_tile_data', data, namespace='/test')

        updateParams = False
        client.napari_data_new = False


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
    global thread
    with thread_lock:
        if thread is None:
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
        print("ERROR: no napari client was created")
        return

    # Start it up
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)


if __name__ == "__main__":
    main()
