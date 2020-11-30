//
// viewer.js
//
// WebGL display of which octree tiles are visible in napari.
//
import * as THREE from 'three';
import { GUI } from 'dat.gui';

import {
	externalParams,
	defineExternalParams,
	tileConfig,
	defineTileConfig,
	tileState,
	defineTileState,
	internalParams,
	defineInternalParams,
	initScene,
} from './utils.js';

// Draw the axes (red=X green=Y).
const SHOW_AXES = true;

// Draw the tiles themselves.
const SHOW_TILES = true;

// Draw the rect depicting Napari's current view frustum.
const SHOW_VIEW = true;


function setTileConfig(config) {

	if (!config)
		return

	const newRows = parseInt(config.shape_in_tiles[0]);
	const newCols = parseInt(config.shape_in_tiles[1]);

	// Only create tiles if this is a new config, creating tiles
	// is more expensive than just updating their colors.
	if (tileConfig.rows != newRows || tileConfig.cols != newCols) {
		tileConfig.rows = newRows;
		tileConfig.cols = newCols;
		tileConfig.baseShape = config.base_shape;

		if (SHOW_TILES) {
			createTiles();
		}
	}
}

function setTileState(state) {
	if (!state)
		return

	tileState.seen = state.seen;
	tileState.corners = state.corners;
	if (SHOW_TILES) {
		updateTiles();
	}
}

//
// webmon sent us a set_tile_data message
//
function setTileData(msg) {
	console.log("setTileData", msg)
	setTileConfig(msg.tile_config)
	setTileState(msg.tile_state)
}

// References:
//
// https://blog.miguelgrinberg.com/post/easy-websockets-with-flask-and-gevent
// https://github.com/miguelgrinberg/Flask-SocketIO
//
export function connectSocketInput() {

	document.addEventListener("DOMContentLoaded", function (event) {

		// Connect invoked when a connection with the server setup.
		internalParams.socket.on('connect', function () {
			console.log("connect")
			internalParams.socket.emit('connection_test', { data: 'viewer.js' });
			internalParams.socket.emit('input_data_request', { data: 'requesting data' });
		});

		internalParams.socket.on('connection_response', function (msg) {
			console.log("connection_response:", msg);
		});

		internalParams.socket.on('input_data_response', function (msg) {
			console.log("input_data_response", msg);
		});

		internalParams.socket.on('set_tile_data', function (msg) {
			setTileData(msg);
		});
	});
}

// Tile colors
const COLOR_TILE_OFF = 0xa3a2a0; // gray
const COLOR_TILE_ON = 0xE11313;  // red
const COLOR_VIEW = 0xF5C542; // yellow

const TILE_GAP = 0.1; // fraction of the tile size

function addToScene(object) {
	internalParams.group.add(object);
}

function removeFromScene(object) {
	internalParams.group.remove(object);
}

function drawLine(start, end, color) {
	const points = [];
	points.push(new THREE.Vector2(...start));
	points.push(new THREE.Vector2(...end));
	var material = new THREE.LineBasicMaterial({
		color: color
	});

	const geometry = new THREE.BufferGeometry().setFromPoints(points);
	const line = new THREE.Line(geometry, material);
	addToScene(line);
}

function createAxes() {
	const depth = -1;
	const origin = [0, 0, depth];
	const y_axes = [0, 1, depth];
	const x_axes = [1, 0, depth];
	drawLine(origin, x_axes, 0xFF0000);
	drawLine(origin, y_axes, 0x00FF00);
}

//
// Create a 1x1 rectangle with center at (0, 0) so we can 
// scale/move it into position.
//
function createRect(rectColor, onTop = false) {

	var geometry = new THREE.PlaneGeometry(1, 1);
	var material = new THREE.MeshBasicMaterial({
		color: rectColor
	});

	if (onTop) {
		// For now we'll make onTop imply transparent...
		material.transparent = true;
		material.opacity = 0.8;
	}

	var mesh = new THREE.Mesh(geometry, material);

	if (onTop) {
		// Depth/order puts it on top.
		material.depthTest = false;
		mesh.renderOrder = 10;
	}

	// Defaults to all zeros? Lets be explicit for now.
	mesh.position.x = 0;
	mesh.position.y = 0;
	mesh.position.z = 0;

	addToScene(mesh);
	return mesh;
}


