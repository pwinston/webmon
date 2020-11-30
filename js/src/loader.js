//
// loader.js
//
// Graphs about the ChunkLoader.
//
import vegaEmbed from 'vega-embed';

export function connectSocketInput() {
    console.log("connectSocketInput")

    document.addEventListener("DOMContentLoaded", function (event) {

        // Connect invoked when a connection with the server setup.
        internalParams.socket.on('connect', function () {
            console.log("connect")
            internalParams.socket.emit('connection_test', { data: 'loader.js' });
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

function showChart() {
    var spec = {
        $schema: 'https://vega.github.io/schema/vega-lite/v4.json',
        description: 'A simple bar chart with embedded data.',
        data: {
            values: [
                { a: 'A', b: 28 },
                { a: 'B', b: 55 },
                { a: 'C', b: 43 },
                { a: 'D', b: 91 },
                { a: 'E', b: 81 },
                { a: 'F', b: 53 },
                { a: 'G', b: 19 },
                { a: 'H', b: 87 },
                { a: 'I', b: 52 }
            ]
        },
        mark: 'bar',
        encoding: {
            x: { field: 'a', type: 'ordinal' },
            y: { field: 'b', type: 'quantitative' }
        }
    };
    vegaEmbed('#vis', spec, { defaultStyle: true })
        .then(function (result) {
            const view = result.view;
        }
}

export function startLoader() {
    console.log("startLoader");
    showChart();
    connectSocketInput();
}
