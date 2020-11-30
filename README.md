# webmon

See napari [PR 1909](https://github.com/napari/napari/pull/1909) for details about this repo.

**webmon** is three things combined:
1. Experimental napari shared memory monitor client.
2. A [Flask-SocketIO](https://flask-socketio.readthedocs.io/en/latest/) webserver.
3. A very simple web app that contains:
    1. A three.js (WebGL) display of what tiles are visible in napari.
    2. TBD other pages.

# Python Requirements

* pip3 install -r requirements.txt

# Build

1. Install [npm](https://www.npmjs.com/get-npm)
* `make build`

# Modify JS files

* Do not edit files under `static`.
* Edit JS files under `js` then build as above.

# Screenshot

![](images/screenshot.png)

# Originally Based On
* [FlaskTest](https://github.com/ageller/FlaskTest)
    * A simple demo that combines Flask, Socket-IO, and three.js/WebGL
