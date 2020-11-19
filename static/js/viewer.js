

function setParams(vars) {
	var keys = Object.keys(vars);
	keys.forEach(function (k) {
		externalParams[k] = parseFloat(vars[k])
	});
	drawSphere()
}

function setTileState(msg) {
	tileState.rows = parseInt(msg.rows);
	tileState.cols = parseInt(msg.rows);
	tileState.seen = msg.seen;

	drawTiles()
}

//https://blog.miguelgrinberg.com/post/easy-websockets-with-flask-and-gevent
//https://github.com/miguelgrinberg/Flask-SocketIO
function connectSocketInput() {
	//$(document).ready(function() {
	document.addEventListener("DOMContentLoaded", function (event) {
		// Event handler for new connections.
		// The callback function is invoked when a connection with the
		// server is established.
		internalParams.socket.on('connect', function () {
			internalParams.socket.emit('connection_test', { data: 'I\'m the viewer!' });
		});
		internalParams.socket.on('connection_response', function (msg) {
			console.log(msg);
		});
		// Event handler for server sent data.
		// The callback function is invoked whenever the server emits data
		// to the client. The data is then displayed in the "Received"
		// section of the page.
		internalParams.socket.on('update_params', function (msg) {
			setParams(msg);
		});
		internalParams.socket.on('set_tile_state', function (msg) {
			setTileState(msg);
		});
		internalParams.socket.on('update_camera', function (msg) {
			internalParams.camera.position.x = msg.position.x;
			internalParams.camera.position.y = msg.position.y;
			internalParams.camera.position.z = msg.position.z;

			internalParams.camera.rotation.x = msg.rotation.x;
			internalParams.camera.rotation.y = msg.rotation.y;
			internalParams.camera.rotation.z = msg.rotation.z;

			internalParams.camera.up.x = msg.up.x;
			internalParams.camera.up.y = msg.up.y;
			internalParams.camera.up.z = msg.up.z;
		});
		internalParams.socket.on('update_controls', function (msg) {
			internalParams.controls.target.x = msg.target.x;
			internalParams.controls.target.y = msg.target.y;
			internalParams.controls.target.z = msg.target.z;
			console.log("update controls")

		});
		internalParams.socket.on('update_frame_time', function (msg) {
			//console.log(msg.frame_time);
		});
		internalParams.socket.on('tile_config', function (msg) {
			internalParams.tile_config = tile_config
			//console.log(msg.frame_time);
		});
	});
}

function drawSphere() {
	//sphere geometry
	if (internalParams.sphere != null) {
		internalParams.scene.remove(internalParams.sphere);
	}
	var geometry = new THREE.SphereGeometry(externalParams.radius, externalParams.widthSegments, externalParams.heightSegments, externalParams.phiStart, externalParams.phiLength, externalParams.thetaStart, externalParams.thetaLength)
	internalParams.sphere = new THREE.Mesh(geometry, internalParams.material);
	internalParams.scene.add(internalParams.sphere);
};

OFF = 0xa3a2a0;  // gray
ON = 0xf05956; // red


function drawRect(row, col, width, height, seen) {
	var width = 0.4;
	var height = 0.4;
	var x = col * 0.5;
	var y = row * 0.5;
	var tile_color = seen ? ON : OFF;
	var geometry = new THREE.PlaneGeometry(width, height);
	var material = new THREE.MeshBasicMaterial({
		color: tile_color
		//wireframe: true
	});
	var mesh = new THREE.Mesh(geometry, material);
	mesh.position.x = x;
	mesh.position.y = y;
	internalParams.scene.add(mesh);
}


function drawTiles() {
	var rows = tileState.rows;
	var cols = tileState.cols;

	var seen_map = new Map();
	tileState.seen.forEach(function (coords) {
		row = parseInt(coords[0]);
		col = parseInt(coords[1]);
		console.log(row, col)
		seen_map.set([row, col], 1);
	});

	for (row = 0; row < rows; row++) {
		for (col = 0; col < cols; col++) {
			var seen = seen_map.has([row, col]);
			drawRect(col, row, seen);
		}
	}
}


//this will draw the scene (with lighting)
function drawViewer() {

	//draw the sphere
	internalParams.material = new THREE.MeshPhongMaterial({ color: 0x156289, emissive: 0x072534, side: THREE.DoubleSide, flatShading: true });
	//drawSphere();
	drawTiles();
	//lights
	var lights = [];
	lights[0] = new THREE.PointLight(0xffffff, 1, 0);
	// lights[ 1 ] = new THREE.PointLight( 0xffffff, 1, 0 );
	// lights[ 2 ] = new THREE.PointLight( 0xffffff, 1, 0 );

	lights[0].position.set(0, 200, 0);
	// lights[ 1 ].position.set( 100, 200, 100 );
	// lights[ 2 ].position.set( - 100, - 200, - 100 );

	lights.forEach(function (element) {
		internalParams.scene.add(element);
	})


}


//this is the animation loop
function animateViewer(time) {
	requestAnimationFrame(animateViewer);
	internalParams.controls.update();
	internalParams.renderer.render(internalParams.scene, internalParams.camera);
}

//this is called to start everything
function startViewer() {
	console.log("startViewer version 002")
	//define the params objects
	defineInternalParams();
	defineExternalParams();
	defineTileState();

	//initialize everything related to the WebGL scene
	initScene();

	//create the UI
	//createGUI();

	//draw everything
	drawViewer();

	//begin the animation
	animateViewer();
}
