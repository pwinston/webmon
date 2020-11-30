//
// loader.js
//
// Vega-Lite graphs about the ChunkLoader.
//
import vegaEmbed from 'vega-embed';
import io from 'socket.io-client';

// Avoid these globals?
var load_bytes_view = null;
var load_ms_view = null;

// Avoid these globals?
var load_bytes_data = []
var load_ms_data = []

var params = null;
function defineParams() {
    params = new function () {

        this.namespace = '/test';

        const url = location.protocol + '//' + document.domain + ':' +
            location.port + this.namespace
        this.socket = io.connect(url);
    };
}

export function connectSocketInput() {
    console.log("connectSocketInput")

    document.addEventListener("DOMContentLoaded", function (event) {

        // Connect invoked when a connection with the server setup.
        params.socket.on('connect', function () {
            console.log("connect")
            params.socket.emit('connection_test', { data: 'loader.js' });
            params.socket.emit('input_data_request', { data: 'requesting data' });
        });

        params.socket.on('connection_response', function (msg) {
            console.log("connection_response:", msg);
        });

        params.socket.on('input_data_response', function (msg) {
            console.log("input_data_response", msg);
        });

        params.socket.on('send_load_data', function (msg) {
            console.log("insert data", msg)

            load_bytes_data.push({ "x": load_bytes_data.length, "y": msg.num_bytes })
            load_bytes_view.insert("table", load_bytes_data).run();

            load_ms_data.push({ "x": load_ms_data.length, "y": msg.load_ms })
            load_ms_view.insert("table", load_ms_data).run();
        });
    });
}


function showCharts() {
    const load_bytes_spec = "static/specs/load_bytes.json";
    vegaEmbed('#load_bytes', load_bytes_spec, { defaultStyle: true })
        .then(function (result) {
            load_bytes_view = result.view;
        });

    const load_ms_spec = "static/specs/load_ms.json";
    vegaEmbed('#load_ms', load_ms_spec, { defaultStyle: true })
        .then(function (result) {
            load_ms_view = result.view;
        });
}

export function startLoader() {
    console.log("startLoader");
    defineParams();
    showCharts();
    connectSocketInput();
}
