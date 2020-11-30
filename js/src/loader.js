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
            bytes_data.push({ "a": "A", "b": msg.num_bytes })
            vega_view.insert("table", bytes_data).run();
        });
    });
}

function showChart() {
    var spec = {
        "$schema": "https://vega.github.io/schema/vega-lite/v4.json",
        "description": "A simple bar chart with embedded data.",
        "width": 360,
        "data": {
            "name": "table"
        },
        "mark": "bar",
        "encoding": {
            "x": { "field": "a", "type": "ordinal" },
            "y": { "field": "b", "type": "quantitative" },
            "tooltip": { "field": "b", "type": "quantitative" }
        }
    };
    vegaEmbed('#vis', spec, { defaultStyle: true })
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
