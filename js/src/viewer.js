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
	internalParams,
	defineInternalParams,
	initScene,
} from './utils.js';

const SHOW_AXES = true;  // Draw the axes (red=X green=Y).
const SHOW_TILES = true;  // Draw the tiles themselves.
const SHOW_VIEW = true;  // Draw the yellow view frustum.

// MAX_TILE_SPAN is the most tiles we'll show across.
const MAX_TILE_SPAN = 4;

//
// The (rows x cols) in the current level and related information.
//
class TileConfig {
	constructor(message) {
		this.message = message;  // The config from napari.

		// Use better names. We should update napari to use these names
		// (although keep the Python word_case).
		this.levelIndex = message.level_index;;
		this.tileSize = message.tile_size;

		this.tileShape = message.shape_in_tiles;
		this.levelShape = message.image_shape;
		this.baseShape = message.base_shape;

		this.maxTileDim = Math.max(this.tileShape[0], this.tileShape[1]);
		this.maxLevelDim = Math.max(this.levelShape[0], this.levelShape[1]);
	}

	bigLevel() {
		return false;
		return this.maxTileDim > MAX_TILE_SPAN;
	}

	//
	// Return the normalized [0..1] position of this [row, col] tileCoord.
	//
	normPos(tileCoord) {
		return [
			tileCoord[0] * this.tileSize / this.maxLevelDim,
			tileCoord[1] * this.tileSize / this.maxLevelDim,
		]
	}
}

//
// Which tiles were seen and the corners (for the view).
//
class TileState {
	constructor(message) {
		this.message = message;  // The state from napari.

		// seenMap is used later on to set the colors of the tiles.
		var seenMap = new Map();

		// Compute the "corner" of the seen tiles, the lowest row/col seen.
		const max = Number.MAX_SAFE_INTEGER;
		var corner = [max, max];

		console.log("seen = ", this.message.seen);

		this.message.seen.forEach(function (coord) {
			// Map keys can't really be arrays, so use a string.
			const str = coord.join(',');
			seenMap.set(str, 1);

			corner = [
				Math.min(corner[0], coord[0]),
				Math.min(corner[1], coord[1])
			];
		});

		this.seenMap = seenMap;
		console.log("seenMap = ", seenMap.size);

		// Choose corner which is up to MAX_TILE_SPAN/2 less than the real 
		// corner. So if we draw the grid from that corner, we can see
		// the sceen tiles.
		const half = MAX_TILE_SPAN / 2;
		this.cornerTile = [
			Math.max(0, corner[0] - half),
			Math.max(0, corner[1] - half),
		];
	};
}

//
// Graphical elements for drawing the grid.
//
class Grid {
	constructor() {
		this.tiles = new Map();
		this.view = null;
	};

	update() {
		if (SHOW_TILES) {
			updateSeen();
		}

		if (SHOW_VIEW) {
			moveView();
		}
	}
}

var grid = new Grid();

// Create with defaults in case we draw before getting any data.
var tileConfig = new TileConfig({
	base_shape: [256, 256],
	image_shape: [256, 256],
	shape_in_tiles: [1, 1],
	tile_size: 256,
	level_index: null  // so we update it with the real tileConfig
});

// Create with defaults in case we draw before getting any data.
var tileState = new TileState({
	seen: [],
	corners: [[0, 0], [1, 1]]
});

//
// webmon sent us some data.
//
function setTileData(msg) {
	tileState = new TileState(msg.tile_state);

	// Only create tiles if level changed. Because toggling colors is cheaper
	// then creating new tiles, so only create tiles if needed.
	if (!tileConfig || tileConfig.levelIndex != msg.tile_config['level_index']) {
		tileConfig = new TileConfig(msg.tile_config);

		if (SHOW_TILES) {
			createTiles();
		}
	}

	if (SHOW_TILES) {
		grid.update();
	}
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

	return mesh;
}

