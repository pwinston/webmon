"""webmon

Proof of concept napari monitor client and Flask-SocketIO web server.

Current repo:
https://github.com/pwinston/webmon

1) Start socketio web server, default localhost:5000.
2) Start NapariClient which connects to napari via shared memory.

History
-------
Originally based on:
https://github.com/ageller/FlaskTest
"""
import json
import logging
import os
import sys
from pathlib import Path
from threading import Lock, get_ident
from typing import Optional

import click
import requests
from flask import Flask, render_template, session
from flask_socketio import Namespace, SocketIO, emit

from lib.numpy_json import NumpyJSON
from napari_client import NapariClient

LOGGER = logging.getLogger("webmon")

# Create the NapariClient which connects to napari. Without the client our
# Flask-SocketIO server has nothing to serve, but maybe useful as a test.
CREATE_CLIENT = True

# The reloader creates a 2nd process that watches the source files for
# changes. However from the logs it looked like this 2nd process was doing
# all the same things as the first process, creating connections, etc. And
# it was causing both processes to hang on exit.
#
# Perhaps if we got rid of globals or otherwise made it safe to
# run a 2nd process, we could turn this back on.
USE_RELOADER = False

# If true we delete the previous log file on startup. There are pros and
# cons to deleting it depending on how you are monitoring it.
DELETE_LOG_FILE = False

# The NapariClient
client = None

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'

# Specifiy eventlet just so we are all running the same thing. However
# eventlet developer says it's really intended for 100's of simultaneous
# connections! So maybe it is overkill.
#
# Note that we don't call eventlet.monkey_patch(). That causes a problem
# with SharedMemoryManager's socket:
#
# https://github.com/eventlet/eventlet/issues/670
#
# But monkey_patch() doesn't seem to be necessary. It patches various
# standard library functions to be "green" compatible.
ASYNC_MODE = "eventlet"

socketio = SocketIO(app, async_mode=ASYNC_MODE, json=NumpyJSON)

thread = None
thread_lock = Lock()

# global variables to hold the params and camera
params = None
updateParams = False

# number of seconds between updates
poll_interval_seconds = 0.01

last_frame_number = None

# Hack way to avoid spamming the viewer with duplicate data.
last_tile_data = None


def background_thread() -> None:
    """Send data to/from the viewer and napari."""
    global params, updateParams, last_json_str
    tid = get_ident()
    LOGGER.info("Webmon: background thread tid=%d", tid)

    while True:
        socketio.sleep(poll_interval_seconds)

        if client is None:
            continue

        if updateParams:
            # Post data from viewer to napari.
            LOGGER.info("Post command to napari: %s", params)
            client.post_command(params)
        updateParams = False

        # We just send the whole thing every time. We could potentially
        # only send if the data had changed since the last time
        # we sent it. To cut down the spamming viewer with repeated
        # data.
        tile_data = client.napari_data['tile_data']
        socketio.emit('set_tile_data', tile_data, namespace='/test')


class WebmonHandlers(Namespace):
    """Generic handlers right now, but will be per-page soon."""

    def on_connection_test(self, message):
        LOGGER.info("connection_test: %s", message)
        session['receive_count'] = session.get('receive_count', 0) + 1
        emit(
            'connection_response',
            {'data': message['data'], 'count': session['receive_count']},
        )

    def on_input_data_request(self, message):
        session['receive_count'] = session.get('receive_count', 0) + 1
        data = {'client': "webmon", 'pid': os.getpid()}
        emit('input_data_response', json.dumps(data))

    def on_gui_input(self, message):
        global params, updateParams
        updateParams = True
        params = message

    def on_connect(self):
        LOGGER.info("on_connect")
        global thread

        with thread_lock:
            if thread is None:
                # Only create one background task for all viewers.
                LOGGER.info("Webmon: Creating background thread...")
                thread = socketio.start_background_task(
                    target=background_thread
                )


@app.route("/viewer")
def viewer():
    """The tile viewer page."""
    return render_template("viewer.html")


@app.route("/loader")
def loader():
    """The ChunkLoader page"""
    return render_template("loader.html")


@app.route("/blank")
def blank():
    """Black page as ane example how to expand."""
    return render_template("blank.html")


@app.route("/stop")
def stop():
    """Stop the socketio server.

    The documentation says socketio.stop() "must be called from a HTTP or
    SocketIO handler function". So we have this endpoint which our
    on_shutdown() function hits. When socketio is stopped the
    socketio.run() call in main will return and the process will exit.
    """
    LOGGER.info("/stop -> stopping socketio.")
    socketio.stop()
    return "<h1>Stop</h1>Stopped socketio."


def _log_to_file(path: str) -> None:
    """Log "napari.async" messages to the given file.

    Parameters
    ----------
    path : str
        Log to this file path.
    """
    if DELETE_LOG_FILE:
        try:
            Path(path).unlink()
        except FileNotFoundError:
            pass  # It didn't exist.

    fh = logging.FileHandler(path)
    LOGGER.addHandler(fh)
    LOGGER.setLevel(logging.DEBUG)
    LOGGER.info("Writing log to %s", path)


def _log_to_console() -> None:
    """Log to console."""
    logging.basicConfig(level=logging.DEBUG)
    LOGGER.info("Logging to console.")


def _notify_stop(port: int) -> None:
    """Shutdown the web server.

    This is called when NapariClient is shutting down. It shuts down
    when it detects the napari it was connected to shuts down. So
    we call our /stop endpoint to shutdown socketio.
    """
    stop_url = f"http://localhost:{port}/stop"
    try:
        requests.get(stop_url)
    except requests.exceptions.ConnectionError:
        LOGGER.error("Webmon: requests.exceptions.ConnectionError")


def _create_napari_client(port: int):
    """Create and return the NapariClient.

    Parameters
    ----------
    port : int
        The port number of the web server.
    """
    if not CREATE_CLIENT:
        LOGGER.error("NapariClient not created, CREATE_CLIENT=False.")
        return None

    def _on_shutdown() -> None:
        """Hit endpoint /stop."""
        _notify_stop(port)

    # Create the client.
    client = NapariClient.create(_on_shutdown)

    if client is None:
        LOGGER.error("NapariClient not created, no config file?")

    return client


@click.command()
@click.option('--log_path', default=None, help="Path to write the log file")
@click.option('--port', default=5000, help="Port for HTTP server")
def main(log_path: Optional[str], port: int) -> None:
    """Start webmon and the NapariClient.

    Parameters
    log_path : Optional[str]
        If defined write the log to this path.
    port : int
        Serve HTTP at this port.
    """
    if log_path is not None:
        _log_to_file(log_path)
    else:
        _log_to_console()

    LOGGER.info("Webmon: Starting process %d", os.getpid())
    LOGGER.info("Webmon: args %s", sys.argv)
    LOGGER.info("Webmon: Serving http://localhost:%d/ ", port)

    global client
    client = _create_napari_client(port)

    socketio.on_namespace(WebmonHandlers('/test'))

    # socketio.run does not exit until our /stop endpoint is hit.
    socketio.run(
        app, debug=True, host='0.0.0.0', port=port, use_reloader=USE_RELOADER
    )

    LOGGER.info("Webmon: exiting process %s...", os.getpid())


if __name__ == "__main__":
    main()
