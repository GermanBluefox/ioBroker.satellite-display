'use strict';

// The tiles only a tablet draws (map, flow, trend, camera) and what they need beyond tile_set and the values of their
// states: a map its track, the AIS targets and the anchor of ioBroker.nmea; a trend the history of its series; a
// camera the adapter between the tablet and the picture, so that the address of the camera (and its password) never
// reaches the tablet.
//
// To the tablet:  tile_config   {page, slot, config}                after tile_set, for these four types only
//                 tile_position {page, slot, lat, lon, course, speed}
//                 tile_track    {page, slot, points: [[lat, lon], ...]}
//                 tile_targets  {page, slot, targets: [{id, lat, lon, cog, sog, name}]}
//                 tile_anchor   {page, slot, lat, lon, radius}
//                 tile_series   {page, slot, index, hours, points: [[ms, value], ...]}
// From the tablet: the input `period` of a trend; GET /t/<key>/cam/<page>/<slot> for the picture of a camera.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { toNumber } = require('./values');
const { OSM_TILES, SEAMARK_TILES, TABLET_TYPES } = require('./layout');

/** A map gets its position at most this often */
const POSITION_MS = 2000;
/** The track gets a point when the boat moved this far from the last one (metres) */
const TRACK_STEP_M = 20;
/** Points of a track at most; beyond, its older half is thinned out */
const TRACK_MAX = 2000;
/** The AIS targets of a map at most this often, and how many */
const TARGETS_MS = 5000;
const TARGETS_MAX = 100;
/** A target whose last report is older is dropped */
const TARGET_AGE_MS = 15 * 60_000;
/** Points of a series of a trend, and how often they are read again */
const SERIES_POINTS = 300;
const SERIES_REFRESH_MS = 10 * 60_000;
/** The periods a trend may ask for (hours) */
const PERIODS = [1, 6, 24, 168, 720];
/** A picture, or the first byte of a stream, after this time at the latest */
const CAMERA_TIMEOUT_MS = 10_000;
/** Live streams of one tablet at a time */
const STREAMS_PER_TABLET = 4;
/** The tracks in the data directory of the instance, saved this often and on unload */
const TRACKS_FILE = 'tracks.json';
const SAVE_MS = 5 * 60_000;
/** Zoom a map opens with */
const MAP_ZOOM = 15;
/** The channels of ioBroker.nmea with the positions and the names of AIS targets */
const AIS_POSITIONS = ['aisClassAPositionReport', 'aisClassBPositionReport', 'aisClassBExtendedPositionReport'];
const AIS_NAMES = ['aisClassAStaticAndVoyageRelatedData', 'aisClassBStaticDataMsg24PartA'];

/**
 * @typedef {import('./layout').Tile} Tile
 * @typedef {{tile: Tile, items: import('./values').TileItem[]}} TileRef - The part of a bound tile used here
 * @typedef {{id: number, lat: number, lon: number, cog: number | null, sog: number | null, ts: number}} Target
 * @typedef {{call: (name: string, data: Record<string, unknown>) => void, ready: boolean, has: (name: string) => boolean}} Link
 */

/**
 * Distance of two positions on the earth (haversine).
 *
 * @param {number} lat1 - Latitude of the first
 * @param {number} lon1 - Longitude of the first
 * @param {number} lat2 - Latitude of the second
 * @param {number} lon2 - Longitude of the second
 * @returns {number} Metres
 */
