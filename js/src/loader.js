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

const window_size_seconds = 10;
const time_gap_seconds = 0.25;

class VegaChart {
    constructor(view) {
        this.view = view;
        this.start_time = null;
    }

    push(time, value) {
        if (this.start_time === null) {
            this.start_time = time;
        }
        const relative_time = time - this.start_time;
        const mod_time = relative_time % window_size_seconds;
        const oldest_time = relative_time - window_size_seconds + time_gap_seconds;
        const entry = { time: relative_time, x: mod_time, y: value };

        this.view.change('table',
            vega.changeset().insert(entry)
                .remove(entry => entry.time < oldest_time)).run();
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


export async function startLoader() {
    const bytes_chart = await VegaChart.from_spec(bytes.id, bytes.spec);
    const load_ms_chart = await VegaChart.from_spec(load_ms.id, load_ms.spec);
    const frame_time_chart = await VegaChart.from_spec(frame_time.id, frame_time.spec);

    params.socket.on('napari_message', (msg) => {
        if ('load' in msg) {
            const time = msg.load.time;
            bytes_chart.push(time, msg.load.num_bytes);
            load_ms_chart.push(time, msg.load.load_ms);
        } else if ('frame_time' in msg) {
            const time = msg.frame_time.time
            frame_time_chart.push(time, msg.frame_time.delta_ms);
        }
    });
}
