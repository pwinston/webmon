//
// loader.js
//
// Graphs about the ChunkLoader.
//
import vegaEmbed from 'vega-embed';
import io from 'socket.io-client';

var vega_view = null;

var bytes_data = []

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
            bytes_data.push({ "x": bytes_data.length, "y": msg.num_bytes })
            vega_view.insert("table", bytes_data).run();
        });
    });
}

const chartSpec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v4.json",
    "height": 200,
    "padding": 50,
    "data": { "name": "table" },
    "mark": "area",
    "encoding": {
        "x": { "field": "x", "type": "quantitative" },
        "y": { "field": "y", "type": "quantitative" }
    }
}


function showChart() {
    vegaEmbed('#vis', chartSpec, { defaultStyle: true })
        .then(function (result) {
            vega_view = result.view;
        });
}

export function startLoader() {
    console.log("startLoader");
    defineParams();
    showChart();
    connectSocketInput();
}
