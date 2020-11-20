// viewer.js
//
// Proof of Concept Napari Monitor WebUI
// Modified from https://github.com/ageller/FlaskTest
//
function setParams(vars) {
	var keys = Object.keys(vars);
	keys.forEach(function (k) {
		externalParams[k] = parseFloat(vars[k])
	});
	//drawSphere()
}

function setTileConfig(msg) {
	newRows = parseInt(msg.rows);
	newCols = parseInt(msg.cols);
	if (tileConfig.rows != newRows || tileConfig.cols != newCols) {
		tileConfig.rows = newRows;
		tileConfig.cols = newCols;
		console.log("***********CREATE")
		createTiles();
	}
}

function setTileState(msg) {
	tileState.seen = msg.seen;
	drawTiles();
}

// References:
//
// https://blog.miguelgrinberg.com/post/easy-websockets-with-flask-and-gevent
// https://github.com/miguelgrinberg/Flask-SocketIO
//
function connectSocketInput() {

	document.addEventListener("DOMContentLoaded", function (event) {

		internalParams.socket.on('connect', function () {
			// Connect invoked when a connection with the server setup.
			internalParams.socket.emit('connection_test', { data: 'I\'m the viewer!' });
			internalParams.socket.emit('input_data_request', { data: 'requesting data' });
		});

		internalParams.socket.on('connection_response', function (msg) {
			console.log(msg);
		});

		internalParams.socket.on('input_data_response', function (msg) {
			console.log("data received", msg);
		});

		internalParams.socket.on('update_params', function (msg) {
			setParams(msg);
		});

		internalParams.socket.on('set_tile_config', function (msg) {
			setTileConfig(msg);
		});

		internalParams.socket.on('set_tile_state', function (msg) {
			setTileState(msg);
		});
	});
}

// Tile colors
TILE_OFF = 0xa3a2a0; // gray
TILE_ON = 0xE11313;  // red

//
// Create one tile mesh, later we toggle the color
//
function createTile(size, row, col) {
	var width = 0.4;
	var height = 0.4;
	var x = col * 0.5;
	var y = row * 0.5;
	var geometry = new THREE.PlaneGeometry(width, height);
	var material = new THREE.MeshBasicMaterial({
		color: TILE_OFF
	});
	var mesh = new THREE.Mesh(geometry, material);
	mesh.position.x = (size * width) - x;
	mesh.position.y = y;
	internalParams.scene.add(mesh);
	return mesh;
}

//
// Create all the tiles meshes, in the current grid size.
//
function createTiles() {
	// Remove all the old ones for now. Could move them around...
	tileState.tiles.forEach(function (tile) {
		internalParams.scene.remove(tile);
	})

	// Starting over with no tiles.
	tileState.tiles = [];

	var rows = tileConfig.rows;
	var cols = tileConfig.cols;
	console.log("Create tiles", rows, cols);

	// Add in order so that index = row * cols + col
	for (row = 0; row < rows; row++) {
		for (col = 0; col < cols; col++) {
			tileState.tiles.push(createTile(rows, row, col));
		}
	}
}

//
// Draw the tiles (just set the colors right now).
//
function drawTiles() {
	var rows = tileConfig.rows;
	var cols = tileConfig.cols;

	var seen_map = new Map();

	// Populate seen_map so we can set the colors based on it.
	tileState.seen.forEach(function (coords) {
		const row = parseInt(coords[0]);
		const col = parseInt(coords[1]);
		const index = row * cols + col;
		seen_map.set(index, 1);
	});

	// Set the colors of all the tiles.
	for (row = 0; row < rows; row++) {
		for (col = 0; col < cols; col++) {
			const index = row * cols + col;
			color = seen_map.has(index) ? TILE_ON : TILE_OFF;
			tileState.tiles[index].material.color.set(color);
		}
	}
}

// 
// Draw the scene. Only called on startup.
// TODO: Switch to 2D/ortho camera!
//
function drawViewer() {

	createTiles();
	drawTiles();

	var lights = [];
	lights[0] = new THREE.PointLight(0xffffff, 1, 0);

	lights[0].position.set(0, 200, 0);

	lights.forEach(function (element) {
		internalParams.scene.add(element);
	})
}

//
// Create GUI. Just one checkbox!
//
function createGUI() {
	//setParamsFromURL();  // not using this?

	internalParams.gui = new dat.GUI();
	internalParams.gui.add(externalParams, 'showGrid').onChange(sendGUIinfo);
}


function sendGUIinfo() {
	//send the information from the GUI back to the flask app, and then on to the viewer
	internalParams.socket.emit('gui_input', externalParams);

	//setURLvars() // not using this?
}

//
// Animation loop. Not using this yet?
//
function animateViewer(time) {
	requestAnimationFrame(animateViewer);
	internalParams.controls.update();
	internalParams.renderer.render(internalParams.scene, internalParams.camera);
}

//
// Called on startup.
//
function startViewer() {
	console.log("startViewer")

	defineInternalParams();
	defineExternalParams();
	defineTileState();
	defineTileConfig();

	initScene();
	createGUI();
	drawViewer();
	animateViewer();
}