//
// Create and return one tile, a rectangular mesh. 
//
function createTile(pos, size) {

	// Start as COLOR_TILE_OFF, later in updateSeen() we toggle it
	// between COLOR_TILE_ON and COLOR_TILE_OFF depending on whether it was
	// seen by the view.  
	var mesh = createRect(COLOR_TILE_OFF);
	internalParams.tileParent.add(mesh);

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

function createOneTile(row, col) {

	// Use longer dimension so it fits in our [0..1] space. 
	const maxLevelDim = tileConfig.maxLevelDim;

	const levelRows = tileConfig.levelShape[0];
	const levelCols = tileConfig.levelShape[1];

	const tileSize = tileConfig.tileSize;

	const posLevel = [
		row * tileSize,
		col * tileSize
	]

	// Size in [0..1] coordinates. Interior tiles are always
	// (tileSize x tileSize) but edge tiles or the corner tile
	// might be smaller.
	const size = [
		Math.min(tileSize, levelCols - posLevel[1]) / maxLevelDim,
		Math.min(tileSize, levelRows - posLevel[0]) / maxLevelDim
	];

	// Position in (x, y) [0..1] coordinates.
	const pos = [posLevel[1] / maxLevelDim, posLevel[0] / maxLevelDim];

	const row_col_str = [row, col].join(",");
	grid.tiles.set(row_col_str, createTile(pos, size));
}

//
// Create all the tile meshes.
//
function createTiles() {
	console.log("createTiles");

	// Remove all the old ones for now, we could re-use them to minimize
	// the number of mesh creations, but does it matter?
	grid.tiles.forEach(function (tile) {
		internalParams.tileParent.remove(tile);
	})

	// Start over with no tiles.
	grid.tiles = new Map();

	if (tileConfig.bigLevel()) {
		return; // nothing for now
	}

	const fullRows = tileConfig.tileShape[0];
	const fullCols = tileConfig.tileShape[1];

	console.log(`Full tile shape ${fullRows} x ${fullCols}`);

	const rows = tileConfig.tileShape[0];
	const cols = tileConfig.tileShape[1];
	const tileSize = tileConfig.tileSize;

	console.log(`Create tiles ${rows} x ${cols}`);

	const start = tileState.cornerTile;

	// Compute start to end range that surrounds the seen tiles, but
	// cuts of where it should at the whole layer boundaries.
	const end = [
		Math.min(rows, start[0] + MAX_TILE_SPAN),
		Math.min(cols, start[1] + MAX_TILE_SPAN)
	]

	// Create tiles in this area. For small levels this will be the entire level,
	// for large levels this will be at most a [-MAX_TILE_DIM..MAX_TILE_DIM]
	// region.
	for (let row = start[0]; row < end[0]; row++) {
		for (let col = start[1]; col < end[1]; col++) {
			createOneTile(row, col);
		}
	}
}

//
// Move the view rect to the current position/size. We move it because
// maybe it's a bit faster than create a new rect every frame?
//
function moveView() {
	const normPos = [0, 0]; //tileConfig.normPos(tileState.cornerTile);

	const baseX = tileConfig.baseShape[1];
	const baseY = tileConfig.baseShape[0];

	const maxDim = Math.max(baseX, baseY);

	const corners = tileState.message.corners;
	const x0 = corners[0][1] / maxDim - normPos[1];
	const y0 = corners[0][0] / maxDim - normPos[0];
	const x1 = corners[1][1] / maxDim - normPos[1];
	const y1 = corners[1][0] / maxDim - normPos[0];

	const width = x1 - x0;
	const height = y1 - y0;

	// pos is the *center* of the rectangle so offset it by half the
	// height/width.
	const pos = [x0 + width / 2, y0 + height / 2];
	const scale = [width, height];

	moveViewRect(pos, scale)
}

function moveViewRect(pos, scale) {
	grid.view.scale.set(...scale);
	grid.view.position.x = pos[0];
	grid.view.position.y = pos[1];
	grid.view.position.z = 0;
}

//
// Update the color of all tiles. Red if seen, otherwise gray.
//
function updateSeen() {
	// Experimental: move the entire grid to the corner location.
	// const normPos = tileConfig.normPos(tileState.cornerTile)
	// internalParams.tileParent.position.x = -normPos[1];
	//internalParams.tileParent.position.y = -normPos[0];

	if (tileConfig.bigLevel()) {
		return;
	}

	var rows = tileConfig.tileShape[0];
	var cols = tileConfig.tileShape[1];

	const start = tileState.cornerTile;

	// Compute start to end range that surrounds the seen tiles, but
	// cuts off where it should at the boundaries of the level.
	const end = [
		Math.min(rows, start[0] + MAX_TILE_SPAN),
		Math.min(cols, start[1] + MAX_TILE_SPAN)
	]

	// Mark every tiles that exists not seen first.
	grid.tiles.forEach(function (tile) {
		tile.material.color.set(COLOR_TILE_OFF);
	});

	// Mark seen tiles as seen, creating tiles if needed.
	for (const [row_col_str, value] of tileState.seenMap.entries()) {
		if (!grid.tiles.has(row_col_str)) {
			// Okay this is stilly to split, fix this.
			const parts = row_col_str.split(",");
			const row = parseInt(parts[0]);
			const col = parseInt(parts[1]);
			createOneTile(row, col);
		}
		grid.tiles.get(row_col_str).material.color.set(COLOR_TILE_ON);
	}
}

// 
// Only called on startup, after that we modify things on the fly.
//
function createViewer() {

	internalParams.group.position.y = 1;
	internalParams.group.scale.set(1, -1, 1);


	if (SHOW_VIEW) {
		console.log("createView");
		grid.view = createRect(COLOR_VIEW, true);
		addToScene(grid.view);
		//internalParams.tileParent.add(grid.view);
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

	initScene();
	createGUI();

	createViewer();
	animateViewer();

	connectSocketInput();
}
