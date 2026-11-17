'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { normalizeDisplays, normalizeTiles, OSM_TILES } = require('../../lib/layout');
const { itemsOf, tileArgs } = require('../../lib/values');
const {
    TabletTiles,
    TRACK_MAX,
    distance,
    isPosition,
    parseLatLon,
    parseReport,
    thinTrack,
    addToTrack,
    configOf,
    periodOf,
    parseDataUrl,
} = require('../../lib/tablet-tiles');

const DISPLAYS = normalizeDisplays(
    {
        satellites: [{ enabled: true, name: 'Gast', host: '192.168.1.246' }],
        tablets: [{ name: 'Salon', cols: 4, rows: 3, pages: 4 }],
        pwaEnabled: true,
    },
    [],
);

/**
 * @param {object} extra - Fields of the row
 * @returns {object} A tile row on the tablet
 */
const row = extra => ({
    enabled: true,
    satellite: 'Salon',
    page: 1,
    col: 0,
    row: 0,
    size: 'l',
    type: 'map',
    state: 'gps.0.lat',
    state2: 'gps.0.lon',
    ...extra,
});

/**
 * An adapter as far as TabletTiles uses it, with the calls of one tablet link.
 *
 * @param {object} [extra] - More of it
 * @returns {any} The adapter
 */
function fakeAdapter(extra = {}) {
    const calls = [];
    const link = { ready: true, has: () => true, call: (name, data) => calls.push({ name, data }) };
    return {
        calls,
        log: { debug: () => {}, info: () => {}, warn: () => {} },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: t => clearTimeout(t),
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: t => clearInterval(t),
        links: new Map([['salon', link]]),
        config: {},
        bound: [],
        previews: new Map(),
        dataDir: '',
        withTimeout: p => p,
        ...extra,
    };
}

describe('tablet tiles: settings', () => {
    it('are left out on a satellite, and come in the sizes x and f on a tablet', () => {
        const problems = [];
        const tiles = normalizeTiles(
            [
                row({ satellite: 'Gast', size: 'q' }),
                row({ size: 'f' }),
                row({ type: 'flow', size: 'x', page: 2, state: 'pv.0.p', state2: '', state5: 'bat.0.soc' }),
            ],
            DISPLAYS,
            problems,
        );
        assert.equal(tiles.length, 2);
        assert.match(problems[0], /drawn by tablets only/);
        assert.equal(tiles[0].size, 'f');
        assert.equal(tiles[1].state5, 'bat.0.soc');
        // only a flow has a fifth state
        assert.equal(tiles[0].state5, '');
    });

    it('a map needs latitude and longitude, its tile servers {z}/{x}/{y}; a camera an address or a state', () => {
        const problems = [];
        const tiles = normalizeTiles(
            [
                row({ state2: '' }),
                row({ page: 2, url: 'https://tiles.example.org/{z}/{x}.png' }),
                row({ page: 3, type: 'camera', state: '', url: 'http://u:p@cam/latest.jpg', interval: '0' }),
                row({ page: 4, type: 'camera', state: '', url: 'ftp://cam/latest.jpg' }),
            ],
            DISPLAYS,
            problems,
        );
        assert.equal(tiles.length, 2);
        assert.ok(problems.some(p => /latitude and longitude/.test(p)));
        assert.ok(problems.some(p => /\{z\}, \{x\} and \{y\}/.test(p)));
        assert.ok(problems.some(p => /no http\(s\) URL/.test(p)));
        assert.equal(tiles[0].url, '', 'falls back to OpenStreetMap');
        assert.equal(tiles[1].type, 'camera');
        assert.equal(tiles[1].interval, 0);
        assert.equal(configOf(tiles[0]).tiles, OSM_TILES);
    });

    it('takes hours, interval, nmea and seamarks within their limits', () => {
        const [map, camera] = normalizeTiles(
            [
                row({ hours: 5000, nmea: 'nmea.0', seamarks: true }),
                row({ page: 2, type: 'camera', state: 'cam.0.url', nmea: 'nmea.0', seamarks: true }),
            ],
            DISPLAYS,
            [],
        );
        assert.equal(map.hours, 720);
        assert.equal(map.nmea, 'nmea.0');
        assert.equal(map.seamarks, true);
        assert.equal(camera.nmea, '');
        assert.equal(camera.seamarks, false);
        assert.equal(camera.interval, 5);
    });

    it('a flow has its parts at fixed places, in W and the charge in %', () => {
        const [flow] = normalizeTiles(
            [row({ type: 'flow', state: 'pv', state2: '', state3: 'grid', label3: 'Landstrom', state5: 'soc' })],
            DISPLAYS,
            [],
        );
        const items = itemsOf(flow, () => undefined, 'de');
        assert.deepEqual(
            items.map(i => [i.index, i.state, i.label, i.unit]),
            [
                [0, 'pv', '', 'W'],
                [2, 'grid', 'Landstrom', 'W'],
                [4, 'soc', '', '%'],
            ],
        );
        assert.equal(tileArgs(flow, {}, 'de').unit, '');
    });

    it('a tile_config for each of the four types', () => {
        const [map, flow, trend, camera] = normalizeTiles(
            [
                row({ seamarks: true }),
                row({ page: 2, type: 'flow', state: 'pv' }),
                row({ page: 3, type: 'trend', state: 'a', hours: 168 }),
                row({ page: 4, type: 'camera', state: '', url: 'http://cam/x.jpg', interval: 2 }),
            ],
            DISPLAYS,
            [],
        );
        assert.equal(configOf(map).seamarks, true);
        assert.equal(configOf(map).zoom, 15);
        assert.deepEqual(configOf(flow), {});
        assert.deepEqual(configOf(trend), { hours: 168 });
        assert.deepEqual(configOf(trend, '6'), { hours: 6 });
        assert.deepEqual(configOf(camera), { src: 'cam/4/0', interval: 2 }, 'the address never reaches the tablet');
    });
});