//
// Create one tile mesh, later we toggle the color
//
function createTile(row, col, tileSize) {
	var mesh = createRect(COLOR_TILE_OFF);

	const rectSize = tileSize - (TILE_GAP * tileSize);

	const scale = [rectSize, rectSize];
	mesh.scale.set(...scale);

	// Default rect is [-0.5 .. 0.5] with [0, 0] center. We move it
	// by half since we want our tile's corner to be at the given
	// coordinates.
	// 
	const half = rectSize / 2;

	mesh.position.x = col * tileSize + half;
	mesh.position.y = row * tileSize + half;

	return mesh;
}

//
// Create all the tiles meshes, in the current grid size.
//
function createTiles() {

	// Remove all the old ones for now.
	tileState.tiles.forEach(function (tile) {
		removeFromScene(tile);
	})

	// Start over with no tiles.
	tileState.tiles = [];

	var rows = tileConfig.rows
	var cols = tileConfig.cols;

	const tileSize = 1 / rows;

	console.log(`Create tiles ${rows} x ${cols}`);

	// Add in order so that index = row * cols + col
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const tile = createTile(row, col, tileSize)
			tileState.tiles.push(tile);
		}
	}
}

//
// Move the view rect to the current position/size.
//
function moveView() {
	const baseX = tileConfig.baseShape[1];
	const baseY = tileConfig.baseShape[0];

	const x0 = tileState.corners[0][1] / baseX;
	const y0 = tileState.corners[0][0] / baseY;
	const x1 = tileState.corners[1][1] / baseX;
	const y1 = tileState.corners[1][0] / baseY;

	const width = x1 - x0;
	const height = y1 - y0;

	const pos = [x0 + width / 2, y0 + height / 2];
	const scale = [width, height];

	console.log(x0, y0);

	moveViewRect(pos, scale)
}

function moveViewRect(pos, scale) {
	console.log("moveViewRect: ", pos, scale);
	tileState.view.scale.set(...scale);
	tileState.view.position.x = pos[0];
	tileState.view.position.y = pos[1];
	tileState.view.position.z = 0;
}

function updateTileColors() {
	var rows = tileConfig.rows;
	var cols = tileConfig.cols;

	var seenMap = new Map();

	// Populate seen_map so we can set the colors based on it.
	tileState.seen.forEach(function (coords) {
		const row = parseInt(coords[0]);
		const col = parseInt(coords[1]);
		const index = row * cols + col;
		seenMap.set(index, 1);
	});

	console.log("Drawing ", seenMap.size);

	// Set the colors of all the tiles.
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const index = row * cols + col;
			const color = seenMap.has(index) ? COLOR_TILE_ON : COLOR_TILE_OFF;
			tileState.tiles[index].material.color.set(color);
		}
	}
}
//
// Draw the tiles (just set the colors right now).
//
function updateTiles() {
	if (SHOW_TILES) {
		updateTileColors();
	}

	if (SHOW_VIEW)
		moveView();
}

// 
// Only called on startup, after that we modify things on the fly.
//
function createViewer() {

	internalParams.group.position.y = 1;
	internalParams.group.scale.set(1, -1, 1);


	if (SHOW_VIEW) {
		tileState.view = createRect(COLOR_VIEW, true);
	}

	if (SHOW_TILES) {
		createTiles();
	}

	if (SHOW_AXES)
		createAxes();

	var lights = [];
	lights[0] = new THREE.PointLight(0xffffff, 1, 0);
	lights[0].position.set(0, 200, 0);

	lights.forEach(function (element) {
		addToScene(element);
	});
}

//
// Create the GUI.
//
function createGUI() {
	internalParams.gui = new GUI();
	internalParams.gui.add(externalParams, 'show_grid').onChange(sendGUIinfo);
}

//
// Send the GUI settings back to Flask.
//
function sendGUIinfo() {
	console.log("send command", externalParams);
	internalParams.socket.emit('send_command', externalParams);
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
export function startViewer() {
	console.log("startViewer")

	defineInternalParams();
	defineExternalParams();

	defineTileState();
	defineTileConfig();

	initScene();
	createGUI();

	createViewer();
	animateViewer();

	connectSocketInput();
}
