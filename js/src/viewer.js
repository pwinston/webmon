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

class TileConfig {
	constructor(config) {
		this.config = config;  // The config from napari.

		// Pull all these out not just to change the case of the variables,
		// but because these names make more sense. We might change the
		// napari message to match.
		this.levelIndex = config.level_index;;
		this.tileSize = config.tile_size;

		this.tileShape = config.shape_in_tiles;
		this.levelShape = config.image_shape;
		this.baseShape = config.base_shape;

		this.maxLevelDim = Math.max(this.levelShape[0], this.levelShape[1]);
	}
}

// Initialize to a (1 x 1) grid of tiles, just to have something to draw
// until we get real data.
var tileConfig = new TileConfig({
	base_shape: [256, 256],
	image_shape: [256, 256],
	shape_in_tiles: [1, 1],
	tile_size: 256,
	level_index: 0
})

function setTileConfig(config) {

	if (!config)
		return

	// Only create tiles if level changed. Because toggling colors is cheaper
	// then creating new tiles, so only create if needed.
	if (!tileConfig || tileConfig.levelIndex != config['level_index']) {
		tileConfig = new TileConfig(config);

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
	//console.log("setTileData", msg)
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

// In a way the tiles are all full size with zero gaps between them,
// but we draw the tiles a bit smaller so it looks like there are gaps.
const TILE_GAP = 0.05;

function addToScene(object) {
	internalParams.group.add(object);
}

function removeFromScene(object) {
	internalParams.group.remove(object);
}

//
// Draw a single thin line. 
//
// All lines are one pixel wide. There is a line width option but docs say
// it does nothing in most renderers. And it seemed to do nothing for us.
//
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

//
// Red line for X axis which is left to right.
// Green line for Y axis which is top to bottom.
//
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

	addToScene(mesh);
	return mesh;
}

//
// Create and return one tile, a rectangular mesh. 
//
function createTile(pos, size) {

	// Start as COLOR_TILE_OFF, later in updateTileColors() we toggle it
	// between COLOR_TILE_ON and COLOR_TILE_OFF depending on whether it was
	// seen by the view.  
	var mesh = createRect(COLOR_TILE_OFF);

	// Shrink it down a bit to create a small gap between tiles.
	const rectSize = [
		size[0] - (TILE_GAP * size[0]),
		size[1] - (TILE_GAP * size[1])
	];

	// Default rect is size [-0.5 .. 0.5] with [0, 0] center. So we move it
	// by rectSize/2 since we want our tile's corner to be at the given
	// coordinates, not its center.
	mesh.position.x = pos[0] + rectSize[0] / 2;
	mesh.position.y = pos[1] + rectSize[1] / 2;

	// Scale to size it correctly.
	mesh.scale.set(...rectSize);

	return mesh;
}

//
// Create all the tiles meshes, in the current grid size.
//
function createTiles() {

	// Remove all the old ones for now, we could re-use them to minimize
	// the number of mesh creations, but does it matter?
	tileState.tiles.forEach(function (tile) {
		removeFromScene(tile);
	})

	// Start over with no tiles.
	tileState.tiles = [];

	const requestRows = tileConfig.tileShape[0];
	const requestCols = tileConfig.tileShape[1];

	console.log(`Request tiles ${requestRows} x ${requestCols}`);

	// MAX_DIM is a total hack to avoid huge grids. It takes too long to
	// create huge grids plus they are too tiny to see anyway.
	//
	// MAX_DIM totally messes things up, but it least it doesn't hang.
	const MAX_TILE_DIM = 50;

	const rows = Math.min(tileConfig.tileShape[0], MAX_TILE_DIM);
	const cols = Math.min(tileConfig.tileShape[1], MAX_TILE_DIM);
	const tileSize = tileConfig.tileSize;

	// Use longer dimension so it fits in our [0..1] space. 
	const maxLevelDim = tileConfig.maxLevelDim;

	console.log(`Create tiles ${rows} x ${cols}`);

	const levelRows = tileConfig.levelShape[0];
	const levelCols = tileConfig.levelShape[1];

	// Track tile's position in level pixels, so we know if we need a
	// partial tile at the end of a row or column.
	var x = 0;
	var y = 0;

	// Add in order so that index = row * cols + col
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {

			// Size in [0..1] coordinates. Interior tiles are always
			// (tileSize x tileSize) but edge tiles or the corner tile
			// might be smaller.
			const size = [
				Math.min(tileSize, levelCols - x) / maxLevelDim,
				Math.min(tileSize, levelRows - y) / maxLevelDim
			];

			// Position in [0..1] coordinates.
			const pos = [x / maxLevelDim, y / maxLevelDim];

			// Create and add the tile.			
			tileState.tiles.push(createTile(pos, size));
			x += tileSize;
		}

		// Starting a new row.
		x = 0;
		y += tileSize;
	}
}

//
// Move the view rect to the current position/size. We move it because
// maybe it's a bit faster than create a new rect every frame?
//
function moveView() {
	const baseX = tileConfig.baseShape[1];
	const baseY = tileConfig.baseShape[0];

	const bigger = Math.max(baseX, baseY)

	const x0 = tileState.corners[0][1] / bigger;
	const y0 = tileState.corners[0][0] / bigger;
	const x1 = tileState.corners[1][1] / bigger;
	const y1 = tileState.corners[1][0] / bigger;

	const width = x1 - x0;
	const height = y1 - y0;

	// pos is the *center* of the rectangle so offset it by half the
	// height/width.
	const pos = [x0 + width / 2, y0 + height / 2];
	const scale = [width, height];

	moveViewRect(pos, scale)
}

function moveViewRect(pos, scale) {
	//console.log("moveViewRect: ", pos, scale);
	tileState.view.scale.set(...scale);
	tileState.view.position.x = pos[0];
	tileState.view.position.y = pos[1];
	tileState.view.position.z = 0;
}

function updateTileColors() {
	var rows = tileConfig.tileShape[0];
	var cols = tileConfig.tileShape[1];

	var seenMap = new Map();

	// Populate seen_map so we can set the colors based on it.
	tileState.seen.forEach(function (coords) {
		const row = parseInt(coords[0]);
		const col = parseInt(coords[1]);
		const index = row * cols + col;
		seenMap.set(index, 1);
	});

	// Update the colors of all the tiles.
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

	if (SHOW_VIEW) {
		moveView();
	}
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

	initScene();
	createGUI();

	createViewer();
	animateViewer();

	connectSocketInput();
}
