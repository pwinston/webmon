# webmon

See napari [PR 1909](https://github.com/napari/napari/pull/1909) for details about this repo.

**webmon** is three things combined:
1. Experimental napari shared memory monitor client.
2. A [Flask-SocketIO](https://flask-socketio.readthedocs.io/en/latest/) webserver.
3. A very simple web app that contains:
    1. A three.js (WebGL) display of what tiles are visible in napari.
    2. TBD other pages.

# Python Requirements

* Python 3.9
    * Newest shared memory features were first added in Python 3.8.
    * However but were found using 3.8, where 3.9 works.
* In webmon directory: `pip3 install -r requirements.txt`

# Javascript Requirements

* Install node/npm
    * Not sure of min req but on MacOS I've been using:
    * `node -v` -> `v14.3.0`
    * `npm -v` -> `6.14.4`
* In webmon directory: `make build`

# To modify JS files

* Do not edit .js files under `static`.
    * .json files in static are fair game.
* Edit .js files under `js` then build as above.
* If Javascript only change:
   * `make build`
   * Typically hard reload (shift-command-R) in Chrome is enough.
   * Typically do not need to restart napari/webmon unless you changed those.

# Screenshot

![](images/screenshot.png)

# Originally Based On
* [FlaskTest](https://github.com/ageller/FlaskTest)
    * A simple demo that combines Flask, Socket-IO, and three.js/WebGL
