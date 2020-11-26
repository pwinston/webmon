// util.js
//
// Utilities for viewer.js
///

// We define or ortho camera to view the space [0..1], but then we zoom
// a bit so that area has a border around it.
ZOOM = 0.8;

var externalParams;
function defineExternalParams() {
	externalParams = new function () {
		this.show_grid = false;
		this.test_command = {
			name: "fred",
			values: [1, 2, 3, 4]
		}
	};
}

var tileConfig;
function defineTileConfig() {
	tileConfig = new function () {
		this.rows = 0;
		this.cols = 0;

		// The full base image shape, might be huge like (100000, 100000).
		this.baseShape = 0;
	};
}

var tileState;
function defineTileState() {
	tileState = new function () {
		this.seen = [];
		this.corners = [[0, 0], [1, 1]];
		this.normalized = [];
		this.tiles = [];
		this.view = [];
	};
}

var internalParams;
function defineInternalParams() {
	internalParams = new function () {

		this.container = null;
		this.renderer = null;
		this.scene = null;
		this.group = null;

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
function getURLvars() {
	var vars = {};
	var parts = window.location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi, function (m, key, value) {
		vars[key] = value;
	});
	return vars;
}

function setParamsFromURL() {
	var vars = getURLvars();
	var keys = Object.keys(vars);
	keys.forEach(function (k) {
		externalParams[k] = parseFloat(vars[k])
	});
}

//this initializes everything needed for the scene
function initScene() {

	const screenWidth = window.innerWidth;
	const screenHeight = window.innerHeight;
	const aspect = screenWidth / screenHeight;

	// renderer
	internalParams.renderer = new THREE.WebGLRenderer({
		antialias: true,
	});
	internalParams.renderer.setSize(screenWidth, screenHeight);

	internalParams.container = document.getElementById('WebGLContainer');
	internalParams.container.appendChild(internalParams.renderer.domElement);

	// scene
	internalParams.scene = new THREE.Scene();


	internalParams.group = new THREE.Group();
	internalParams.scene.add(internalParams.group);

	const height = 1;
	const width = height * aspect;
	const near = 0;
	const far = 1;


	// Camera
	var camera = new THREE.OrthographicCamera(
		0, width, height, 0, near, far);
	internalParams.scene.add(camera);
	camera.zoom = ZOOM;
	camera.updateProjectionMatrix();

	internalParams.camera = camera

	// events
	THREEx.WindowResize(internalParams.renderer, internalParams.camera);

	//controls
	internalParams.controls = new THREE.TrackballControls(internalParams.camera, internalParams.renderer.domElement);
}

function setURLvars() {
	var keys = Object.keys(externalParams);
	var vars = "/gui?" //this needs to be the same as what is in flask
	keys.forEach(function (k) {
		if (k != "gui") {
			vars += k + "=" + externalParams[k] + "&";
		}
	});
	window.history.pushState("externalParams", "updated", vars);
}


