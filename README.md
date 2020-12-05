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

# Modify HTML

* So far we are using [tailwindcss](tailwindcss.com) which is similar to [bootstrap](getbootstrap.com) but more modern.
    * There is a VS Code extension called [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)
    * The `styles.css` file is 180,000 lines!
    * But the build includes only the styles you actually use in production.

# Modify Javascript

* Do not edit `js` files under `static`.
* Edit `js` files under the `js` directory then build as above.

# Modify Vega-Lite

* We are using [Vega-Lite](https://vega.github.io/vega-lite/) for viz.
* You can modify the `.json` files in `static/specs`.

# Going Beyond

* We just picked tailwindcss and Vega-Lite as things to try.
* Webmon can be extended to use other styles and modules as well.

# Screenshot

![](images/screenshot.png)

# Originally Based On
* [FlaskTest](https://github.com/ageller/FlaskTest)
    * A simple demo that combines Flask, Socket-IO, and three.js/WebGL
