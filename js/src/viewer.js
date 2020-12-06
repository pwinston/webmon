//
// viewer.js
//
// WebGL display of which octree tiles are visible in napari, as well as
// the current view frustum. The tiles are drawn as a grid of gray
// rectangles. The view is yellow rectangle. And the one or more tiles that
// were "seen" by that view are drawn in red.
//
import * as THREE from 'three';
import { GridHelper } from 'three';

import {
	internalParams,
	defineInternalParams,
	initScene,
} from './utils.js';

const SHOW_AXES = true;  // Draw the axes (red=X green=Y).
const SHOW_TILES = true;  // Draw the tiles themselves.
const SHOW_VIEW = true;  // Draw the yellow view frustum.

// We can't (?) use a [row, col] pair as the key. Because of how Javascript
// compares lists. So we create a comma-separate string for each pair of
// coordinates, like "4,23". Kind of silly, but it works fine.
function gridKey(row, col) {
	return [row, col].join(",");
}

// Draw a border of CONTEXT_BORDER tiles around the seen tiles.
//
// The number of tiles on each level goes up quickly: 1, 4, 9, 16, 25, etc.
//
// On a big dataset the largest levels might have tens of millions of
// tiles! For performance reasons we can't draw them all. And even if we
// could they'd be too small to see. So we only draw the scene tiles
// and context border around them.
const CONTEXT_BORDER = 5;

class ViewerControls {
	constructor() {
		this.show_grid = false;
	}

	send() {
		console.log('send()', this);
		internalParams.socket.emit('send_command', this);
	}
}

var viewerControls = new ViewerControls();

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
// Return the [min, max] tile corners of the seen tiles.
//
function findCorners(seenTiles) {
	const max_int = Number.MAX_SAFE_INTEGER;
	const min_int = -Number.MAX_SAFE_INTEGER;
	var min = [max_int, max_int];
	var max = [min_int, min_int];

	seenTiles.forEach(function ([row, col]) {
		min = [
			Math.min(min[0], row),
			Math.min(min[1], col)
		];

		max = [
			Math.max(max[0], row),
			Math.max(max[1], col)
		];
	});

	return [min, max];
}

// 
// Find and store this.min and this.max corners of the seen tiles.
//
class TileCorners {
	constructor(seenTiles) {
		const corners = findCorners(seenTiles);
		this.min = corners[0];
		this.max = corners[1]
	}

	equal(other) {
		return this.min[0] == other.min[0] &&
			this.min[1] == other.min[1] &&
			this.max[0] == other.max[0] &&
			this.max[1] == other.max[1];
	}
}

//
// Stores the tiles that were seen and the corners of the seen tiles.
//
class TileState {
	constructor(message) {
		console.log("TileState message:", message);
		this.message = message;  // The message from napari.

		// seenMap so we can quickly set the colors of the tiles.
		var seenMap = new Map();

		// Find the min/max coners of the seen tiles.
		this.seenCorners = new TileCorners(this.message.seen);

		// Populate the seen map.
		this.message.seen.forEach(function (coord) {
			const key = gridKey(coord[0], coord[1]);
			seenMap.set(key, 1);
		});

		this.seenMap = seenMap;
		// console.log("seenMap = ", seenMap.size);
	};

	// Return true if this tile was seen.
	wasSeen(row, col) {
		return this.seenMap.has(gridKey(row, col));
	}

	// Return min corner of the context window as [row, col].
	getContextMin() {
		const min = tileState.seenCorners.min;

		return [
			Math.max(0, min[0] - CONTEXT_BORDER),
			Math.max(0, min[1] - CONTEXT_BORDER)
		];
	}

	// Return max corner of the context window as [row, col].
	getContextMax() {
		var rows = tileConfig.tileShape[0];
		var cols = tileConfig.tileShape[1];
		const max = tileState.seenCorners.max;

		return [
			Math.min(rows, max[0] + CONTEXT_BORDER),
			Math.min(cols, max[1] + CONTEXT_BORDER)
		];
	}

	equal(other) {
		return this.seenCorners.equal(other.seenCorners);
	}
}

//
// Graphical elements for drawing the grid.
//
class Grid {
	constructor() {
		this.tiles = new Map();
		this.view = null;
	};

	// Add a tile to the grid.
	addTile(row, col, mesh) {
		this.tiles.set(gridKey(row, col), mesh);
	}

	// Return true if this tile exits.
	exists(row, col) {
		return this.tiles.has(gridKey(row, col));
	}

	// 
	// Set the color of this tile.
	// Create the tile if it doesn't already exist.
	//
	setTileColor(row, col, color) {
		if (this.exists(row, col)) {
			this.setColor(row, col, color);
			return;
		}

		console.log("createOneTile row, col = ", row, col);
		createOneTile(row, col, color);
	}

	// Set the color of a tile. The tile must already exist.
	setColor(row, col, color) {
		const tile = this.tiles.get(gridKey(row, col));
		tile.material.color.set(color);
	}

	// Mark all our tiles as unseen.
	clearSeen() {
		this.tiles.forEach(function (tile) {
			tile.material.color.set(COLOR_TILE_OFF);
		});
	}