describe('tablet tiles: positions and tracks', () => {
    it('measures distances and knows a position from none', () => {
        assert.ok(Math.abs(distance(53.55, 10, 52.52, 13.4) - 255_000) < 5000);
        assert.equal(isPosition(0, 0), false);
        assert.equal(isPosition(91, 0), false);
        assert.equal(isPosition(null, 2), false);
        assert.equal(isPosition(39.5, 2.6), true);
        assert.deepEqual(parseLatLon('39.5;2.6'), { lat: 39.5, lon: 2.6 });
        assert.equal(parseLatLon(''), null);
        assert.equal(parseLatLon('0;0'), null);
    });

    it('records a point after 20 m and thins out the older half of a long track', () => {
        const points = [];
        assert.equal(addToTrack(points, 39.5, 2.6, 1), true);
        assert.equal(addToTrack(points, 39.50005, 2.6, 2), false);
        assert.equal(addToTrack(points, 39.5003, 2.6, 3), true);
        const long = Array.from({ length: TRACK_MAX + 2 }, (_v, i) => [i, 0, i]);
        const thin = thinTrack(long);
        assert.ok(thin.length < TRACK_MAX);
        assert.deepEqual(thin[thin.length - 1], long[long.length - 1], 'the newest point stays');
    });

    it('reads the AIS reports of ioBroker.nmea and leaves our own boat out', () => {
        const report = { userId: 211234567, latitude: 39.55, longitude: 2.62, cog: 365, sog: 5.1 };
        assert.deepEqual(parseReport(JSON.stringify(report), 7), {
            id: 211234567,
            lat: 39.55,
            lon: 2.62,
            cog: 5,
            sog: 5.1,
            ts: 7,
        });
        assert.equal(parseReport({ ...report, aisTransceiverInformation: 'Own information not broadcast' }, 1), null);
        assert.equal(parseReport('not json', 1), null);
        assert.equal(parseReport({ ...report, latitude: 91 }, 1), null);
    });

    it('sends the position at once, then at most every 2 s, and records the track meanwhile', async function () {
        this.timeout(5000);
        const adapter = fakeAdapter();
        const tiles = new TabletTiles(adapter);
        const [tile] = normalizeTiles([row({ state3: 'hdg' })], DISPLAYS, []);
        const b = { tile, items: [] };
        tiles.onMapValue(b, 'gps.0.lat', 39.5);
        assert.equal(adapter.calls.length, 0, 'not before the longitude');
        tiles.onMapValue(b, 'gps.0.lon', 2.6);
        tiles.onMapValue(b, 'hdg', -10);
        tiles.onMapValue(b, 'gps.0.lat', 39.501);
        const positions = adapter.calls.filter(c => c.name === 'tile_position');
        assert.equal(positions.length, 1);
        assert.deepEqual(positions[0].data, { page: 1, slot: 0, lat: 39.5, lon: 2.6, course: null, speed: null });
        assert.equal(tiles.trackOf(tile).length, 2);
        await new Promise(r => setTimeout(r, 2100));
        const later = adapter.calls.filter(c => c.name === 'tile_position');
        assert.equal(later.length, 2);
        assert.equal(later[1].data.course, 350);
        assert.equal(later[1].data.lat, 39.501);
        await tiles.stop();
    });

    it('sends the nearest AIS targets with their names, and the anchor', async () => {
        const adapter = fakeAdapter();
        const tiles = new TabletTiles(adapter);
        const [tile] = normalizeTiles([row({ nmea: 'nmea.0' })], DISPLAYS, []);
        const b = { tile, items: [] };
        tiles.nmea = ['nmea.0'];
        tiles.targets.set('nmea.0', new Map());
        const now = Date.now();
        const report = (id, lat) => ({ val: JSON.stringify({ userId: id, latitude: lat, longitude: 2.6 }), ts: now });
        assert.equal(tiles.onState('nmea.0.aisClassAPositionReport.1', report(1, 39.6), [b]), true);
        tiles.onState('nmea.0.aisClassBPositionReport.2', report(2, 39.51), [b]);
        tiles.onState('nmea.0.aisClassAStaticAndVoyageRelatedData.2', { val: '{"name":"SEA BREEZE@@@ "}' }, [b]);
        tiles.onState('nmea.0.anchorAlarm.anchorPosition', { val: '39.5;2.6' }, [b]);
        assert.equal(tiles.onState('other.0.x', { val: 1 }, [b]), false);
        tiles.onMapValue(b, 'gps.0.lat', 39.5);
        tiles.onMapValue(b, 'gps.0.lon', 2.6);
        tiles.sendTargets(b);
        const targets = adapter.calls.filter(c => c.name === 'tile_targets').pop().data.targets;
        assert.deepEqual(
            targets.map(t => [t.id, t.name]),
            [
                [2, 'SEA BREEZE'],
                [1, ''],
            ],
        );
        const anchor = adapter.calls.filter(c => c.name === 'tile_anchor').pop().data;
        assert.deepEqual(anchor, { page: 1, slot: 0, lat: 39.5, lon: 2.6, radius: 50 });
        await tiles.stop();
    });
});

