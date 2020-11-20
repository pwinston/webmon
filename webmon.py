""" webmon.py

Proof of concept napari monitor client and Flask-SocketIO web server.

We start up MonitorClient to monitor napari's shared memory. When it
sees new information we push it out to any connected web browsers.

Modified from https://github.com/ageller/FlaskTest
"""
import json
from threading import Lock

from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit

from napari_client import create_napari_client

app = Flask(__name__)

napari_client = None

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
seconds = 0.01

next_tile_update = 0.0
tile_update_rate = 1.0

last_frame_number = None

# some dummy data
data = [{'foo': [1, 2, 3, 4], 'fee': 'hello'}]
data_json = json.dumps(data)


def _send_to_viewer(client):

    socketio.emit('set_tile_config', client.tile_config, namespace='/test')
    print(json.dumps(client.tile_config))
    socketio.emit('set_tile_state', client.tile_state, namespace='/test')
    print(json.dumps(client.tile_state))


# this will pass to the viewer every "seconds"
def background_thread():
    """Example of how to send server generated events to clients."""
    global params, updateParams
    while True:
        socketio.sleep(seconds)
        if updateParams and napari_client is not None:
            napari_client.set_params(params)

        global last_frame_number
        if napari_client.frame_number != last_frame_number:
            _send_to_viewer(napari_client)
            last_frame_number = napari_client.frame_number

        updateParams = False


# testing the connection
@socketio.on('connection_test', namespace='/test')
def connection_test(message):
    session['receive_count'] = session.get('receive_count', 0) + 1
    emit(
        'connection_response',
        {'data': message['data'], 'count': session['receive_count']},
    )


# sending data
@socketio.on('input_data_request', namespace='/test')
def input_data_request(message):
    session['receive_count'] = session.get('receive_count', 0) + 1
    emit('input_data_response', data_json)


# Receive data from viewers.
@socketio.on('gui_input', namespace='/test')
def gui_input(message):
    print("gui_input received:")
    print(message)

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


@app.route("/viewer")
def viewer():
    return render_template("viewer.html")


if __name__ == "__main__":
    print("************************MAIN")
    napari_client = create_napari_client()
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)

