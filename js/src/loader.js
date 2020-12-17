//
// loader.js
//
// Vega-Lite graphs about the ChunkLoader and other things.
//
import vegaEmbed from 'vega-embed';
import io from 'socket.io-client';
import * as vega from "vega"

const namespace = '/test';
const url = location.protocol + '//' + document.domain + ':' + location.port + namespace;

const params = {
    namespace,
    socket: io.connect(url),
};

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

const window_seconds = 10;
const gap_seconds = 0.25;

class VegaChart {
    constructor(view) {
        this.view = view;
    }

    push(entries) {
        var chart_entries = [];
        for (var entry of entries) {
            const mod_time = entry.time % window_seconds;
            chart_entries.push({ time: entry.time, x: mod_time, y: entry.value });
        }

        console.log("chart_entries", chart_entries);

        const last = chart_entries.length - 1;
        const keep_time = chart_entries[last].time - window_seconds + gap_seconds;

        this.view.change('table',
            vega.changeset().insert(chart_entries)
                .remove(entry => entry.time < keep_time)).run();
    }

    static async from_spec(id, spec) {
        const res = await vegaEmbed(id, spec, { defaultStyle: true });
        return new VegaChart(res.view, res.vega);
    }
}

const bytes = {
    spec: 'static/specs/load_bytes.json',
    id: '#load_bytes'
};

const load_ms = {
    spec: 'static/specs/load_ms.json',
    id: '#load_ms'
};

const frame_time = {
    spec: 'static/specs/frame_time.json',
    id: "#frame_time"
};

function updateCharts() {
    params.socket.emit('get_chart_data', {});
    console.log("updateCharts");
}

export async function startLoader() {
    const frame_time_chart = await VegaChart.from_spec(frame_time.id, frame_time.spec);
    const load_ms_chart = await VegaChart.from_spec(load_ms.id, load_ms.spec);
    const bytes_chart = await VegaChart.from_spec(bytes.id, bytes.spec);
    window.setInterval(updateCharts, 100);

    params.socket.on('chart_data', (msg) => {
        console.log('chart_data', msg);
        for (const key in msg) {
            switch (key) {
                case 'frame_time':
                    var entries = [];
                    for (const entry of msg.frame_time) {
                        entries.push({ time: entry.time, value: entry.delta_ms });
                    }
                    console.log("entries", entries);
                    frame_time_chart.push(entries);
                    break;
                case 'load_chunk':
                    var load_entries = [];
                    var byte_entries = [];
                    for (const entry of msg.load_chunk) {
                        load_entries.push({ time: entry.time, value: entry.load_ms });
                        byte_entries.push({ time: entry.time, value: entry.num_bytes });
                    }
                    console.log("load_entries", load_entries);
                    load_ms_chart.push(load_entries);
                    bytes_chart.push(byte_entries);
                    break;
            }
        }

        params.socket.on('napari_message', (msg) => {
            // Any messages from napari that's not chart data will come here,
            // we don't expect anything yet.
        });
    })
}
