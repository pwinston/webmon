// util.js
//
// Utilities for viewer.js
///

// We define or ortho camera to view the space [0..1], but then we zoom
// a bit so that area has a border around it.
import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
import io from 'socket.io-client';

const ZOOM = 0.8;

export var internalParams;
export function defineInternalParams() {
	internalParams = new function () {

		this.container = null;
		this.renderer = null;
		this.scene = null;
		this.group = null;
		this.tileParent = null;
		this.camera = null;

		//for frustum      
		this.zmax = 5.e10;
		this.zmin = 1;
		this.fov = 45.

		//for gui
		this.gui = null;

		//for sphere
		this.sphere;
		this.material = null;

		// Use a "/test" namespace.
		// An application can open a connection on multiple namespaces, and
		// Socket.IO will multiplex all those connections on a single
		// physical channel. If you don't care about multiple channels, you
		// can set the namespace to an empty string.
		this.namespace = '/test';
		// Connect to the Socket.IO server.
		// The connection URL has the following format:
		//     http[s]://<domain>:<port>[/<namespace>]
		this.socket = io.connect(location.protocol + '//' + document.domain + ':' + location.port + this.namespace);
	};
}

//https://html-online.com/articles/get-url-parameters-javascript/
export function getURLvars() {
	var vars = {};
	var parts = window.location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi, function (m, key, value) {
		vars[key] = value;
	});
	return vars;
}

function createCamera(aspect) {
	const height = 1;
	const width = height * aspect;
	const near = 0;
	const far = 1;

	return new THREE.OrthographicCamera(0, width, height, 0, near, far);
}

function resizeToContainer(container) {
	if (internalParams.camera) {
		internalParams.scene.remove(internalParams.camera)
	}

	const width = container.offsetWidth;
	const height = container.offsetHeight;

	// Size based on our container, not the whole screen.
	internalParams.renderer.setSize(width, height);
	const aspect = width / height;

	const camera = createCamera(aspect);
	camera.zoom = ZOOM;
	camera.updateProjectionMatrix();

	internalParams.scene.add(camera);
	internalParams.camera = camera

	internalParams.renderer.setSize(width, height);
}

function getContainer() {
	return document.getElementById('WebGLContainer');
}

//
// Initialize the Scene.
//
// This is called just once when the page is first loaded.
//
export function initScene() {

	// The WebGL Renderer.
	const renderer = new THREE.WebGLRenderer({
		antialias: true,
	});

	// Put the renderer into the DOM.
	const container = getContainer();
	container.appendChild(renderer.domElement);

	internalParams.container = container;
	internalParams.renderer = renderer;

	// The Scene object.
	internalParams.scene = new THREE.Scene();

	internalParams.group = new THREE.Group();
	internalParams.scene.add(internalParams.group);

	internalParams.tileParent = new THREE.Group();
	internalParams.group.add(internalParams.tileParent);

	resizeToContainer(container);

	const onWindowResize = () => {
		resizeToContainer(getContainer());
	}
	window.addEventListener('resize', onWindowResize, false);

	internalParams.controls = new TrackballControls(internalParams.camera, internalParams.renderer.domElement);
}