	// Remove all our tiles.
	removeAll() {
		this.tiles.forEach(function (tile) {
			internalParams.tileParent.remove(tile);
		})
		this.tiles = new Map();
	}

	// Update to reflect the most recent messages from the server.
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
// Server sent us some data.
//
function setTileData(msg) {
	const newState = new TileState(msg.tile_state);

	if (tileState && newState.equal(tileState)) {
		// Same state. Don't waste time and console spam.
		return;
	}

	tileState = new TileState(msg.tile_state);

	// Only create tiles if level changed. Because toggling colors is cheaper
	// then creating new tiles, so only create tiles if needed.
	if (!tileConfig || tileConfig.levelIndex != msg.tile_config['level_index']) {
		tileConfig = new TileConfig(msg.tile_config);

		if (SHOW_TILES) {
			grid.removeAll();
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
const COLOR_TILE_SEEN = 0xE11313;  // red
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
function createTileMesh(pos, size, initialColor) {

	var mesh = createRect(initialColor);
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

//
// Create a single tile for the grid.
///
function createOneTile(row, col, initialColor) {

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

	const mesh = createTileMesh(pos, size, initialColor)
	grid.addTile(row, col, mesh);
}

//
// Move the view rect to the current position/size. We move it because
// maybe it's a bit faster than create a new rect every frame?
//
function moveView() {
	const normPos = [0, 0]; //tileConfig.normPos(tileState.cornerTile);

	// Get the maxDim in base image pixels (data coordinates).
	const baseX = tileConfig.baseShape[1];
	const baseY = tileConfig.baseShape[0];
	const maxDim = Math.max(baseX, baseY);

	// Corners of the view in data coordinates.
	const corners = tileState.message.corners;
	const x0 = corners[0][1] / maxDim - normPos[1];
	const y0 = corners[0][0] / maxDim - normPos[0];
	const x1 = corners[1][1] / maxDim - normPos[1];
	const y1 = corners[1][0] / maxDim - normPos[0];

	// Width/heigh of the view.
	const width = x1 - x0;
	const height = y1 - y0;

	// The rectange position is the *center* of the rectangle. So we need
	// to offset it by half the height/width.
	const pos = [x0 + width / 2, y0 + height / 2];
	const scale = [width, height];

	moveViewRect(pos, scale)
}

//
// Move the yellow view rectangle to this location with this size.
//
function moveViewRect(pos, size) {
	grid.view.scale.set(...size);
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

	// We create/update tiles in the whole context window.
	const start = tileState.getContextMin();
	const end = tileState.getContextMax();

	// Mark every tile as not seen first. These might be far outside the
	// context window, if we've been panning around. Eventually might
	// want to "garbage collect" tiles which are far in the past.
	grid.clearSeen();

	// Iterate through every tile in the context window, creating tiles as
	// needed. Mark existing and new tiles with the right color.
	for (let row = start[0]; row < end[0]; row++) {
		for (let col = start[1]; col < end[1]; col++) {
			// For every tile in the context window, set it as seen or not
			// seen. This will create tiles if they don't exist yet. So
			// there is like this trail of created tiles as we pan around.
			const seen = tileState.wasSeen(row, col);
			const color = seen ? COLOR_TILE_SEEN : COLOR_TILE_OFF;
			grid.setTileColor(row, col, color)
		}
	}
}

//
// Have not touched this from original 3D demo, not sure what "lighting"
// we need for our 2D ortho display, if any.
//
function addLights() {
	var lights = [];
	lights[0] = new THREE.PointLight(0xffffff, 1, 0);
	lights[0].position.set(0, 200, 0);

	lights.forEach(function (element) {
		addToScene(element);
	});
}

// 
// Create the viewer on startup.
//
function createViewer() {

	// Position/scale the group so the axes are like napari. A scale of -1
	// on Y inverts that axis so +Y goes down the screen. 
	//
	// *---> X
	// |
	// Y
	//
	internalParams.group.position.y = 1;
	internalParams.group.scale.set(1, -1, 1);

	if (SHOW_VIEW) {
		grid.view = createRect(COLOR_VIEW, true);
		addToScene(grid.view);
	}

	if (SHOW_AXES)
		createAxes();

	addLights();
}

//
// Animation loop. Not using this yet? But could be useful, so just 
// leaving it here as a reference.
//
function animateViewer(time) {
	requestAnimationFrame(animateViewer);
	internalParams.controls.update();
	internalParams.renderer.render(internalParams.scene, internalParams.camera);
}

//
// Controls are HTML form controls. We hook to them.
//
function setupControls() {
	const showGrid = document.getElementById('showGrid');
	showGrid.addEventListener('change', event => {
		viewerControls.show_grid = event.target.checked;
		viewerControls.send();
	});

	const selectCar = document.getElementById('selectLoad');
	selectCar.onchange = function () {
		alert(selectCar.value);
	}
}

//
// Called on startup.
//
export function startViewer() {
	console.log("startViewer")

	defineInternalParams();

	initScene();
	setupControls();

	createViewer();
	animateViewer();

	connectSocketInput();
}
