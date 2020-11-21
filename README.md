# webmon

webmon is three things combined:
1. Experimental napari shared memory monitor client.
2. A [Flask-SocketIO](https://flask-socketio.readthedocs.io/en/latest/) webserver.
3. A very simple three.js/WebGL display of what tiles are visible in napari:

![](images/screenshot.png)

See napari [PR 1909](https://github.com/napari/napari/pull/1909) for details.

# Based On
[FlaskTest](https://github.com/ageller/FlaskTest) - combines flask, socket-io, and webgl
