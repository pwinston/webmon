from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit

from threading import Lock
import sys
import numpy as np

import json

from client import create_client

client = None
frame_time = 0

tile_state = {"rows": 10, "cols": 10, "seen": [[0, 0], [5, 5]]}

# some dummy data
data = [{'foo': [1, 2, 3, 4], 'fee': 'hello'}]
data_json = json.dumps(data)


app = Flask(__name__)

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
camera = None
updateCamera = False
controls = None
updateControls = False

# number of seconds between updates
seconds = 0.01

# this will pass to the viewer every "seconds"
def background_thread():
    """Example of how to send server generated events to clients."""
    global params, updateParams, camera, updateCamera, controls, updateControls
    global frame_time
    while True:
        socketio.sleep(seconds)
        if updateParams:
            print("========= params:", params)
            socketio.emit('update_params', params, namespace='/test')
        if updateCamera:
            socketio.emit('update_camera', camera, namespace='/test')
        if updateControls:
            socketio.emit('update_controls', controls, namespace='/test')

        # if client is not None:
        # frame_time = client.frame_time
        frame_time += 1
        print(f"SENDING: {frame_time}")
        frame_data = {'frame_time': frame_time}
        # frame_data_str = json.dumps(frame_data)
        socketio.emit('update_frame_time', frame_data, namespace='/test')

        socketio.emit('set_tile_state', tile_state, namespace='/test')
        updateParams = False
        updateCamera = False
        updateControls = False


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


# will receive data from gui (and print to console as a test within "from_gui")
@socketio.on('gui_input', namespace='/test')
def gui_input(message):
    global params, updateParams
    updateParams = True
    params = message
    # emit('from_gui',message)


# will receive data from camera
@socketio.on('camera_input', namespace='/test')
def camera_input(message):
    global camera, updateCamera
    updateCamera = True
    camera = message


# will receive data from controls
@socketio.on('controls_input', namespace='/test')
def controls(message):
    global controls, updateControls
    updateControls = True
    controls = message


# the background task sends data to the viewer
@socketio.on('connect', namespace='/test')
def from_gui():
    global thread
    with thread_lock:
        if thread is None:
            thread = socketio.start_background_task(target=background_thread)


@app.route("/viewer")
def viewer():
    return render_template("viewer.html")


@app.route("/gui")
def gui():
    return render_template("gui.html")


if __name__ == "__main__":
    client = create_client()
    socketio.run(app, debug=True, host='0.0.0.0', port=5005)