function distance(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const a =
        Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * @param {number | null} lat - Latitude
 * @param {number | null} lon - Longitude
 * @returns {boolean} A position on the earth (0;0 is what a receiver without a fix reports)
 */
function isPosition(lat, lon) {
    return (
        lat !== null &&
        lon !== null &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180 &&
        !(Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6)
    );
}

/**
 * "lat;lon" as ioBroker.nmea writes the anchor position.
 *
 * @param {unknown} val - Value of the state
 * @returns {{lat: number, lon: number} | null} The position, null when there is none
 */
function parseLatLon(val) {
    const [a, b] = String(val ?? '').split(';');
    const lat = toNumber(a);
    const lon = toNumber(b);
    return lat !== null && lon !== null && isPosition(lat, lon) ? { lat, lon } : null;
}

/**
 * An AIS position report of ioBroker.nmea (a JSON state per MMSI).
 *
 * @param {unknown} val - Value of the state
 * @param {number} ts - Time of the state
 * @returns {Target | null} The target, null for none or for our own boat
 */
function parseReport(val, ts) {
    let r;
    try {
        r = typeof val === 'string' ? JSON.parse(val) : val;
    } catch {
        return null;
    }
    if (!r || typeof r !== 'object') {
        return null;
    }
    if (String(r.aisTransceiverInformation || '').startsWith('Own')) {
        return null;
    }
    const lat = toNumber(r.latitude);
    const lon = toNumber(r.longitude);
    const id = toNumber(r.userId);
    if (id === null || lat === null || lon === null || !isPosition(lat, lon)) {
        return null;
    }
    const cog = toNumber(r.cog);
    const sog = toNumber(r.sog);
    return {
        id,
        lat,
        lon,
        // ioBroker.nmea writes the course in degrees
        cog: cog === null ? null : ((cog % 360) + 360) % 360,
        sog,
        ts,
    };
}

/**
 * Thins out the older half of a track that grew beyond its limit: every second point there goes.
 *
 * @param {number[][]} points - [lat, lon, ms], oldest first
 * @returns {number[][]} The track
 */
function thinTrack(points) {
    if (points.length <= TRACK_MAX) {
        return points;
    }
    const half = Math.floor(points.length / 2);
    return [...points.slice(0, half).filter((_, i) => i % 2 === 0), ...points.slice(half)];
}

/**
 * Adds a position to a track when it is far enough from its last point.
 *
 * @param {number[][]} points - [lat, lon, ms], oldest first
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {number} now - Time
 * @returns {boolean} True when it was added
 */
function addToTrack(points, lat, lon, now) {
    const last = points[points.length - 1];
    if (last && distance(last[0], last[1], lat, lon) < TRACK_STEP_M) {
        return false;
    }
    points.push([Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6, now]);
    return true;
}

/**
 * @param {Tile} tile - Map tile
 * @returns {string} Key of the track of its position (tiles with the same position share one track)
 */
function trackKey(tile) {
    return `${tile.state}|${tile.state2}`;
}

/**
 * The tile_config of a tile of the four types.
 *
 * @param {Tile} tile - Tile
 * @param {string} [period] - The period a trend shows now
 * @returns {Record<string, unknown> | null} Its config, null for the other types
 */
function configOf(tile, period) {
    switch (tile.type) {
        case 'map':
            return {
                tiles: tile.url || OSM_TILES,
                seamarks: tile.seamarks,
                seamarkTiles: SEAMARK_TILES,
                zoom: MAP_ZOOM,
            };
        case 'flow':
            return {};
        case 'trend':
            return { hours: Number(period) || tile.hours };
        case 'camera':
            return { src: `cam/${tile.page}/${tile.slot}`, interval: tile.interval };
        default:
            return null;
    }
}

/**
 * The nearest period a trend offers.
 *
 * @param {number} hours - Asked for
 * @returns {number} One of PERIODS
 */
function periodOf(hours) {
    return PERIODS.reduce((best, p) => (Math.abs(p - hours) < Math.abs(best - hours) ? p : best), PERIODS[0]);
}

/**
 * A data: URL of a picture.
 *
 * @param {string} text - The URL
 * @returns {{type: string, data: Buffer} | null} Its content, null when it is none
 */
function parseDataUrl(text) {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(text);
    return m ? { type: m[1].toLowerCase(), data: Buffer.from(m[2], 'base64') } : null;
}

/**
 * @typedef {ioBroker.Adapter & {
 *   links: Map<string, Link>,
 *   bound: TileRef[],
 *   previews: Map<string, unknown>,
 *   dataDir: string,
 *   withTimeout: <T>(promise: Promise<T>, ms: number) => Promise<T>,
 * }} Host - The adapter, as far as this module uses it
 */

/** Track, AIS targets and anchor of the maps, history of the trends, pictures of the cameras. */
class TabletTiles {
    /**
     * @param {object} adapter - The adapter (main.js)
     */
    constructor(adapter) {
        /** @type {Host} */
        this.adapter = /** @type {Host} */ (adapter);
        /** @type {Map<string, number[][]>} position → track [lat, lon, ms] */
        this.tracks = new Map();
        this.tracksChanged = false;
        /** @type {WeakMap<object, {lat: number | null, lon: number | null, course: number | null, speed: number | null, timer?: ioBroker.Timeout, sent?: string}>} */
        this.positions = new WeakMap();
        /** @type {Map<string, Map<number, Target>>} nmea instance → MMSI → target */
        this.targets = new Map();
        /** @type {Map<string, string>} nmea instance → MMSI → name, as "<instance>/<mmsi>" */
        this.names = new Map();
        /** @type {Map<string, {lat: number, lon: number} | null>} nmea instance → anchor */
        this.anchors = new Map();
        /** @type {Map<string, number>} nmea instance → alarm radius */
        this.radii = new Map();
        /** @type {Map<string, ioBroker.Timeout | undefined>} nmea instance → pending timer of tile_targets */
        this.targetTimers = new Map();
        /** @type {WeakMap<object, number>} trend → period chosen on the tablet */
        this.periods = new WeakMap();
        /** @type {Map<string, number>} tablet id → open camera streams */
        this.streams = new Map();
        /** @type {Set<ioBroker.Interval | undefined>} */
        this.timers = new Set();
        /** @type {string[]} the nmea instances of the bound maps */
        this.nmea = [];
    }

    /** @returns {string} The file of the tracks */
    get tracksFile() {
        return path.join(this.adapter.dataDir || '', TRACKS_FILE);
    }

    /** Reads the tracks of the last run and starts saving and the refresh of the trends. */
    async start() {
        try {
            const data = JSON.parse(await fs.promises.readFile(this.tracksFile, 'utf8'));
            for (const [key, points] of Object.entries(data || {})) {
                if (Array.isArray(points)) {
                    this.tracks.set(
                        key,
                        points.filter(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)),
                    );
                }
            }
        } catch {
            // no tracks yet
        }
        this.every(SAVE_MS, () => this.save());
        this.every(SERIES_REFRESH_MS, () => this.refreshSeries());
    }

    /**
     * @param {number} ms - Interval
     * @param {() => unknown} fn - What to do
     */
    every(ms, fn) {
        const timer = this.adapter.setInterval(() => void fn(), ms);
        this.timers.add(timer);
    }

    /** Saves the tracks when they changed. */
    async save() {
        if (!this.tracksChanged || !this.adapter.dataDir) {
            return;
        }
        this.tracksChanged = false;
        try {
            await fs.promises.mkdir(this.adapter.dataDir, { recursive: true });
            await fs.promises.writeFile(this.tracksFile, JSON.stringify(Object.fromEntries(this.tracks)));
        } catch (e) {
            this.adapter.log.debug(`Saving the tracks failed: ${e.message}`);
        }
    }

    /** Stops the timers and saves the tracks. */
    async stop() {
        for (const timer of this.timers) {
            this.adapter.clearInterval(timer);
        }
        this.timers.clear();
        for (const timer of this.targetTimers.values()) {
            this.adapter.clearTimeout(timer);
        }
        this.targetTimers.clear();
        await this.save();
    }

    /**
     * The tiles of the settings were bound: subscribes the AIS targets and the anchor of the nmea instances their
     * maps name, and reads them once.
     *
     * @param {TileRef[]} bound - All bound tiles
     */
    async bind(bound) {
        const instances = [...new Set(bound.filter(b => b.tile.type === 'map' && b.tile.nmea).map(b => b.tile.nmea))];
        this.nmea = instances;
        for (const nmea of instances) {
            /** @type {Map<number, Target>} */
            const targets = new Map();
            this.targets.set(nmea, targets);
            for (const channel of [...AIS_POSITIONS, ...AIS_NAMES]) {
                const pattern = `${nmea}.${channel}.*`;
                await this.adapter.subscribeForeignStatesAsync(pattern);
                try {
                    const states = (await this.adapter.getForeignStatesAsync(pattern)) || {};
                    for (const [id, state] of Object.entries(states)) {
                        if (state) {
                            this.onAis(nmea, id, /** @type {ioBroker.State} */ (state));
                        }
                    }
                } catch (e) {
                    this.adapter.log.debug(`Reading ${pattern} failed: ${e.message}`);
                }
            }
            for (const id of [`${nmea}.anchorAlarm.anchorPosition`, `${nmea}.anchorAlarm.alarmRadius`]) {
                await this.adapter.subscribeForeignStatesAsync(id);
                try {
                    const state = await this.adapter.getForeignStateAsync(id);
                    if (state) {
                        this.onAnchor(nmea, id, state.val);
                    }
                } catch {
                    // no anchor alarm
                }
            }
        }
    }

    /**
     * @param {string} id - State id
     * @returns {string | null} The nmea instance whose AIS targets or anchor the state belongs to
     */
    nmeaOf(id) {
        return this.nmea.find(n => id.startsWith(`${n}.ais`) || id.startsWith(`${n}.anchorAlarm.`)) ?? null;
    }

    /**
     * A state of the AIS targets or the anchor changed.
     *
     * @param {string} id - State id
     * @param {ioBroker.State} state - New state
     * @param {TileRef[]} bound - All bound tiles
     * @returns {boolean} True when it was one of them
     */
    onState(id, state, bound) {
        const nmea = this.nmeaOf(id);
        if (!nmea) {
            return false;
        }
        if (id.startsWith(`${nmea}.anchorAlarm.`)) {
            this.onAnchor(nmea, id, state.val);
            for (const b of bound.filter(x => x.tile.type === 'map' && x.tile.nmea === nmea)) {
                this.sendAnchor(b);
            }
        } else if (this.onAis(nmea, id, state)) {
            this.scheduleTargets(nmea, bound);
        }
        return true;
    }

    /**
     * @param {string} nmea - Instance
     * @param {string} id - State id
     * @param {ioBroker.State} state - State
     * @returns {boolean} True when the targets changed
     */
    onAis(nmea, id, state) {
        const [channel, mmsi] = id.slice(nmea.length + 1).split('.');
        if (AIS_NAMES.includes(channel)) {
            let name = '';
            try {
                const data = typeof state.val === 'string' ? JSON.parse(state.val) : state.val;
                name = String(data?.name ?? '')
                    .replace(/[@\s]+$/, '')
                    .trim()
                    .slice(0, 24);
            } catch {
                return false;
            }
            const key = `${nmea}/${mmsi}`;
            if (name && this.names.get(key) !== name) {
                this.names.set(key, name);
                return this.targets.get(nmea)?.has(Number(mmsi)) ?? false;
            }
            return false;
        }
        if (!AIS_POSITIONS.includes(channel)) {
            return false;
        }
        const target = parseReport(state.val, state.ts || Date.now());
        if (!target) {
            return false;
        }
        this.targets.get(nmea)?.set(target.id, target);
        return true;
    }

    /**
     * @param {string} nmea - Instance
     * @param {string} id - State id
     * @param {unknown} val - Value
     */
    onAnchor(nmea, id, val) {
        if (id.endsWith('.alarmRadius')) {
            const r = toNumber(val);
            this.radii.set(nmea, r !== null && r > 0 ? r : 50);
        } else {
            this.anchors.set(nmea, parseLatLon(val));
        }
    }

    /**
     * Sends the targets of an instance to its maps a moment later (reports come in bursts).
     *
     * @param {string} nmea - Instance
     * @param {TileRef[]} bound - All bound tiles
     */
    scheduleTargets(nmea, bound) {
        if (this.targetTimers.has(nmea)) {
            return;
        }
        const timer = this.adapter.setTimeout(() => {
            this.targetTimers.delete(nmea);
            for (const b of bound.filter(x => x.tile.type === 'map' && x.tile.nmea === nmea)) {
                this.sendTargets(b);
            }
        }, TARGETS_MS);
        this.targetTimers.set(nmea, timer);
    }

    /**
     * @param {TileRef} b - Tile
     * @returns {Link | null} The connection of its display, when it is ready
     */
    linkOf(b) {
        const link = this.adapter.links.get(b.tile.satellite);
        return link?.ready ? link : null;
    }

    /**
     * Everything a tile of the four types needs after its tile_set (and its items): its config, the track, targets and
     * anchor of a map, the series of a trend.
     *
     * @param {Link} link - Connection of the display
     * @param {TileRef} b - Tile
     */
    async sendInitial(link, b) {
        const config = configOf(b.tile, String(this.periods.get(b) ?? ''));
        if (!config || !link.has('tile_config')) {
            return;
        }
        const { page, slot } = b.tile;
        link.call('tile_config', { page, slot, config });
        if (b.tile.type === 'map') {
            const points = this.trackOf(b.tile);
            link.call('tile_track', { page, slot, points });
            this.sendTargets(b);
            this.sendAnchor(b);
            const pos = this.positions.get(b);
            if (pos) {
                pos.sent = undefined;
            }
        } else if (b.tile.type === 'trend') {
            await this.sendSeries(b);
        }
    }

    /**
     * @param {Tile} tile - Map tile
     * @returns {number[][]} Its track as [lat, lon], within its hours
     */
    trackOf(tile) {
        const since = Date.now() - tile.hours * 3600_000;
        return (this.tracks.get(trackKey(tile)) || []).filter(p => p[2] >= since).map(p => [p[0], p[1]]);
    }

    /**
     * A state of a map changed: latitude, longitude, course or speed.
     *
     * @param {TileRef} b - Map tile
     * @param {string} id - The state
     * @param {unknown} val - Its value
     */
    onMapValue(b, id, val) {
        const { tile } = b;
        let pos = this.positions.get(b);
        if (!pos) {
            pos = { lat: null, lon: null, course: null, speed: null };
            this.positions.set(b, pos);
        }
        const n = toNumber(val);
        if (id === tile.state) {
            pos.lat = n;
        }
        if (id === tile.state2) {
            pos.lon = n;
        }
        if (id === tile.state3) {
            pos.course = n === null ? null : ((n % 360) + 360) % 360;
        }
        if (id === tile.state4) {
            pos.speed = n;
        }
        if (!isPosition(pos.lat, pos.lon)) {
            return;
        }
        const key = trackKey(tile);
        const points = this.tracks.get(key) || [];
        const now = Date.now();
        if (addToTrack(points, /** @type {number} */ (pos.lat), /** @type {number} */ (pos.lon), now)) {
            const since = now - 720 * 3600_000;
            this.tracks.set(key, thinTrack(points.filter(p => p[2] >= since)));
            this.tracksChanged = true;
        }
        if (!pos.timer) {
            const send = () => {
                pos.timer = undefined;
                this.sendPosition(b);
            };
            // the first position at once, then at most every 2 s
            if (pos.sent === undefined) {
                send();
            }
            pos.timer = this.adapter.setTimeout(send, POSITION_MS);
        }
    }

    /**
     * @param {TileRef} b - Map tile
     */
    sendPosition(b) {
        const pos = this.positions.get(b);
        const link = this.linkOf(b);
        if (!pos || !link || !isPosition(pos.lat, pos.lon)) {
            return;
        }
        const data = {
            page: b.tile.page,
            slot: b.tile.slot,
            lat: pos.lat,
            lon: pos.lon,
            course: pos.course,
            speed: pos.speed === null ? null : Math.round(pos.speed * 10) / 10,
        };
        const text = JSON.stringify(data);
        if (text !== pos.sent) {
            pos.sent = text;
            link.call('tile_position', data);
        }
    }

    /**
     * @param {TileRef} b - Map tile
     */
    sendTargets(b) {
        const link = this.linkOf(b);
        if (!link || !b.tile.nmea) {
            return;
        }
        const now = Date.now();
        const all = this.targets.get(b.tile.nmea) || new Map();
        for (const [id, t] of all) {
            if (now - t.ts > TARGET_AGE_MS) {
                all.delete(id);
            }
        }
        const pos = this.positions.get(b);
        const here = pos && isPosition(pos.lat, pos.lon) ? pos : null;
        const targets = [...all.values()]
            .map(t => ({
                id: t.id,
                lat: t.lat,
                lon: t.lon,
                cog: t.cog,
                sog: t.sog,
                name: this.names.get(`${b.tile.nmea}/${t.id}`) || '',
                d: here
                    ? distance(/** @type {number} */ (here.lat), /** @type {number} */ (here.lon), t.lat, t.lon)
                    : 0,
            }))
            .sort((x, y) => x.d - y.d)
            .slice(0, TARGETS_MAX)
            .map(({ d: _d, ...t }) => t);
        link.call('tile_targets', { page: b.tile.page, slot: b.tile.slot, targets });
    }

    /**
     * @param {TileRef} b - Map tile
     */
    sendAnchor(b) {
        const link = this.linkOf(b);
        if (!link || !b.tile.nmea) {
            return;
        }
        const anchor = this.anchors.get(b.tile.nmea);
        link.call('tile_anchor', {
            page: b.tile.page,
            slot: b.tile.slot,
            lat: anchor ? anchor.lat : null,
            lon: anchor ? anchor.lon : null,
            radius: this.radii.get(b.tile.nmea) ?? 50,
        });
    }

    /**
     * The tablet asked a trend for another period.
     *
     * @param {TileRef} b - Trend tile
     * @param {number} hours - Period
     */
    async onPeriod(b, hours) {
        this.periods.set(b, periodOf(hours));
        await this.sendSeries(b);
    }

    /** Reads the series of every trend on a connected tablet again. */
    async refreshSeries() {
        for (const b of this.adapter.bound || []) {
            if (b.tile.type === 'trend' && this.linkOf(b) && !this.adapter.previews?.has(b.tile.satellite)) {
                await this.sendSeries(b);
            }
        }
    }

    /**
     * The history of each series of a trend, from the history instance of the settings.
     *
     * @param {TileRef} b - Trend tile
     */
    async sendSeries(b) {
        const instance = String(this.adapter.config.historyInstance || '').trim();
        if (!instance) {
            return;
        }
        const hours = this.periods.get(b) ?? b.tile.hours;
        const end = Date.now();
        for (const item of b.items) {
            try {
                const answer = await this.adapter.withTimeout(
                    this.adapter.sendToAsync(instance, 'getHistory', {
                        id: item.state,
                        options: {
                            start: end - hours * 3600_000,
                            end,
                            aggregate: 'average',
                            count: SERIES_POINTS,
                            ignoreNull: true,
                            removeBorderValues: true,
                        },
                    }),
                    15_000,
                );
                const rows = /** @type {{result?: {ts?: unknown, val?: unknown}[]} | undefined} */ (answer)?.result;
                const points = (Array.isArray(rows) ? rows : [])
                    .map(r => [Number(r?.ts), toNumber(r?.val)])
                    .filter(([ts, v]) => Number.isFinite(ts) && v !== null)
                    .map(([ts, v]) => [ts, Math.round(/** @type {number} */ (v) * 1000) / 1000])
                    .slice(-SERIES_POINTS);
                this.linkOf(b)?.call('tile_series', {
                    page: b.tile.page,
                    slot: b.tile.slot,
                    index: item.index,
                    hours,
                    points,
                });
            } catch (e) {
                this.adapter.log.debug(`History of ${item.state} from ${instance}: ${e.message}`);
            }
        }
    }

    /**
     * The picture of a camera tile for its tablet: GET /t/<key>/cam/<page>/<slot>. The source is never logged, it
     * may carry a password.
     *
     * @param {TileRef} b - Camera tile
     * @param {string} tabletId - Id of the tablet that asks
     * @param {http.IncomingMessage} req - Request of the tablet
     * @param {http.ServerResponse} res - Its response
     * @param {Record<string, string>} headers - Headers of every answer
     */
    async serveCamera(b, tabletId, req, res, headers) {
        const where = `Camera ${b.tile.label || `${b.tile.page}/${b.tile.slot}`} of ${b.tile.satellite}`;
        const fail = (/** @type {number} */ status, /** @type {string} */ text) => {
            if (!res.headersSent) {
                res.writeHead(status, {
                    ...headers,
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store',
                });
            }
            res.end(text);
        };
        let source = b.tile.url;
        if (!source && b.tile.state) {
            try {
                const state = await this.adapter.getForeignStateAsync(b.tile.state);
                source = String(state?.val ?? '').trim();
            } catch {
                source = '';
            }
        }
        const inline = parseDataUrl(source);
        if (inline) {
            res.writeHead(200, {
                ...headers,
                'Content-Type': inline.type,
                'Content-Length': inline.data.length,
                'Cache-Control': 'no-store',
            });
            res.end(req.method === 'HEAD' ? undefined : inline.data);
            return;
        }
        /** @type {URL} */
        let url;
        try {
            url = new URL(source);
        } catch {
            fail(502, 'no picture address');
            return;
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            fail(502, 'no picture address');
            return;
        }
        const auth = url.username
            ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
            : undefined;
        url.username = '';
        url.password = '';
        const client = url.protocol === 'https:' ? https : http;
        let counted = false;
        const release = () => {
            if (counted) {
                counted = false;
                this.streams.set(tabletId, Math.max(0, (this.streams.get(tabletId) || 1) - 1));
            }
        };
        const upstream = client.get(
            url,
            {
                auth,
                timeout: CAMERA_TIMEOUT_MS,
                // a camera in the LAN rarely has a certificate a tablet would trust; its address is the admin's choice
                rejectUnauthorized: false,
                headers: { 'User-Agent': 'ioBroker.satellite-display' },
            },
            answer => {
                const type = String(answer.headers['content-type'] || '').toLowerCase();
                const stream = type.startsWith('multipart/x-mixed-replace');
                if (answer.statusCode !== 200 || (!stream && !type.startsWith('image/'))) {
                    answer.resume();
                    this.adapter.log.debug(`${where}: answer ${answer.statusCode} ${type || '(no type)'}`);
                    fail(502, `camera answered ${answer.statusCode}`);
                    return;
                }
                if (stream) {
                    const open = this.streams.get(tabletId) || 0;
                    if (open >= STREAMS_PER_TABLET) {
                        answer.destroy();
                        fail(503, 'too many live pictures');
                        return;
                    }
                    this.streams.set(tabletId, open + 1);
                    counted = true;
                    // a stream has no end: no timeout once it runs
                    upstream.setTimeout(0);
                }
                res.writeHead(200, {
                    ...headers,
                    'Content-Type': answer.headers['content-type'] || 'image/jpeg',
                    'Cache-Control': 'no-store',
                    ...(answer.headers['content-length'] && !stream
                        ? { 'Content-Length': answer.headers['content-length'] }
                        : {}),
                });
                answer.pipe(res);
                answer.on('end', release);
                answer.on('error', release);
            },
        );
        upstream.on('timeout', () => upstream.destroy(new Error('no answer')));
        upstream.on('error', e => {
            release();
            this.adapter.log.debug(`${where}: ${e.message}`);
            fail(502, 'camera not reachable');
        });
        // the tablet went away (page turned, app closed): the camera may stop sending
        res.on('close', () => {
            release();
            upstream.destroy();
        });
    }
}

module.exports = {
    TabletTiles,
    TABLET_TYPES,
    PERIODS,
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
};
