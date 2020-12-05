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
import logging
import os
import sys
from pathlib import Path
from typing import Optional

import click
import requests
from flask import Flask, render_template
from flask_socketio import SocketIO

from bridge import NapariBridge
from handlers import WebmonHandlers
from lib.logging import setup_logging
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

# Flask.
app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'

# Eventlet
# --------
# Specify eventlet just so we are all running the same thing. However
# eventlet developer says it's really intended for 100's of simultaneous
# connections! So maybe it is overkill. But what else should we use?
#
# Note that we don't call eventlet.monkey_patch(). It patches various
# standard library functions to be "green" compatible. But it causes
# a crash today with SharedMemoryManager:
#
# https://github.com/eventlet/eventlet/issues/670
#
# And monkey_patch() doesn't seem to be necessary for us?
ASYNC_MODE = "eventlet"

# Flask-SocketIO.
socketio = SocketIO(app, async_mode=ASYNC_MODE, json=NumpyJSON)

pages = [
    "viewer",
    "loader",
    "blank",
]

@app.route('/<page_name>')
def show_page(page_name):
    if page_name in pages:
        routes = [dict(href=f"/{page}", name=page.capitalize(), active=page==page_name) for page in pages]
        return render_template(f"{page_name}.html", routes=routes)

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
    setup_logging(log_path)

    LOGGER.info("Webmon: Starting process %d", os.getpid())
    LOGGER.info("Webmon: args %s", sys.argv)
    LOGGER.info("Webmon: Serving http://localhost:%d/ ", port)

    global client
    client = _create_napari_client(port)

    bridge = NapariBridge(socketio, client)

    socketio.on_namespace(WebmonHandlers(bridge, '/test'))

    # socketio.run does not exit until our /stop endpoint is hit.
    socketio.run(
        app, debug=True, host='0.0.0.0', port=port, use_reloader=USE_RELOADER
    )

    LOGGER.info("Webmon: exiting process %s...", os.getpid())


if __name__ == "__main__":
    main()