describe('tablet tiles: history and cameras', () => {
    it('a trend gets the history of each series for its period', async () => {
        const asked = [];
        const adapter = fakeAdapter({
            config: { historyInstance: 'history.0' },
            sendToAsync: async (instance, command, msg) => {
                asked.push({ instance, command, hours: (msg.options.end - msg.options.start) / 3600_000 });
                return {
                    result: [
                        { ts: 1, val: 2.5 },
                        { ts: 2, val: null },
                        { ts: 3, val: '4' },
                    ],
                };
            },
        });
        const tiles = new TabletTiles(adapter);
        const [tile] = normalizeTiles([row({ type: 'trend', state: 'a', state2: 'b' })], DISPLAYS, []);
        const b = { tile, items: itemsOf(tile, () => undefined, 'en') };
        await tiles.onPeriod(b, 150);
        const series = adapter.calls.filter(c => c.name === 'tile_series');
        assert.equal(series.length, 2);
        assert.deepEqual(series[0].data, {
            page: 1,
            slot: 0,
            index: 0,
            hours: 168,
            points: [
                [1, 2.5],
                [3, 4],
            ],
        });
        assert.deepEqual(
            asked.map(a => [a.instance, a.command, a.hours]),
            [
                ['history.0', 'getHistory', 168],
                ['history.0', 'getHistory', 168],
            ],
        );
        assert.equal(periodOf(2), 1);
        assert.equal(periodOf(30), 24);
        await tiles.stop();
    });

    it('passes a picture through, with the password of its address and without showing it', async () => {
        let auth = '';
        const camera = http.createServer((req, res) => {
            auth = req.headers.authorization || '';
            if (req.url === '/page') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html></html>');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'image/jpeg' });
            res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        });
        await new Promise(r => camera.listen(0, '127.0.0.1', () => r(undefined)));
        const port = /** @type {import('node:net').AddressInfo} */ (camera.address()).port;
        const logged = [];
        const adapter = fakeAdapter({
            log: { debug: m => logged.push(m) },
            getForeignStateAsync: async () => ({ val: 'data:image/png;base64,iVBORw0KGgo=' }),
        });
        const tiles = new TabletTiles(adapter);
        const tablet = http.createServer((req, res) => {
            const [, kind] = req.url.split('/');
            const tile =
                kind === 'state'
                    ? { page: 1, slot: 0, satellite: 'salon', label: '', url: '', state: 'cam.0.url' }
                    : {
                          page: 1,
                          slot: 0,
                          satellite: 'salon',
                          label: '',
                          url: `http://user:se%40cret@127.0.0.1:${port}/${kind}`,
                          state: '',
                      };
            void tiles.serveCamera({ tile, items: [] }, 'salon', req, res, { 'X-Test': '1' });
        });
        await new Promise(r => tablet.listen(0, '127.0.0.1', () => r(undefined)));
        const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (tablet.address()).port}`;
        try {
            const picture = await fetch(`${base}/pic`);
            assert.equal(picture.status, 200);
            assert.equal(picture.headers.get('content-type'), 'image/jpeg');
            assert.equal(picture.headers.get('cache-control'), 'no-store');
            assert.equal((await picture.arrayBuffer()).byteLength, 4);
            assert.equal(auth, `Basic ${Buffer.from('user:se@cret').toString('base64')}`);

            const page = await fetch(`${base}/page`);
            assert.equal(page.status, 502, 'only pictures pass');

            const inline = await fetch(`${base}/state`);
            assert.equal(inline.headers.get('content-type'), 'image/png');
            assert.equal((await inline.arrayBuffer()).byteLength, 8);
            assert.ok(!logged.some(m => /cret|user/.test(m)), 'the address is never logged');
        } finally {
            tablet.close();
            camera.close();
        }
        assert.equal(parseDataUrl('data:text/html;base64,PGI+'), null);
    });
});
