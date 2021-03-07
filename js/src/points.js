import * as THREE from 'three';

import {
	internalParams,
	defineInternalParams,
	initScene,
} from './utils.js';

var layerData = null;

export function connectSocketInput() {

	document.addEventListener("DOMContentLoaded", function (event) {

		// Connect invoked when a connection with the server setup.
		internalParams.socket.on('connect', function () {
			console.log("connect")
			internalParams.socket.emit('connection_test', { data: 'viewer' });
			internalParams.socket.emit('input_data_request', { data: 'requesting data' });
		});

		internalParams.socket.on('connection_response', function (msg) {
			console.log("connection_response:", msg);
		});

		internalParams.socket.on('input_data_response', function (msg) {
			console.log("input_data_response", msg);
		});

		internalParams.socket.on('set_layer_data', function (msg) {
			layerData = msg;
		});
	});
}

function addToScene(object) {
	internalParams.group.add(object);
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
function createPoints() {

	// Position/scale the group so the axes are like napari. A scale of -1
	// on Y inverts that axis so +Y goes down the screen.
	//
	// *---> X
	// |
	// Y
	//
	internalParams.group.position.y = 1;
	internalParams.group.scale.set(1, -1, 1);

	addLights();
}

const pointSize = 10;

function createPoint(row, col) {
	const geometry = new THREE.CircleGeometry(pointSize, 16);
	const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.x = col;
	mesh.position.y = row;
	return mesh;
}

function findBounds(points) {
	const y = points.map(pt => pt[1]);
	const x = points.map(pt => pt[0]);
	return {
		min: { x: Math.min(...x), y: Math.min(...y) },
		max: { x: Math.max(...x), y: Math.max(...y) }
	}
}

function update(layerData) {

	if (layerData.points === undefined) {
		console.log('No points in layer data');
		return;
	}

	const parent = internalParams.group;

	while (parent.children.length > 0) {
		parent.remove(parent.children[0]);
	}

	const bounds = findBounds(layerData.points);
	const width = bounds.max.x - bounds.min.x;

	const scale = new THREE.Group();
	scale.scale.set(1 / width, 1 / width, 1);
	parent.add(scale);

	console.log(width, width);

	const translate = new THREE.Group();
	translate.position.set(-bounds.min.x, -bounds.min.y, 0);
	scale.add(translate);

	for (const point of layerData.points) {
		translate.add(createPoint(point[0], point[1]));
	}
}


//
// Animate and draw the entire scene.
//
function drawPoints(time) {
	// This will cause drawViewer() to be draw at around 60Hz.
	requestAnimationFrame(drawPoints);

	if (layerData) {
		update(layerData);
	}

	internalParams.controls.update();
	internalParams.renderer.render(internalParams.scene, internalParams.camera);
}


//
// Called on startup.
//
export function startPoints() {
	console.log("startPoints")

	defineInternalParams();

	initScene();

	createPoints();
	drawPoints();

	connectSocketInput();
}
