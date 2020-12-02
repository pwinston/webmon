# webmon

Webmon is three things combined:
1. Experimental napari shared memory client.
2. A proof of concept [Flask-SocketIO](https://flask-socketio.readthedocs.io/en/latest/) webserver.
3. An example web app that contains two pages:
    * `/viewer` a three.js (WebGL) display of what tiles are visible in napari.
    * `/loader` with two very simple [Vega-Lite](https://vega.github.io/vega-lite/) graphs related to the `ChunkLoader`.

See the lengthy napari [PR 1909](https://github.com/napari/napari/pull/1909) for more information.

So there is a shared memory connection between Python and this little webmon process. And there is an always-on Websocks connection between webmon and the browser. This means napari can send out messages and the browser can receive them at 30-60Hz rate. Obviously there is some limit to the message size, but I have not explored this yet.

And beyond messages the untapped resource is creating raw shared memory buffers which can be used to back `numpy` `recarrays`. Then we could presumably shared large chunks of binary data. Although again the throughput limits are not known yet.

# Python Requirements

* Python 3.9
    * Newest shared memory features were first added in Python 3.8.
    * However 3.8 seemed to have bugs, where 3.9 works.
* In webmon directory: `pip3 install -r requirements.txt`

# Javascript Requirements

* Install node/npm
    * Not sure of min req but on MacOS I've been using:
    * `node -v` -> `v14.3.0`
    * `npm -v` -> `6.14.4`
* In webmon directory: `make build`

# To modify Javascript files

* Do not edit .js files under `static`.
    * .json files in static are fair game.
* Edit .js files under `js` then build as above.
* If Javascript only change:
   * `make build`
   * Typically hard reload (shift-command-R) in Chrome is enough.
   * Typically do not need to restart napari/webmon unless you changed those.
   
# What Can I Do?

* Improve or modify the existing webmon pages.
* Create new pages.
    * Probably need to modify napari to send over the data you care about.
    * Today probably need to modify `napari_client.py` and `webmon.py` in webmon.
    * Long term `napari-client.py` and `webmon.py` can simply pass through data.
    * Ideally only only have to change napari and then the javascript part, but we are not there yet.

# Webmon Screenshots

![tiles](https://user-images.githubusercontent.com/4163446/100827155-188b8680-342a-11eb-92bb-217321705947.png)

![graphs](https://user-images.githubusercontent.com/4163446/100827017-b763b300-3429-11eb-94c0-77c5110dc275.png)

# Python Shared Memory

* [multiprocessing.shared_memory](https://docs.python.org/3/library/multiprocessing.shared_memory.html) (official docs)
* [Python Shared Memory in Multiprocessing](https://mingze-gao.com/posts/python-shared-memory-in-multiprocessing/) (`numpy recarray`)
* [Interview With Davin Potts](https://www.vertica.com/blog/one-on-one-davin-potts-3-news-for-upcoming-python-release-3-8/) (core contributor)

![tweet](https://user-images.githubusercontent.com/4163446/100826307-090b3e00-3428-11eb-80ca-84c704b3ff5d.png)

![hn](https://user-images.githubusercontent.com/4163446/100826691-e7f71d00-3428-11eb-8438-ebca491d6f1a.png)

# Originally Based On
* [FlaskTest](https://github.com/ageller/FlaskTest)
    * A simple demo that combines Flask, Socket-IO, and three.js/WebGL
