//
// loader.js
//
// Vega-Lite graphs about the ChunkLoader.
//
import vegaEmbed from 'vega-embed';
import io from 'socket.io-client';

const namespace = '/test';
const url = location.protocol + '//' + document.domain + ':' + location.port + namespace;

const params = {
    namespace,
    socket: io.connect(url),
};

// Avoid these globals?
var load_bytes_view = null;
var load_ms_view = null;

// Avoid these globals?
var load_bytes_data = []
var load_ms_data = []

params.socket.on('connect', () => {
    console.log('connect');
    params.socket.emit('connection_test', { data: 'loader.js' });
    params.socket.emit('input_data_request', { data: 'requesting data' });
});

params.socket.on('connection_response', (msg) => {
    console.log("connection_response:", msg);
});

params.socket.on('input_data_response', (msg) => {
    console.log("input_data_response", msg);
});


class VegaChart {
    constructor(view) {
        this.data = [];
        this.view = view;
    }

    push(entry) {
        this.data.push(entry);
        this.view.insert('table', this.data).run();
    }

    static async from_spec(id, spec) {
        const res = await vegaEmbed(id, spec, { defaultStyle: true });
        return new VegaChart(res.view);
    }
}

const bytes = {
    spec: 'static/specs/load_bytes.json',
    id: '#load_bytes',
    get_entry: (prev, msg) => ({ x: prev.length, y: msg.num_bytes }),
};

const load_ms = {
    spec: 'static/specs/load_ms.json',
    id: '#load_ms',
    get_entry: (prev, msg) => ({ x: prev.length, y: msg.load_ms }),
};


export async function startLoader() {
    const bytes_chart = await VegaChart.from_spec(bytes.id, bytes.spec);
    const load_ms_chart = await VegaChart.from_spec(load_ms.id, load_ms.spec);

    params.socket.on('send_load_data', (msg) => {
        console.log("insert data", msg)

        const bytes_entry = bytes.get_entry(bytes_chart.data, msg);
        bytes_chart.push(bytes_entry);

        const load_ms_entry = load_ms.get_entry(load_ms_chart.data, msg);
        load_ms_chart.push(load_ms_entry);
    });
}
