/* Tiles on a tablet: the web app of ioBroker.satellite-display.
 *
 * It does what the tile pages of the satellite firmware do (docs/TILES.md of the firmware): the adapter sends the
 * layout and the values as the actions tile_set, tile_value ... over a WebSocket, a touch goes back as an input.
 * The access key comes in the link from the settings (?key=...) and is kept in the browser.
 */
'use strict';

(() => {
    const ICONS = self.TILE_ICONS || {};
    const LOCK_PATH = ICONS.lock || '';
    const VERSION = '1';
    /** After this long without a touch the first page comes back (the firmware goes back to its clock) */
    const IDLE_MS = 60_000;
    /** A thermostat sends its new target this long after the last press of - / + (as the firmware) */
    const SETPOINT_DELAY_MS = 1000;
    /** Wrong PINs in a row before the keypad waits */
    const MAX_WRONG = 5;
    const WAIT_MS = 60_000;
    /** Points a chart keeps */
    const CHART_POINTS = 60;
    /** Icons of map, flow and camera beyond those of the firmware (Material Design Icons 7.4.47, Apache License 2.0) */
    const EXTRA_ICONS = {
        'transmission-tower':
            'M8.28,5.45L6.5,4.55L7.76,2H16.23L17.5,4.55L15.72,5.44L15,4H9L8.28,5.45M18.62,8H14.09L13.3,5H10.7L9.91,8H5.38L4.1,10.55L5.89,11.44L6.62,10H17.38L18.1,11.45L19.89,10.56L18.62,8M17.77,22H15.7L15.46,21.1L12,15.9L8.53,21.1L8.3,22H6.23L9.12,11H11.19L10.83,12.35L12,14.1L13.16,12.35L12.81,11H14.88L17.77,22M11.4,15L10.5,13.65L9.32,18.13L11.4,15M14.68,18.12L13.5,13.64L12.6,15L14.68,18.12Z',
        'home-lightning-bolt': 'M12 3L2 12H5V20H19V12H22L12 3M11.5 18V14H9L12.5 7V11H15L11.5 18Z',
        'crosshairs-gps':
            'M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M3.05,13H1V11H3.05C3.5,6.83 6.83,3.5 11,3.05V1H13V3.05C17.17,3.5 20.5,6.83 20.95,11H23V13H20.95C20.5,17.17 17.17,20.5 13,20.95V23H11V20.95C6.83,20.5 3.5,17.17 3.05,13M12,5A7,7 0 0,0 5,12A7,7 0 0,0 12,19A7,7 0 0,0 19,12A7,7 0 0,0 12,5Z',
        'camera-off':
            'M1.2,4.47L2.5,3.2L20,20.72L18.73,22L16.73,20H4A2,2 0 0,1 2,18V6C2,5.78 2.04,5.57 2.1,5.37L1.2,4.47M7,4L9,2H15L17,4H20A2,2 0 0,1 22,6V18C22,18.6 21.74,19.13 21.32,19.5L16.33,14.5C16.76,13.77 17,12.91 17,12A5,5 0 0,0 12,7C11.09,7 10.23,7.24 9.5,7.67L5.82,4H7M7,12A5,5 0 0,0 12,17C12.5,17 13.03,16.92 13.5,16.77L11.72,15C10.29,14.85 9.15,13.71 9,12.28L7.23,10.5C7.08,10.97 7,11.5 7,12M12,9A3,3 0 0,1 15,12C15,12.35 14.94,12.69 14.83,13L11,9.17C11.31,9.06 11.65,9 12,9Z',
        plus: 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z',
        minus: 'M19,13H5V11H19V13Z',
    };

    // ---- texts -------------------------------------------------------------------------------------------------

    const TEXTS = {
        en: {
            outdated:
                'This link is out of date: the tablet was removed in the settings or got a new link. Open its current link (settings, tab Tablets).',
            connecting: 'Connecting…',
            noKey: 'Open the link of this tablet from the settings of satellite-display (tab Tablets).',
            refused:
                'No connection. Is the link still the one from the settings (tab Tablets), and does the adapter run?',
            wrong: 'Wrong PIN',
            wait: 'Too many wrong PINs, wait {s} s',
            empty: 'No tiles yet: add them in the tile editor of the adapter, or ask your AI agent.',
            lock: 'Lock',
            page: 'Page {n}',
            replaced: 'This tablet is open in another window. Tap here to show it in this one.',
            noPosition: 'No position',
            noPicture: 'No picture',
            solar: 'Solar',
            battery: 'Battery',
            grid: 'Grid',
            use: 'Consumption',
        },
        de: {
            outdated:
                'Dieser Link ist veraltet: das Tablet wurde in den Einstellungen entfernt oder hat einen neuen Link. Öffne seinen aktuellen Link (Einstellungen, Reiter Tablets).',
            connecting: 'Verbinde…',
            noKey: 'Öffne den Link dieses Tablets aus den Einstellungen von satellite-display (Reiter Tablets).',
            refused:
                'Keine Verbindung. Ist der Link noch der aus den Einstellungen (Reiter Tablets), und läuft der Adapter?',
            wrong: 'Falsche PIN',
            wait: 'Zu viele falsche PINs, warte {s} s',
            empty: 'Noch keine Kacheln: im Kachel-Editor des Adapters anlegen oder den KI-Agenten bitten.',
            lock: 'Sperren',
            page: 'Seite {n}',
            replaced: 'Dieses Tablet ist in einem anderen Fenster geöffnet. Hier tippen, um es in diesem zu zeigen.',
            noPosition: 'Keine Position',
            noPicture: 'Kein Bild',
            solar: 'Solar',
            battery: 'Batterie',
            grid: 'Netz',
            use: 'Verbrauch',
        },
        ru: {
            outdated:
                'Эта ссылка устарела: планшет удалён в настройках или получил новую ссылку. Откройте его актуальную ссылку (настройки, вкладка Tablets).',
            connecting: 'Подключение…',
            noKey: 'Откройте ссылку этого планшета из настроек satellite-display (вкладка Tablets).',
            refused: 'Нет связи. Ссылка всё ещё та, что в настройках (вкладка Tablets), и адаптер запущен?',
            wrong: 'Неверный PIN',
            wait: 'Слишком много неверных PIN, подождите {s} с',
            empty: 'Плиток пока нет: добавьте их в редакторе плиток адаптера или попросите ИИ-агента.',
            lock: 'Заблокировать',
            page: 'Страница {n}',
            replaced: 'Этот планшет открыт в другом окне. Коснитесь здесь, чтобы показать его в этом.',
            noPosition: 'Нет позиции',
            noPicture: 'Нет изображения',
            solar: 'Солнце',
            battery: 'Батарея',
            grid: 'Сеть',
            use: 'Потребление',
        },
        pt: {
            outdated:
                'Esta ligação está desatualizada: o tablet foi removido nas definições ou recebeu uma nova ligação. Abra a ligação atual (definições, separador Tablets).',
            connecting: 'A ligar…',
            noKey: 'Abra a ligação deste tablet a partir das definições do satellite-display (separador Tablets).',
            refused: 'Sem ligação. A ligação ainda é a das definições (separador Tablets) e o adaptador está a correr?',
            wrong: 'PIN errado',
            wait: 'Demasiados PIN errados, aguarde {s} s',
            empty: 'Ainda sem mosaicos: adicione-os no editor de mosaicos do adaptador ou peça ao seu agente de IA.',
            lock: 'Bloquear',
            page: 'Página {n}',
            replaced: 'Este tablet está aberto noutra janela. Toque aqui para o mostrar nesta.',
            noPosition: 'Sem posição',
            noPicture: 'Sem imagem',
            solar: 'Solar',
            battery: 'Bateria',
            grid: 'Rede',
            use: 'Consumo',
        },
        nl: {
            outdated:
                'Deze link is verouderd: de tablet is in de instellingen verwijderd of heeft een nieuwe link. Open de huidige link (instellingen, tabblad Tablets).',
            connecting: 'Verbinden…',
            noKey: 'Open de link van deze tablet uit de instellingen van satellite-display (tabblad Tablets).',
            refused: 'Geen verbinding. Is de link nog die uit de instellingen (tabblad Tablets), en draait de adapter?',
            wrong: 'Verkeerde pincode',
            wait: 'Te veel verkeerde pincodes, wacht {s} s',
            empty: 'Nog geen tegels: voeg ze toe in de tegeleditor van de adapter of vraag het je AI-agent.',
            lock: 'Vergrendelen',
            page: 'Pagina {n}',
            replaced: 'Deze tablet is in een ander venster geopend. Tik hier om hem in dit venster te tonen.',
            noPosition: 'Geen positie',
            noPicture: 'Geen beeld',
            solar: 'Zon',
            battery: 'Accu',
            grid: 'Net',
            use: 'Verbruik',
        },
        fr: {
            outdated:
                'Ce lien est périmé : la tablette a été supprimée dans les paramètres ou a reçu un nouveau lien. Ouvrez son lien actuel (paramètres, onglet Tablets).',
            connecting: 'Connexion…',
            noKey: 'Ouvrez le lien de cette tablette depuis les paramètres de satellite-display (onglet Tablets).',
            refused:
                "Pas de connexion. Le lien est-il toujours celui des paramètres (onglet Tablets), et l'adaptateur tourne-t-il ?",
            wrong: 'PIN incorrect',
            wait: 'Trop de PIN incorrects, attendez {s} s',
            empty: "Pas encore de tuiles : ajoutez-les dans l'éditeur de tuiles de l'adaptateur ou demandez à votre agent IA.",
            lock: 'Verrouiller',
            page: 'Page {n}',
            replaced: 'Cette tablette est ouverte dans une autre fenêtre. Touchez ici pour l’afficher dans celle-ci.',
            noPosition: 'Pas de position',
            noPicture: 'Pas d’image',
            solar: 'Solaire',
            battery: 'Batterie',
            grid: 'Réseau',
            use: 'Consommation',
        },
        it: {
            outdated:
                'Questo link è scaduto: il tablet è stato rimosso nelle impostazioni o ha ricevuto un nuovo link. Apri il suo link attuale (impostazioni, scheda Tablets).',
            connecting: 'Connessione…',
            noKey: 'Apri il link di questo tablet dalle impostazioni di satellite-display (scheda Tablets).',
            refused:
                "Nessuna connessione. Il link è ancora quello delle impostazioni (scheda Tablets) e l'adattatore è in esecuzione?",
            wrong: 'PIN errato',
            wait: 'Troppi PIN errati, attendi {s} s',
            empty: "Ancora nessun riquadro: aggiungili nell'editor dei riquadri dell'adattatore o chiedi al tuo agente IA.",
            lock: 'Blocca',
            page: 'Pagina {n}',
            replaced: 'Questo tablet è aperto in un’altra finestra. Tocca qui per mostrarlo in questa.',
            noPosition: 'Nessuna posizione',
            noPicture: 'Nessuna immagine',
            solar: 'Solare',
            battery: 'Batteria',
            grid: 'Rete',
            use: 'Consumo',
        },
        es: {
            outdated:
                'Este enlace está desactualizado: la tableta se eliminó en los ajustes o recibió un enlace nuevo. Abre su enlace actual (ajustes, pestaña Tablets).',
            connecting: 'Conectando…',
            noKey: 'Abre el enlace de esta tableta desde los ajustes de satellite-display (pestaña Tablets).',
            refused:
                '¿Sin conexión? ¿El enlace sigue siendo el de los ajustes (pestaña Tablets) y el adaptador está en marcha?',
            wrong: 'PIN incorrecto',
            wait: 'Demasiados PIN incorrectos, espera {s} s',
            empty: 'Aún no hay mosaicos: añádelos en el editor de mosaicos del adaptador o pídeselo a tu agente de IA.',
            lock: 'Bloquear',
            page: 'Página {n}',
            replaced: 'Esta tableta está abierta en otra ventana. Toca aquí para mostrarla en esta.',
            noPosition: 'Sin posición',
            noPicture: 'Sin imagen',
            solar: 'Solar',
            battery: 'Batería',
            grid: 'Red',
            use: 'Consumo',
        },
        pl: {
            outdated:
                'Ten link jest nieaktualny: tablet usunięto w ustawieniach albo dostał nowy link. Otwórz jego aktualny link (ustawienia, karta Tablets).',
            connecting: 'Łączenie…',
            noKey: 'Otwórz link tego tabletu z ustawień satellite-display (karta Tablets).',
            refused: 'Brak połączenia. Czy link to nadal ten z ustawień (karta Tablets) i czy adapter działa?',
            wrong: 'Błędny PIN',
            wait: 'Za dużo błędnych PIN-ów, poczekaj {s} s',
            empty: 'Brak kafelków: dodaj je w edytorze kafelków adaptera albo poproś agenta AI.',
            lock: 'Zablokuj',
            page: 'Strona {n}',
            replaced: 'Ten tablet jest otwarty w innym oknie. Dotknij tutaj, aby pokazać go w tym.',
            noPosition: 'Brak pozycji',
            noPicture: 'Brak obrazu',
            solar: 'Słońce',
            battery: 'Bateria',
            grid: 'Sieć',
            use: 'Zużycie',
        },
        uk: {
            outdated:
                'Це посилання застаріло: планшет видалено в налаштуваннях або він отримав нове посилання. Відкрийте його актуальне посилання (налаштування, вкладка Tablets).',
            connecting: 'Підключення…',
            noKey: 'Відкрийте посилання цього планшета з налаштувань satellite-display (вкладка Tablets).',
            refused: 'Немає зв’язку. Посилання все ще те, що в налаштуваннях (вкладка Tablets), і адаптер запущено?',
            wrong: 'Неправильний PIN',
            wait: 'Забагато неправильних PIN, зачекайте {s} с',
            empty: 'Плиток поки немає: додайте їх у редакторі плиток адаптера або попросіть ШІ-агента.',
            lock: 'Заблокувати',
            page: 'Сторінка {n}',
            replaced: 'Цей планшет відкрито в іншому вікні. Торкніться тут, щоб показати його в цьому.',
            noPosition: 'Немає позиції',
            noPicture: 'Немає зображення',
            solar: 'Сонце',
            battery: 'Батарея',
            grid: 'Мережа',
            use: 'Споживання',
        },
        'zh-cn': {
            outdated:
                '此链接已过期：该平板电脑已在设置中删除或获得了新链接。请打开它的当前链接（设置，Tablets 选项卡）。',
            connecting: '正在连接…',
            noKey: '请从 satellite-display 的设置（Tablets 选项卡）中打开此平板电脑的链接。',
            refused: '无连接。链接是否仍是设置（Tablets 选项卡）中的链接，适配器是否在运行？',
            wrong: 'PIN 错误',
            wait: 'PIN 错误次数过多，请等待 {s} 秒',
            empty: '还没有磁贴：在适配器的磁贴编辑器中添加，或请你的 AI 代理添加。',
            lock: '锁定',
            page: '第 {n} 页',
            replaced: '此平板电脑已在另一个窗口中打开。点按此处在此窗口中显示。',
            noPosition: '无位置',
            noPicture: '无图像',
            solar: '太阳能',
            battery: '电池',
            grid: '电网',
            use: '用电',
        },
    };
    const lang = (() => {
        const l = String(navigator.language || 'en').toLowerCase();
        if (l.startsWith('zh')) {
            return 'zh-cn';
        }
        const base = l.split('-')[0];
        return TEXTS[base] ? base : 'en';
    })();
    const t = (key, vars = {}) =>
        String(TEXTS[lang][key] || TEXTS.en[key]).replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ''));
    document.documentElement.lang = lang;

    // ---- SHA-256 (the PIN is checked here, also over plain HTTP where crypto.subtle is missing) ----------------

    const K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
        0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
        0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
        0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
        0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
        0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ]);

    /**
     * @param {string} text - Text
     * @returns {string} SHA-256 of its UTF-8 bytes, 64 hex digits
     */
    function sha256(text) {
        const bytes = new TextEncoder().encode(text);
        const len = bytes.length;
        const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
        for (let i = 0; i < len; i++) {
            words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
        }
        words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
        words[words.length - 1] = len * 8;
        const h = new Uint32Array([
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
        ]);
        const w = new Uint32Array(64);
        const rotr = (x, n) => (x >>> n) | (x << (32 - n));
        for (let off = 0; off < words.length; off += 16) {
            for (let i = 0; i < 64; i++) {
                if (i < 16) {
                    w[i] = words[off + i];
                } else {
                    const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                    const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
                }
            }
            let [a, b, c, d, e, f, g, hh] = h;
            for (let i = 0; i < 64; i++) {
                const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
                const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                hh = g;
                g = f;
                f = e;
                e = (d + t1) | 0;
                d = c;
                c = b;
                b = a;
                a = (t1 + t2) | 0;
            }
            h[0] += a;
            h[1] += b;
            h[2] += c;
            h[3] += d;
            h[4] += e;
            h[5] += f;
            h[6] += g;
            h[7] += hh;
        }
        return Array.from(h, x => x.toString(16).padStart(8, '0')).join('');
    }

    // ---- elements and helpers ----------------------------------------------------------------------------------

    const $ = id => document.getElementById(id);
    const pagesEl = $('pages');
    const noticeEl = $('notice');
    $('lockIcon').setAttribute('d', LOCK_PATH);
    $('padLockIcon').setAttribute('d', LOCK_PATH);
    $('lockButton').setAttribute('aria-label', t('lock'));

    /**
     * @param {string} tag - Element
     * @param {string} [cls] - Class names
     * @param {string} [text] - Text
     * @returns {HTMLElement} The element
     */
    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) {
            e.className = cls;
        }
        if (text !== undefined) {
            e.textContent = text;
        }
        return e;
    }

    const SVG = 'http://www.w3.org/2000/svg';
    /**
     * @param {string} tag - SVG element
     * @param {Record<string, string | number>} attrs - Attributes
     * @returns {SVGElement} The element
     */
    function svg(tag, attrs = {}) {
        const e = document.createElementNS(SVG, tag);
        for (const [k, v] of Object.entries(attrs)) {
            e.setAttribute(k, String(v));
        }
        return e;
    }

    /**
     * @param {string} name - Icon of the firmware list
     * @returns {SVGElement | null} The icon, null when unknown
     */
    function iconEl(name) {
        const key = String(name || '').replace(/^mdi:/, '');
        const d = ICONS[key] || EXTRA_ICONS[key];
        if (!d) {
            return null;
        }
        const s = svg('svg', { viewBox: '0 0 24 24', class: 'icon' });
        s.appendChild(svg('path', { d }));
        return s;
    }

    /**
     * @param {number} color - 0xRRGGBB, 0 = none
     * @returns {string} CSS colour, '' for none
     */
    const cssColor = color => (color > 0 ? `#${(color & 0xffffff).toString(16).padStart(6, '0')}` : '');

    const formats = new Map();
    /**
     * @param {number} value - Number
     * @param {number} decimals - Decimals 0-3
     * @returns {string} The number in the language of the tablet
     */
    function fmt(value, decimals) {
        const d = Math.max(0, Math.min(3, Number(decimals) || 0));
        if (!formats.has(d)) {
            formats.set(
                d,
                new Intl.NumberFormat(navigator.language, { minimumFractionDigits: d, maximumFractionDigits: d }),
            );
        }
        return formats.get(d).format(value);
    }

    // ---- the tiles ---------------------------------------------------------------------------------------------

    /** @type {{cols: number, rows: number, pages: number}} */
    let grid = { cols: 4, rows: 3, pages: 4 };
    /** @type {Map<string, any>} "page/slot" → tile */
    const tiles = new Map();
    let renderQueued = false;
    /** @type {WebSocket | null} */
    let ws = null;

    const SIZES = { s: [1, 1], q: [1, 2], w: [2, 1], l: [2, 2], x: [3, 2], f: [4, 3] };
    /** The types with items (tile_item): a flow has five (solar, battery, grid, consumption, charge) */
    const ITEM_TYPES = ['group', 'level', 'battery', 'flow', 'trend'];
    const keyOf = (page, slot) => `${page}/${slot}`;

    /**
     * Sends a touch to the adapter.
     *
     * @param {any} tile - Tile
     * @param {string} input - switch, level, press or setpoint
     * @param {number} value - Its value
     */
    function sendInput(tile, input, value) {
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'input', page: tile.page, slot: tile.slot, input, value }));
        }
    }

    /** Builds the pages again after the layout changed (once per batch of tile_set). */
    function queueRender() {
        if (!renderQueued) {
            renderQueued = true;
            requestAnimationFrame(render);
        }
    }

    function render() {
        renderQueued = false;
        const current = currentPage();
        pagesEl.textContent = '';
        const used = [...new Set([...tiles.values()].map(x => x.page))].sort((a, b) => a - b);
        if (!used.length) {
            if (ws && ws.readyState === 1 && configured) {
                showNotice(t('empty'));
            }
        } else if (noticeEl.dataset.kind === 'empty') {
            hideNotice();
        }
        for (const page of used) {
            const p = el('section', 'page');
            p.dataset.page = String(page);
            p.style.gridTemplateColumns = `repeat(${grid.cols}, 1fr)`;
            p.style.gridTemplateRows = `repeat(${grid.rows}, 1fr)`;
            for (const tile of [...tiles.values()].filter(x => x.page === page)) {
                p.appendChild(build(tile));
                update(tile);
            }
            pagesEl.appendChild(p);
        }
        drawDots();
        const back = used.indexOf(current);
        if (back > 0) {
            pagesEl.scrollLeft = back * pagesEl.clientWidth;
        }
        drawTitle();
        for (const tile of tiles.values()) {
            if (tile.map) {
                drawMapSoon(tile);
            }
        }
        syncCameras();
    }

    /**
     * The DOM of a tile from its tile_set.
     *
     * @param {any} tile - Tile
     * @returns {HTMLElement} Its element
     */
    function build(tile) {
        const a = tile.args;
        const [w, h] = SIZES[a.size] || [1, 1];
        // value, bar, chart, switch and status go into one line when the tile is flat (the CSS decides by its shape)
        const rowable = ['value', 'bar', 'chart', 'switch', 'status'].includes(a.type);
        const e = el('div', `tile ${a.type} size-${a.size}${a.size === 'q' ? ' square' : ''}`);
        e.style.gridColumn = `${a.col + 1} / span ${w}`;
        e.style.gridRow = `${a.row + 1} / span ${h}`;
        const b = e.appendChild(el('div', `body${rowable ? ' rowable' : ''}`));
        tile.el = e;
        tile.parts = {};
        tile.observer?.disconnect();
        tile.observer = null;

        const head = el('div', 'head');
        const icon = iconEl(a.icon);
        if (icon && !(a.type === 'switch' && a.size === 'q')) {
            head.appendChild(icon);
        }
        if (a.label) {
            head.appendChild(el('span', 'label', a.label));
        }

        switch (a.type) {
            case 'value': {
                b.appendChild(head);
                tile.parts.value = b.appendChild(el('div', 'value', '–'));
                break;
            }
            case 'bar': {
                b.appendChild(head);
                tile.parts.value = b.appendChild(el('div', 'value', '–'));
                const bar = b.appendChild(el('div', 'meter'));
                tile.parts.fill = bar.appendChild(el('i'));
                break;
            }
            case 'chart': {
                b.appendChild(head);
                tile.parts.value = b.appendChild(el('div', 'value', '–'));
                const s = svg('svg', { class: 'chart', viewBox: '0 0 100 100', preserveAspectRatio: 'none' });
                tile.parts.line = s.appendChild(svg('polyline', { points: '' }));
                b.appendChild(s);
                break;
            }
            case 'gauge':
            case 'thermostat': {
                b.appendChild(head);
                const s = svg('svg', { class: 'arc', viewBox: '0 0 100 82' });
                const d = 'M 18.2 71.8 A 40 40 0 1 1 81.8 71.8';
                s.appendChild(
                    svg('path', {
                        d,
                        class: 'track',
                        fill: 'none',
                        'stroke-width': 9,
                        'stroke-linecap': 'round',
                        pathLength: 100,
                    }),
                );
                tile.parts.arc = s.appendChild(
                    svg('path', {
                        d,
                        class: 'fill',
                        fill: 'none',
                        'stroke-width': 9,
                        'stroke-linecap': 'round',
                        pathLength: 100,
                        'stroke-dasharray': '0 100',
                    }),
                );
                tile.parts.arcText = s.appendChild(svg('text', { x: 50, y: 52, 'font-size': 17 }));
                tile.parts.arcText.textContent = '–';
                b.appendChild(s);
                if (a.type === 'thermostat') {
                    const sp = b.appendChild(el('div', 'setpoint'));
                    const minus = sp.appendChild(el('button', '', '−'));
                    tile.parts.target = sp.appendChild(el('span', 'target', '–'));
                    const plus = sp.appendChild(el('button', '', '+'));
                    minus.addEventListener('click', ev => stepSetpoint(ev, tile, -1));
                    plus.addEventListener('click', ev => stepSetpoint(ev, tile, 1));
                    tile.parts.relay = b.appendChild(el('i', 'relay hidden'));
                }
                break;
            }
            case 'switch': {
                e.classList.add('touch');
                if (a.size === 'q' && icon) {
                    b.appendChild(icon);
                }
                b.appendChild(head);
                tile.parts.toggle = b.appendChild(el('div', 'toggle'));
                e.addEventListener('click', () => {
                    tile.on = !tile.on;
                    update(tile);
                    sendInput(tile, 'switch', tile.on ? 1 : 0);
                });
                break;
            }
            case 'dimmer': {
                const top = el('div', 'head');
                top.append(...head.childNodes);
                tile.parts.toggle = el('div', 'toggle');
                tile.parts.toggle.style.marginLeft = 'auto';
                top.appendChild(tile.parts.toggle);
                b.appendChild(top);
                const r = b.appendChild(el('div', 'dimmerRow'));
                const input = /** @type {HTMLInputElement} */ (el('input', 'level'));
                input.type = 'range';
                input.min = '0';
                input.max = '100';
                input.step = '1';
                tile.parts.level = r.appendChild(input);
                tile.parts.percent = r.appendChild(el('span', 'percent', '–'));
                tile.parts.toggle.addEventListener('click', () => {
                    tile.on = !tile.on;
                    update(tile);
                    sendInput(tile, 'switch', tile.on ? 1 : 0);
                });
                input.addEventListener('input', () => {
                    tile.dragging = true;
                    tile.value = Number(input.value);
                    update(tile);
                });
                // sent once when it is released, as the firmware does
                input.addEventListener('change', () => {
                    tile.dragging = false;
                    tile.value = Number(input.value);
                    tile.on = tile.value > 0;
                    update(tile);
                    sendInput(tile, 'level', tile.value);
                });
                break;
            }
            case 'button': {
                e.classList.add('touch');
                if (icon) {
                    b.appendChild(icon);
                }
                if (a.label) {
                    b.appendChild(el('span', 'label', a.label));
                }
                e.addEventListener('click', () => {
                    e.classList.add('pressed');
                    setTimeout(() => e.classList.remove('pressed'), 180);
                    sendInput(tile, 'press', 1);
                });
                break;
            }
            case 'status': {
                // read-only: the icon lights up while on
                b.appendChild(head);
                tile.parts.value = b.appendChild(el('div', 'value', '–'));
                break;
            }
            case 'group': {
                // the title is the name of the tile; without one the rows take the whole tile
                if (a.label || icon) {
                    b.appendChild(head);
                }
                tile.parts.items = b.appendChild(el('div', 'items'));
                tile.itemsDrawn = '';
                break;
            }
            case 'level': {
                b.appendChild(head);
                const row = b.appendChild(el('div', 'gaugeRow'));
                const tank = row.appendChild(el('div', 'tank'));
                tile.parts.fill = tank.appendChild(el('i'));
                // marks at a quarter, a half and three quarters, as on a tank gauge
                for (const at of [25, 50, 75]) {
                    tank.appendChild(el('b')).style.bottom = `${at}%`;
                }
                const readout = row.appendChild(el('div', 'readout'));
                tile.parts.value = readout.appendChild(el('div', 'value', '–'));
                tile.parts.amount = readout.appendChild(el('div', 'amount'));
                break;
            }
            case 'battery': {
                b.appendChild(head);
                const row = b.appendChild(el('div', 'gaugeRow'));
                const battery = row.appendChild(el('div', 'batt'));
                const cell = battery.appendChild(el('div', 'cell'));
                tile.parts.fill = cell.appendChild(el('i'));
                battery.appendChild(el('b', 'cap'));
                const bolt = iconEl('flash');
                if (bolt) {
                    bolt.classList.add('bolt');
                    tile.parts.bolt = cell.appendChild(bolt);
                }
                const readout = row.appendChild(el('div', 'readout'));
                tile.parts.value = readout.appendChild(el('div', 'value', '–'));
                tile.parts.amount = readout.appendChild(el('div', 'amount'));
                break;
            }
            case 'map': {
                // the map fills the tile; a head line only with a name (it then carries the speed)
                b.classList.add('flush');
                if (a.label || icon) {
                    b.appendChild(head);
                    tile.parts.speed = head.appendChild(el('span', 'speed hidden'));
                }
                b.appendChild(mapElement(tile));
                break;
            }
            case 'flow': {
                if (a.label || icon) {
                    b.appendChild(head);
                }
                tile.parts.flow = b.appendChild(svg('svg', { class: 'flow' }));
                tile.flowShape = '';
                observeSize(tile, tile.parts.flow);
                break;
            }
            case 'trend': {
                const top = b.appendChild(el('div', 'head'));
                if (icon) {
                    top.appendChild(icon);
                }
                if (a.label) {
                    top.appendChild(el('span', 'label', a.label));
                }
                tile.parts.legend = top.appendChild(el('span', 'legend'));
                // the periods need two columns; the shortest only three
                if (w >= 2) {
                    const chips = top.appendChild(el('span', 'chips'));
                    tile.parts.chips = PERIODS.filter(hours => hours > 1 || w >= 3).map(hours => {
                        const chip = /** @type {HTMLButtonElement} */ (
                            chips.appendChild(el('button', 'chip', periodText(hours)))
                        );
                        chip.type = 'button';
                        chip.dataset.hours = String(hours);
                        chip.addEventListener('click', ev => {
                            ev.stopPropagation();
                            setPeriod(tile, hours);
                        });
                        return chip;
                    });
                }
                const canvas = /** @type {HTMLCanvasElement} */ (b.appendChild(el('canvas', 'trend')));
                tile.parts.canvas = canvas;
                const at = ev => {
                    tile.cursorX = ev.clientX - canvas.getBoundingClientRect().left;
                    drawTrend(tile);
                };
                canvas.addEventListener('pointerdown', ev => {
                    capture(canvas, ev.pointerId);
                    at(ev);
                });
                canvas.addEventListener('pointermove', ev => {
                    if (tile.cursorX !== null) {
                        at(ev);
                    }
                });
                const off = () => {
                    tile.cursorX = null;
                    drawTrend(tile);
                };
                canvas.addEventListener('pointerup', off);
                canvas.addEventListener('pointercancel', off);
                observeSize(tile, canvas);
                break;
            }
            case 'camera': {
                // the picture fills the tile, a tap shows it on the whole screen
                e.classList.add('touch');
                b.classList.add('flush');
                if (a.label || icon) {
                    b.appendChild(head);
                }
                b.appendChild(cameraOf(tile).box);
                e.addEventListener('click', () => openFull(tile));
                break;
            }
            default:
                b.appendChild(head);
        }
        return e;
    }

    /**
     * The value of an item (a row of a group, the second amount of a level, the power of a battery) as HTML.
     *
     * @param {any} item - Item from tile_item
     * @returns {string} The number with its unit, or the text, or a dash
     */
    function itemHtml(item) {
        if (item.text !== undefined) {
            return escapeHtml(item.text);
        }
        if (typeof item.value !== 'number') {
            return '–';
        }
        const unit = item.unit ? `<span class="unit">${escapeHtml(item.unit)}</span>` : '';
        return `${fmt(item.value, item.decimals)}${unit}`;
    }

    /**
     * The rows of a group: built again when an item was added or renamed, else only their values are written.
     *
     * @param {any} tile - Group tile
     */
    function drawItems(tile) {
        const items = tile.items.filter(Boolean);
        const shape = items.map(i => `${i.index}\u0001${i.label}`).join('\u0002');
        const box = tile.parts.items;
        if (shape !== tile.itemsDrawn) {
            tile.itemsDrawn = shape;
            box.textContent = '';
            box.style.setProperty('--n', String(Math.max(1, items.length)));
            for (const item of items) {
                const r = box.appendChild(el('div', 'item'));
                r.appendChild(el('span', 'name', item.label));
                item.el = r.appendChild(el('span', 'value'));
            }
        }
        for (const item of items) {
            if (item.el) {
                item.el.innerHTML = itemHtml(item);
                item.el.style.color = cssColor(item.color);
            }
        }
    }

    /**
     * - / + of a thermostat: the target moves at once, the adapter gets it a second after the last press.
     *
     * @param {Event} ev - Click
     * @param {any} tile - Thermostat
     * @param {number} dir - -1 or 1
     */
    function stepSetpoint(ev, tile, dir) {
        ev.stopPropagation();
        const a = tile.args;
        const step = tile.step > 0 ? tile.step : 0.5;
        const base = tile.setpoint ?? tile.value ?? a.min;
        const next = Math.round((base + dir * step) / step) * step;
        tile.setpoint = Math.max(a.min, Math.min(a.max, next));
        tile.pressing = true;
        update(tile);
        clearTimeout(tile.setpointTimer);
        tile.setpointTimer = setTimeout(() => {
            tile.pressing = false;
            sendInput(tile, 'setpoint', tile.setpoint);
        }, SETPOINT_DELAY_MS);
    }

    /**
     * Shows the current values of a tile in its elements.
     *
     * @param {any} tile - Tile
     */
    function update(tile) {
        const e = tile.el;
        if (!e) {
            return;
        }
        const a = tile.args;
        const p = tile.parts;
        const color = cssColor(tile.color);
        // a battery is green unless the adapter names a colour (red below a threshold, the colour of the tile)
        e.style.setProperty('--c', color || (a.type === 'battery' ? 'var(--ok)' : 'var(--accent)'));
        e.style.background = cssColor(tile.background);
        const unit = a.unit ? `<span class="unit">${escapeHtml(a.unit)}</span>` : '';
        const number = v => (typeof v === 'number' ? fmt(v, a.decimals) : '–');
        const span = (min, max, v) => (max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0);
        switch (a.type) {
            case 'value':
                // a text (e.g. "Geschlossen") is longer than a number: smaller, and it may wrap
                p.value.classList.toggle('text', tile.text !== undefined);
                if (tile.text !== undefined) {
                    p.value.textContent = tile.text;
                } else {
                    p.value.innerHTML = `${number(tile.value)}${typeof tile.value === 'number' ? unit : ''}`;
                }
                break;
            case 'bar':
                p.value.innerHTML = `${number(tile.value)}${typeof tile.value === 'number' ? unit : ''}`;
                p.fill.style.width = `${typeof tile.value === 'number' ? span(a.min, a.max, tile.value) * 100 : 0}%`;
                break;
            case 'chart': {
                p.value.innerHTML = `${number(tile.value)}${typeof tile.value === 'number' ? unit : ''}`;
                const pts = tile.points || [];
                let lo = a.min;
                let hi = a.max;
                if (!(hi > lo) && pts.length) {
                    lo = Math.min(...pts);
                    hi = Math.max(...pts);
                    if (hi === lo) {
                        lo -= 1;
                        hi += 1;
                    }
                }
                const n = Math.max(1, pts.length - 1);
                p.line.setAttribute(
                    'points',
                    pts
                        .map((v, i) => `${((i / n) * 100).toFixed(2)},${(96 - span(lo, hi, v) * 92).toFixed(2)}`)
                        .join(' '),
                );
                break;
            }
            case 'gauge':
            case 'thermostat': {
                const v = tile.value;
                p.arc.setAttribute(
                    'stroke-dasharray',
                    `${typeof v === 'number' ? span(a.min, a.max, v) * 100 : 0} 100`,
                );
                p.arcText.textContent =
                    typeof v === 'number' ? `${fmt(v, a.decimals)}${a.unit ? ` ${a.unit}` : ''}` : '–';
                if (a.type === 'thermostat') {
                    const sp = tile.setpoint;
                    const d = tile.step > 0 && tile.step < 1 ? 1 : 0;
                    p.target.textContent =
                        typeof sp === 'number'
                            ? `${fmt(sp, Math.max(d, a.decimals))}${a.unit ? ` ${a.unit}` : ''}`
                            : '–';
                    p.relay.classList.toggle('hidden', tile.relay === undefined);
                    p.relay.classList.toggle('on', tile.relay === true);
                }
                break;
            }
            case 'switch':
                p.toggle.classList.toggle('on', !!tile.on);
                p.toggle.style.display = tile.showToggle === false ? 'none' : '';
                e.classList.toggle('lit', !!tile.on);
                break;
            case 'dimmer': {
                p.toggle.classList.toggle('on', !!tile.on);
                e.classList.toggle('lit', !!tile.on);
                const v = typeof tile.value === 'number' ? Math.round(tile.value) : null;
                if (!tile.dragging && v !== null) {
                    p.level.value = String(v);
                }
                p.level.style.setProperty('--p', `${v ?? 0}%`);
                p.percent.textContent = v === null ? '–' : `${v} %`;
                break;
            }
            case 'status':
                e.classList.toggle('lit', !!tile.on);
                p.value.classList.toggle('text', tile.text !== undefined);
                if (tile.text !== undefined) {
                    p.value.textContent = tile.text;
                } else {
                    p.value.innerHTML = `${number(tile.value)}${typeof tile.value === 'number' ? unit : ''}`;
                }
                break;
            case 'group':
                drawItems(tile);
                break;
            case 'map':
                drawSpeed(tile);
                drawMapSoon(tile);
                break;
            case 'flow':
                drawFlow(tile);
                break;
            case 'trend':
                drawLegend(tile);
                drawTrend(tile);
                break;
            case 'camera':
                drawCamera(tile);
                break;
            case 'level':
            case 'battery': {
                const v = tile.value;
                const part = typeof v === 'number' ? span(a.min, a.max, v) * 100 : 0;
                if (a.type === 'level') {
                    p.fill.style.height = `${part}%`;
                } else {
                    p.fill.style.width = `${part}%`;
                    // the bolt only after the adapter said whether it charges
                    p.bolt?.classList.toggle('on', tile.on === true);
                    // the value is white unless the adapter names a colour (a threshold, the colour of the tile)
                    e.classList.toggle('colored', tile.color > 0);
                }
                p.value.innerHTML = `${number(v)}${typeof v === 'number' ? unit : ''}`;
                const second = tile.items[1];
                p.amount.innerHTML = second ? itemHtml(second) : '';
                break;
            }
            default:
                break;
        }
    }

    /**
     * @param {string} text - Text
     * @returns {string} The text, safe in HTML
     */
    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    }

    /**
     * One action of the adapter (the actions of the satellite firmware, docs/TILES.md).
     *
     * @param {string} name - Action
     * @param {any} d - Its arguments
     */
    function onAction(name, d) {
        if (name === 'lock_config') {
            lockConfig(d);
            return;
        }
        if (name === 'lock_set') {
            setLocked(!!d.locked, true);
            return;
        }
        if (name === 'page_title') {
            const page = Number(d.page);
            const title = String(d.title ?? '').slice(0, 32);
            if (title) {
                pageTitles.set(page, title);
            } else {
                pageTitles.delete(page);
            }
            drawTitle();
            return;
        }
        if (name === 'tile_clear') {
            for (const [k, tile] of tiles) {
                if (!d.page || tile.page === d.page) {
                    disposeTile(tile);
                    tiles.delete(k);
                }
            }
            queueRender();
            return;
        }
        if (name === 'tile_set') {
            const tile = {
                page: d.page,
                slot: d.slot,
                args: {
                    ...d,
                    min: Number(d.min) || 0,
                    max: Number(d.max) || 0,
                    decimals: Number(d.decimals) || 0,
                },
                showToggle: true,
                color: 0,
                background: 0,
                points: [],
                // rows of a group, the second amount of a level, the power of a battery (tile_item)
                items: [],
                // map, flow, trend, camera (tile_config); the series of a trend (tile_series) and its period
                config: null,
                series: [],
                period: 24,
                cursorX: null,
            };
            const old = tiles.get(keyOf(d.page, d.slot));
            if (old) {
                disposeTile(old);
            }
            tiles.set(keyOf(d.page, d.slot), tile);
            queueRender();
            return;
        }
        const tile = tiles.get(keyOf(d.page, d.slot));
        if (!tile) {
            return; // a value for an empty slot is ignored, as on the satellite
        }
        switch (name) {
            case 'tile_value':
                tile.value = Number(d.value);
                tile.text = undefined;
                if (tile.args.type === 'dimmer' && tile.dragging) {
                    return;
                }
                if (tile.args.type === 'chart') {
                    tile.points.push(tile.value);
                    tile.points = tile.points.slice(-CHART_POINTS);
                }
                break;
            case 'tile_text':
                tile.text = String(d.value ?? '');
                break;
            case 'tile_state':
                if (tile.args.type === 'thermostat') {
                    tile.relay = !!d.on;
                } else {
                    tile.on = !!d.on;
                }
                break;
            case 'tile_history':
                tile.points = (Array.isArray(d.points) ? d.points : [])
                    .map(Number)
                    .filter(Number.isFinite)
                    .slice(-CHART_POINTS);
                break;
            case 'tile_color':
                tile.color = Number(d.color) || 0;
                break;
            case 'tile_background':
                tile.background = Number(d.color) || 0;
                break;
            case 'tile_toggle':
                tile.showToggle = d.show !== false;
                break;
            case 'tile_setpoint':
                tile.step = Number(d.step) || 0.5;
                // while - / + are pressed the screen keeps what the user set
                if (!tile.pressing) {
                    tile.setpoint = Number(d.value);
                }
                break;
            case 'tile_item': {
                const index = Number(d.index);
                const last = tile.args.type === 'flow' ? 4 : 3;
                if (!ITEM_TYPES.includes(tile.args.type) || !Number.isInteger(index) || index < 0 || index > last) {
                    return;
                }
                tile.items[index] = {
                    index,
                    label: String(d.label ?? '').slice(0, 24),
                    unit: String(d.unit ?? '').slice(0, 8),
                    decimals: Math.max(0, Math.min(3, Number(d.decimals) || 0)),
                    color: 0,
                };
                break;
            }
            case 'tile_item_value':
            case 'tile_item_text':
            case 'tile_item_color': {
                // an item that tile_item never made is ignored, as on the satellite
                const item = tile.items[Number(d.index)];
                if (!item) {
                    return;
                }
                if (name === 'tile_item_value') {
                    item.value = Number(d.value);
                    item.text = undefined;
                    if (tile.args.type === 'trend' && Number.isFinite(item.value)) {
                        // a trend draws the values that come in after its history
                        const points = tile.series[item.index] || (tile.series[item.index] = []);
                        points.push([Date.now(), item.value]);
                        if (points.length > LIVE_POINTS) {
                            points.splice(0, points.length - LIVE_POINTS);
                        }
                    }
                } else if (name === 'tile_item_text') {
                    item.text = String(d.value ?? '').slice(0, 32);
                } else {
                    item.color = Number(d.color) || 0;
                }
                break;
            }
            case 'tile_config': {
                const config = d.config && typeof d.config === 'object' ? d.config : {};
                const type = tile.args.type;
                if (type === 'camera') {
                    stopCamera(tile);
                    tile.config = {
                        src: String(config.src || ''),
                        interval: Math.max(0, Math.min(3600, Number(config.interval) || 0)),
                    };
                    syncCameras();
                } else {
                    tile.config = config;
                }
                if (type === 'trend') {
                    tile.period = PERIODS.includes(Number(config.hours)) ? Number(config.hours) : 24;
                }
                if (type === 'map' && !mapOf(tile).located) {
                    mapOf(tile).zoom = MIN_ZOOM;
                }
                break;
            }
            case 'tile_position': {
                const lat = numberOrNull(d.lat);
                const lon = numberOrNull(d.lon);
                if (tile.args.type !== 'map' || lat === null || lon === null) {
                    return;
                }
                const m = mapOf(tile);
                m.pos = { lat, lon, course: numberOrNull(d.course), speed: numberOrNull(d.speed) };
                const end = m.track[m.track.length - 1];
                if (!end || distanceM(end[0], end[1], lat, lon) >= TRACK_STEP_M) {
                    m.track.push([lat, lon]);
                    if (m.track.length > TRACK_MAX) {
                        m.track.splice(0, m.track.length - TRACK_MAX);
                    }
                }
                if (!m.located) {
                    // the first position: the zoom of the tile, centred on the boat
                    m.located = true;
                    m.follow = true;
                    m.zoom = clampZoom(Number(tile.config?.zoom) || 15);
                }
                if (m.follow) {
                    m.center = { lat, lon };
                }
                break;
            }
            case 'tile_track':
                if (tile.args.type !== 'map') {
                    return;
                }
                mapOf(tile).track = (Array.isArray(d.points) ? d.points : [])
                    .filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
                    .slice(-TRACK_MAX);
                break;
            case 'tile_targets':
                if (tile.args.type !== 'map') {
                    return;
                }
                mapOf(tile).targets = (Array.isArray(d.targets) ? d.targets : [])
                    .filter(x => x && Number.isFinite(x.lat) && Number.isFinite(x.lon))
                    .map(x => ({
                        id: x.id,
                        lat: x.lat,
                        lon: x.lon,
                        cog: numberOrNull(x.cog),
                        name: String(x.name ?? '').slice(0, 24),
                    }));
                break;
            case 'tile_anchor':
                if (tile.args.type !== 'map') {
                    return;
                }
                mapOf(tile).anchor =
                    numberOrNull(d.lat) === null || numberOrNull(d.lon) === null
                        ? null
                        : { lat: Number(d.lat), lon: Number(d.lon), radius: numberOrNull(d.radius) || 50 };
                break;
            case 'tile_series': {
                const index = Number(d.index);
                if (tile.args.type !== 'trend' || !Number.isInteger(index) || index < 0 || index > 3) {
                    return;
                }
                // an answer for a period no longer shown is too late
                if (Number(d.hours) !== tile.period) {
                    return;
                }
                tile.series[index] = (Array.isArray(d.points) ? d.points : []).filter(
                    p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
                );
                break;
            }
            default:
                return;
        }
        update(tile);
    }

    // ---- the tiles only a tablet draws: map, flow, trend, camera ------------------------------------------------

    /** Tile servers when tile_config names none, and the seamarks of OpenSeaMap */
    const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const SEAMARK_TILES = 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';
    const TILE_PX = 256;
    const MIN_ZOOM = 3;
    const MAX_ZOOM = 18;
    /** A position this far from the last point of the track is a new point (as the adapter records it) */
    const TRACK_STEP_M = 20;
    const TRACK_MAX = 2000;
    /** Without a position: Europe */
    const NOWHERE = { lat: 50, lon: 10 };
    /** AIS names from this zoom on */
    const NAMES_ZOOM = 13;
    const AIS_COLOR = '#f59e0b';
    const ANCHOR_COLOR = '#ef4444';
    /** Colours of the four parts of a flow, and of the series of a trend */
    const FLOW_COLORS = { solar: '#f59e0b', grid: '#3b82f6', battery: '#22c55e', use: '#a855f7' };
    const SERIES_COLORS = ['#3b82f6', '#f59e0b', '#22c55e', '#a855f7'];
    /** Below this power a line of a flow is grey and still */
    const FLOW_IDLE_W = 5;
    /** The periods of a trend (hours); the shortest only on a tile of three columns or more */
    const PERIODS = [1, 6, 24, 168, 720];
    /** Points of a series kept from tile_item_value */
    const LIVE_POINTS = 2000;
    /** A live picture that failed is tried again after this */
    const CAMERA_RETRY_MS = 5000;

    /**
     * @param {unknown} v - Value
     * @returns {number | null} The number, null when it is none
     */
    const numberOrNull = v =>
        v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);

    /**
     * @param {number} lat1 - Latitude
     * @param {number} lon1 - Longitude
     * @param {number} lat2 - Latitude
     * @param {number} lon2 - Longitude
     * @returns {number} Metres between the two
     */
    function distanceM(lat1, lon1, lat2, lon2) {
        const rad = Math.PI / 180;
        const a =
            Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
        return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    /**
     * Web Mercator: a position in pixels of the whole world at a zoom.
     *
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @param {number} zoom - Zoom, may be fractional
     * @returns {{x: number, y: number}} Pixels
     */
    function worldXY(lat, lon, zoom) {
        const n = TILE_PX * 2 ** zoom;
        const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
        return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
    }

    /**
     * @param {number} x - Pixels of the world
     * @param {number} y - Pixels of the world
     * @param {number} zoom - Zoom
     * @returns {{lat: number, lon: number}} The position
     */
    function latLonOf(x, y, zoom) {
        const n = TILE_PX * 2 ** zoom;
        return {
            lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
            lon: (((((x / n) * 360 + 180) % 360) + 360) % 360) - 180,
        };
    }

    const clampZoom = z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

    /**
     * Keeps the moves of a finger with an element when it leaves it (a pointer that is gone throws: ignored).
     *
     * @param {Element} target - Element
     * @param {number} id - Pointer
     */
    function capture(target, id) {
        try {
            target.setPointerCapture(id);
        } catch {
            // not an active pointer
        }
    }

    /**
     * Ends what a tile keeps beyond its elements (a picture being loaded, a stream, observers); the tile is replaced
     * or removed.
     *
     * @param {any} tile - Tile
     */
    function disposeTile(tile) {
        tile.observer?.disconnect();
        tile.map?.observer?.disconnect();
        if (tile.cam) {
            stopCamera(tile);
            for (const url of tile.cam.urls) {
                URL.revokeObjectURL(url);
            }
            tile.cam.urls = [];
            if (fullTile === tile) {
                closeFull();
            }
        }
    }

    /**
     * Calls a drawing function once in the next frame, however often it is asked for.
     *
     * @param {any} holder - Object that remembers the request
     * @param {() => void} fn - What to draw
     */
    function inFrame(holder, fn) {
        if (!holder.queued) {
            holder.queued = true;
            requestAnimationFrame(() => {
                holder.queued = false;
                fn();
            });
        }
    }

    /**
     * Observes the size of an element; the callback draws the tile again.
     *
     * @param {any} tile - Tile
     * @param {Element} target - Element
     */
    function observeSize(tile, target) {
        tile.observer?.disconnect();
        tile.observer = new ResizeObserver(() => update(tile));
        tile.observer.observe(target);
    }

    // ---- map -----------------------------------------------------------------------------------------------------

    /**
     * The map of a tile: its view and what it shows, kept over a new layout of the page.
     *
     * @param {any} tile - Map tile
     * @returns {any} Its map
     */
    function mapOf(tile) {
        if (!tile.map) {
            tile.map = {
                center: { ...NOWHERE },
                zoom: MIN_ZOOM,
                follow: true,
                located: false,
                pos: null,
                track: [],
                targets: [],
                anchor: null,
                el: null,
                layers: [],
            };
        }
        return tile.map;
    }

    /**
     * The elements of a map: built once and moved into the tile each time the page is built again, so that the tile
     * images and the view stay.
     *
     * @param {any} tile - Map tile
     * @returns {HTMLElement} The map
     */
    function mapElement(tile) {
        const m = mapOf(tile);
        if (m.el) {
            return m.el;
        }
        m.el = el('div', 'map');
        m.layers = [
            { el: m.el.appendChild(el('div', 'layer')), imgs: new Map() },
            { el: m.el.appendChild(el('div', 'layer')), imgs: new Map() },
        ];
        m.canvas = m.el.appendChild(el('canvas'));
        m.empty = m.el.appendChild(el('div', 'mapEmpty', t('noPosition')));
        m.chip = m.el.appendChild(el('div', 'mapChip hidden'));
        const buttons = m.el.appendChild(el('div', 'mapButtons'));
        /** @type {[string, () => void][]} */
        const actions = [
            ['plus', () => zoomAt(tile, null, 1)],
            ['minus', () => zoomAt(tile, null, -1)],
            ['crosshairs-gps', () => recenter(tile)],
        ];
        for (const [icon, fn] of actions) {
            const button = buttons.appendChild(el('button', 'mapButton'));
            button.type = 'button';
            button.appendChild(iconEl(icon));
            button.addEventListener('click', ev => {
                ev.stopPropagation();
                fn();
            });
            if (icon === 'crosshairs-gps') {
                m.centre = button;
            }
        }
        m.credit = m.el.appendChild(el('div', 'credit'));
        mapGestures(tile);
        m.observer = new ResizeObserver(() => drawMapSoon(tile));
        m.observer.observe(m.el);
        return m.el;
    }

    /** @param {any} tile - Map tile */
    function drawMapSoon(tile) {
        inFrame(tile.map, () => drawMap(tile));
    }

    /**
     * Zooms around a point of the map, which stays where it is.
     *
     * @param {any} tile - Map tile
     * @param {{x: number, y: number} | null} at - Point in the map, null = its middle
     * @param {number} dz - Zoom levels
     */
    function zoomAt(tile, at, dz) {
        const m = tile.map;
        const w = m.el.clientWidth;
        const h = m.el.clientHeight;
        const p = at || { x: w / 2, y: h / 2 };
        const z = clampZoom(m.zoom + dz);
        const c = worldXY(m.center.lat, m.center.lon, m.zoom);
        const f = 2 ** (z - m.zoom);
        m.center = latLonOf((c.x + p.x - w / 2) * f - (p.x - w / 2), (c.y + p.y - h / 2) * f - (p.y - h / 2), z);
        m.zoom = z;
        drawMapSoon(tile);
    }

    /** @param {any} tile - Map tile: back to the boat, and follow it again */
    function recenter(tile) {
        const m = tile.map;
        m.follow = true;
        if (m.pos) {
            m.center = { lat: m.pos.lat, lon: m.pos.lon };
        }
        drawMapSoon(tile);
    }

    /**
     * Pan with one finger, pinch with two, a double tap zooms in. A gesture on the map never turns the page (the
     * map has touch-action: none).
     *
     * @param {any} tile - Map tile
     */
    function mapGestures(tile) {
        const m = tile.map;
        /** @type {Map<number, {x: number, y: number}>} */
        const fingers = new Map();
        /** @type {{x: number, y: number, d: number, n: number} | null} */
        let last = null;
        let moved = 0;
        let lastTap = 0;
        const local = ev => {
            const r = m.el.getBoundingClientRect();
            return { x: ev.clientX - r.left, y: ev.clientY - r.top };
        };
        const gesture = () => {
            const ps = [...fingers.values()];
            const x = ps.reduce((s, p) => s + p.x, 0) / ps.length;
            const y = ps.reduce((s, p) => s + p.y, 0) / ps.length;
            const d = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
            return { x, y, d, n: ps.length };
        };
        m.el.addEventListener('pointerdown', ev => {
            if (ev.target.closest('.mapButton')) {
                return;
            }
            capture(m.el, ev.pointerId);
            fingers.set(ev.pointerId, local(ev));
            if (fingers.size === 1) {
                moved = 0;
            }
            last = gesture();
        });
        m.el.addEventListener('pointermove', ev => {
            if (!fingers.has(ev.pointerId)) {
                return;
            }
            fingers.set(ev.pointerId, local(ev));
            const g = gesture();
            if (last && g.n === last.n) {
                moved += Math.abs(g.x - last.x) + Math.abs(g.y - last.y) + Math.abs(g.d - last.d);
                if (moved > 8) {
                    m.follow = false;
                    const w = m.el.clientWidth;
                    const h = m.el.clientHeight;
                    const z = g.n > 1 && last.d > 0 ? clampZoom(m.zoom + Math.log2(g.d / last.d)) : m.zoom;
                    const c = worldXY(m.center.lat, m.center.lon, m.zoom);
                    // the point under the fingers stays under them
                    const f = 2 ** (z - m.zoom);
                    const wx = (c.x + last.x - w / 2) * f;
                    const wy = (c.y + last.y - h / 2) * f;
                    m.center = latLonOf(wx - (g.x - w / 2), wy - (g.y - h / 2), z);
                    m.zoom = z;
                    drawMapSoon(tile);
                }
            }
            last = g;
        });
        const up = ev => {
            if (!fingers.has(ev.pointerId)) {
                return;
            }
            const at = local(ev);
            fingers.delete(ev.pointerId);
            last = fingers.size ? gesture() : null;
            if (fingers.size) {
                return;
            }
            if (moved <= 8 && ev.type === 'pointerup') {
                const now = Date.now();
                if (now - lastTap < 350) {
                    lastTap = 0;
                    zoomAt(tile, at, 1);
                    return;
                }
                lastTap = now;
            }
            // whole zoom levels: the tiles are sharp
            if (m.zoom !== Math.round(m.zoom)) {
                zoomAt(tile, at, Math.round(m.zoom) - m.zoom);
            }
        };
        m.el.addEventListener('pointerup', up);
        m.el.addEventListener('pointercancel', up);
    }

    /**
     * The tile images of one layer for the view: those missing are added, those out of view removed.
     *
     * @param {{el: HTMLElement, imgs: Map<string, HTMLImageElement>}} layer - Layer
     * @param {string} template - URL with {z}, {x}, {y}
     * @param {{left: number, top: number, w: number, h: number, zoom: number}} view - The view
     */
    function drawTiles(layer, template, view) {
        const zi = Math.max(0, Math.min(MAX_ZOOM, Math.round(view.zoom)));
        const size = TILE_PX * 2 ** (view.zoom - zi);
        const n = 2 ** zi;
        const keep = new Set();
        const y0 = Math.max(0, Math.floor(view.top / size));
        const y1 = Math.min(n - 1, Math.floor((view.top + view.h) / size));
        const x0 = Math.floor(view.left / size);
        const x1 = Math.floor((view.left + view.w) / size);
        for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
                const wx = ((tx % n) + n) % n;
                const key = `${zi}/${tx}/${ty}`;
                keep.add(key);
                let img = layer.imgs.get(key);
                if (!img) {
                    img = /** @type {HTMLImageElement} */ (el('img'));
                    img.alt = '';
                    img.draggable = false;
                    img.decoding = 'async';
                    // the tile servers want to know where a request comes from: the origin, never the key
                    img.referrerPolicy = 'strict-origin';
                    img.addEventListener('error', () => {
                        img.style.visibility = 'hidden';
                    });
                    img.src = template
                        .replace(/\{z\}/g, String(zi))
                        .replace(/\{x\}/g, String(wx))
                        .replace(/\{y\}/g, String(ty))
                        .replace(/\{s\}/g, 'a');
                    layer.imgs.set(key, img);
                    layer.el.appendChild(img);
                }
                const left = Math.round(tx * size - view.left);
                const top = Math.round(ty * size - view.top);
                img.style.left = `${left}px`;
                img.style.top = `${top}px`;
                img.style.width = `${Math.round((tx + 1) * size - view.left) - left}px`;
                img.style.height = `${Math.round((ty + 1) * size - view.top) - top}px`;
            }
        }
        for (const [key, img] of layer.imgs) {
            if (!keep.has(key)) {
                img.remove();
                layer.imgs.delete(key);
            }
        }
    }

    /** @param {any} tile - Map tile */
    function drawMap(tile) {
        const m = tile.map;
        if (!m?.el?.isConnected) {
            return;
        }
        const w = m.el.clientWidth;
        const h = m.el.clientHeight;
        if (!w || !h) {
            return;
        }
        const config = tile.config || {};
        const c = worldXY(m.center.lat, m.center.lon, m.zoom);
        const view = { left: c.x - w / 2, top: c.y - h / 2, w, h, zoom: m.zoom };
        drawTiles(m.layers[0], String(config.tiles || OSM_TILES), view);
        m.layers[1].el.hidden = !config.seamarks;
        if (config.seamarks) {
            drawTiles(m.layers[1], String(config.seamarkTiles || SEAMARK_TILES), view);
        }
        m.credit.textContent = `© OpenStreetMap${config.seamarks ? ' · © OpenSeaMap' : ''}`;
        m.empty.hidden = !!m.pos;
        m.centre.classList.toggle('on', m.follow);

        const ratio = window.devicePixelRatio || 1;
        const canvas = m.canvas;
        if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
            canvas.width = Math.round(w * ratio);
            canvas.height = Math.round(h * ratio);
        }
        const g = canvas.getContext('2d');
        g.setTransform(ratio, 0, 0, ratio, 0, 0);
        g.clearRect(0, 0, w, h);
        const xy = (lat, lon) => {
            const p = worldXY(lat, lon, m.zoom);
            return [p.x - view.left, p.y - view.top];
        };
        const accent = cssColor(tile.color) || '#3d8bfd';

        // the anchor circle
        const anchor = m.anchor;
        if (anchor && anchor.lat !== null && anchor.lon !== null) {
            const [ax, ay] = xy(anchor.lat, anchor.lon);
            const metresPerPixel = (156543.03392 * Math.cos((anchor.lat * Math.PI) / 180)) / 2 ** m.zoom;
            const r = Math.max(4, (anchor.radius || 50) / metresPerPixel);
            g.beginPath();
            g.arc(ax, ay, r, 0, Math.PI * 2);
            g.fillStyle = 'rgba(239, 68, 68, 0.08)';
            g.fill();
            g.setLineDash([6, 5]);
            g.lineWidth = 2;
            g.strokeStyle = ANCHOR_COLOR;
            g.stroke();
            g.setLineDash([]);
            g.beginPath();
            g.arc(ax, ay, 4, 0, Math.PI * 2);
            g.fillStyle = ANCHOR_COLOR;
            g.fill();
        }

        // the track
        const track = m.pos ? [...m.track, [m.pos.lat, m.pos.lon]] : m.track;
        if (track.length > 1) {
            g.beginPath();
            track.forEach(([lat, lon], i) => {
                const [x, y] = xy(lat, lon);
                if (i) {
                    g.lineTo(x, y);
                } else {
                    g.moveTo(x, y);
                }
            });
            g.globalAlpha = 0.7;
            g.lineWidth = 3;
            g.lineJoin = 'round';
            g.lineCap = 'round';
            g.strokeStyle = accent;
            g.stroke();
            g.globalAlpha = 1;
        }

        // the AIS targets
        g.font = '12px system-ui, sans-serif';
        g.textBaseline = 'middle';
        for (const target of m.targets) {
            const [x, y] = xy(target.lat, target.lon);
            if (x < -40 || y < -40 || x > w + 40 || y > h + 40) {
                continue;
            }
            g.save();
            g.translate(x, y);
            g.fillStyle = AIS_COLOR;
            g.strokeStyle = '#111';
            g.lineWidth = 1;
            if (typeof target.cog === 'number') {
                g.rotate((target.cog * Math.PI) / 180);
                g.beginPath();
                g.moveTo(0, -9);
                g.lineTo(6, 7);
                g.lineTo(-6, 7);
                g.closePath();
            } else {
                g.beginPath();
                g.arc(0, 0, 5, 0, Math.PI * 2);
            }
            g.fill();
            g.stroke();
            g.restore();
            if (m.zoom >= NAMES_ZOOM) {
                const name = target.name || String(target.id);
                g.lineWidth = 3;
                g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
                g.strokeText(name, x + 10, y);
                g.fillStyle = '#fff';
                g.fillText(name, x + 10, y);
            }
        }

        // the boat: an arrow to its course, a dot without one
        if (m.pos) {
            const [x, y] = xy(m.pos.lat, m.pos.lon);
            g.save();
            g.translate(x, y);
            g.fillStyle = accent;
            g.strokeStyle = '#fff';
            g.lineWidth = 2;
            g.beginPath();
            if (typeof m.pos.course === 'number') {
                g.rotate((m.pos.course * Math.PI) / 180);
                g.moveTo(0, -14);
                g.lineTo(9, 10);
                g.lineTo(0, 5);
                g.lineTo(-9, 10);
                g.closePath();
            } else {
                g.arc(0, 0, 7, 0, Math.PI * 2);
            }
            g.fill();
            g.stroke();
            g.restore();
        }
    }

    /**
     * The speed of the boat: in the head line of the tile, or without one in a chip on the map.
     *
     * @param {any} tile - Map tile
     */
    function drawSpeed(tile) {
        const m = tile.map;
        const speed = m?.pos?.speed;
        const text = typeof speed === 'number' ? `${fmt(speed, 1)} kn` : '';
        const target = tile.parts.speed || m?.chip;
        if (target) {
            target.textContent = text;
            target.classList.toggle('hidden', !text);
        }
        if (tile.parts.speed && m?.chip) {
            m.chip.classList.add('hidden');
        }
    }

    // ---- flow ----------------------------------------------------------------------------------------------------

    /**
     * @param {number | null} watts - Power
     * @returns {string} "850 W", "1.2 kW", or a dash
     */
    function powerText(watts) {
        if (typeof watts !== 'number') {
            return '–';
        }
        const w = Math.abs(watts);
        return w >= 1000 ? `${fmt(w / 1000, 1)} kW` : `${fmt(Math.round(w), 0)} W`;
    }

    /**
     * The energy flow: four corners around the inverter in the middle, dots along the lines in the direction of the
     * power. The structure is built again when the size or the parts change, else only texts and dots.
     *
     * @param {any} tile - Flow tile
     */
    function drawFlow(tile) {
        const s = tile.parts.flow;
        const box = s?.getBoundingClientRect();
        if (!box || !box.width || !box.height) {
            return;
        }
        const w = Math.round(box.width);
        const h = Math.round(box.height);
        const items = tile.items;
        const value = i => (typeof items[i]?.value === 'number' ? items[i].value : null);
        const solar = value(0);
        const battery = value(1);
        const grid = value(2);
        // without a state of its own the consumption is what comes in minus what goes into the battery
        const use = items[3] ? value(3) : Math.max(0, (solar ?? 0) + (grid ?? 0) - (battery ?? 0));
        const soc = value(4);
        // two rows of a circle and two lines of text under it, with room between them
        const r = Math.max(10, Math.min(w / 9, h / 7));
        const text = Math.max(9, r * 0.5);
        const below = text * 2.4;
        const yTop = r + 2;
        const yBottom = h - r - below;
        const xLeft = r * 1.9;
        const xRight = w - r * 1.9;
        const mid = { x: w / 2, y: (yTop + yBottom) / 2 };
        // inward: the power runs to the middle
        const nodes = [
            { key: 'solar', item: items[0], x: xLeft, y: yTop, p: solar, inward: true, icon: 'solar-power' },
            {
                key: 'grid',
                item: items[2],
                x: xRight,
                y: yTop,
                p: grid,
                inward: (grid ?? 0) > 0,
                icon: 'transmission-tower',
            },
            {
                key: 'battery',
                item: items[1],
                x: xLeft,
                y: yBottom,
                p: battery,
                inward: (battery ?? 0) < 0,
                icon: '',
            },
            {
                key: 'use',
                item: items[3] || { label: '' },
                x: xRight,
                y: yBottom,
                p: use,
                inward: false,
                icon: 'home-lightning-bolt',
            },
        ].filter(n => n.item);
        const shape = `${w}x${h}|${nodes.map(n => `${n.key}:${n.item.label}`).join(',')}`;
        if (shape !== tile.flowShape) {
            tile.flowShape = shape;
            tile.flowDots = {};
            s.setAttribute('viewBox', `0 0 ${w} ${h}`);
            s.textContent = '';
            tile.flowParts = {};
            const lines = s.appendChild(svg('g'));
            const dots = s.appendChild(svg('g'));
            const disks = s.appendChild(svg('g'));
            // the inverter
            disks.appendChild(svg('circle', { cx: mid.x, cy: mid.y, r: r * 0.55, class: 'flowMid' }));
            const flash = ICONS.flash;
            if (flash) {
                const inner = svg('svg', {
                    x: mid.x - r * 0.35,
                    y: mid.y - r * 0.35,
                    width: r * 0.7,
                    height: r * 0.7,
                    viewBox: '0 0 24 24',
                    class: 'flowIcon',
                });
                inner.appendChild(svg('path', { d: flash }));
                disks.appendChild(inner);
            }
            for (const n of nodes) {
                const color = FLOW_COLORS[n.key];
                const line = lines.appendChild(
                    svg('path', { d: `M ${n.x} ${n.y} L ${mid.x} ${mid.y}`, class: 'flowLine' }),
                );
                const group = dots.appendChild(svg('g'));
                disks.appendChild(svg('circle', { cx: n.x, cy: n.y, r, class: 'flowNode', stroke: color }));
                let fill = null;
                if (n.key === 'battery') {
                    // a battery filled to its charge
                    const bw = r * 0.56;
                    const bh = r * 0.9;
                    disks.appendChild(
                        svg('rect', {
                            x: n.x - bw / 2,
                            y: n.y - bh / 2,
                            width: bw,
                            height: bh,
                            rx: r * 0.08,
                            fill: 'none',
                            stroke: color,
                            'stroke-width': Math.max(1.5, r * 0.08),
                        }),
                    );
                    disks.appendChild(
                        svg('rect', {
                            x: n.x - bw * 0.2,
                            y: n.y - bh / 2 - r * 0.1,
                            width: bw * 0.4,
                            height: r * 0.1,
                            fill: color,
                        }),
                    );
                    fill = disks.appendChild(
                        svg('rect', { x: n.x - bw / 2 + r * 0.1, width: bw - r * 0.2, fill: color, rx: r * 0.04 }),
                    );
                    fill.dataset.bottom = String(n.y + bh / 2 - r * 0.1);
                    fill.dataset.full = String(bh - r * 0.2);
                } else {
                    const d = ICONS[n.icon] || EXTRA_ICONS[n.icon];
                    const inner = svg('svg', {
                        x: n.x - r * 0.55,
                        y: n.y - r * 0.55,
                        width: r * 1.1,
                        height: r * 1.1,
                        viewBox: '0 0 24 24',
                        fill: color,
                    });
                    inner.appendChild(svg('path', { d }));
                    disks.appendChild(inner);
                }
                const power = disks.appendChild(
                    svg('text', { x: n.x, y: n.y + r + text * 1.05, 'font-size': text, class: 'flowPower' }),
                );
                const name = disks.appendChild(
                    svg('text', { x: n.x, y: n.y + r + text * 2.15, 'font-size': text * 0.78, class: 'flowName' }),
                );
                tile.flowParts[n.key] = { line, group, power, name, fill, color };
            }
        }
        for (const n of nodes) {
            const part = tile.flowParts[n.key];
            if (!part) {
                continue;
            }
            part.power.textContent = powerText(n.p);
            let name = n.item.label || t(n.key);
            if (n.key === 'battery' && soc !== null) {
                name = `${name} · ${fmt(soc, 0)} %`;
            }
            part.name.textContent = name;
            if (part.fill) {
                const share = soc === null ? 0 : Math.max(0, Math.min(1, soc / 100));
                const full = Number(part.fill.dataset.full);
                part.fill.setAttribute('height', String(full * share));
                part.fill.setAttribute('y', String(Number(part.fill.dataset.bottom) - full * share));
            }
            const idle = typeof n.p !== 'number' || Math.abs(n.p) < FLOW_IDLE_W;
            part.line.setAttribute('stroke', idle ? 'var(--track)' : part.color);
            part.line.classList.toggle('idle', idle);
            // 3 s for a trickle, 0.5 s from 3 kW on, on a log scale; in tenths, so that a small change keeps the dots
            const speed = idle
                ? 0
                : Math.max(0, Math.min(1, Math.log10(Math.abs(n.p) / FLOW_IDLE_W) / Math.log10(600)));
            const dur = idle ? 0 : Math.round((3 - 2.5 * speed) * 10) / 10;
            const run = idle ? '' : `${n.inward ? 'in' : 'out'}:${dur}`;
            if (tile.flowDots[n.key] !== run) {
                tile.flowDots[n.key] = run;
                part.group.textContent = '';
                if (run) {
                    const path = n.inward
                        ? `M ${n.x} ${n.y} L ${mid.x} ${mid.y}`
                        : `M ${mid.x} ${mid.y} L ${n.x} ${n.y}`;
                    for (let k = 0; k < 3; k++) {
                        const dot = part.group.appendChild(
                            svg('circle', { r: Math.max(2, r * 0.12), fill: part.color }),
                        );
                        dot.appendChild(
                            svg('animateMotion', {
                                dur: `${dur}s`,
                                begin: `${(-dur * k) / 3}s`,
                                repeatCount: 'indefinite',
                                path,
                            }),
                        );
                    }
                }
            }
        }
    }

    // ---- trend ---------------------------------------------------------------------------------------------------

    /**
     * @param {number} hours - Period
     * @returns {string} 6h, 24h, 7d, 30d
     */
    const periodText = hours => (hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`);

    /**
     * The tablet shows another period: it asks the adapter for its history.
     *
     * @param {any} tile - Trend tile
     * @param {number} hours - Period
     */
    function setPeriod(tile, hours) {
        if (tile.period === hours) {
            return;
        }
        tile.period = hours;
        sendInput(tile, 'period', hours);
        update(tile);
    }

    /**
     * About `count` round steps between lo and hi.
     *
     * @param {number} lo - Lowest value
     * @param {number} hi - Highest value
     * @param {number} count - Ticks wanted
     * @returns {number[]} The ticks
     */
    function niceTicks(lo, hi, count) {
        const raw = (hi - lo) / Math.max(1, count);
        const mag = 10 ** Math.floor(Math.log10(raw));
        const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw) || raw;
        const ticks = [];
        for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
            ticks.push(Math.round(v / step) * step);
        }
        return ticks;
    }

    /** Steps of the time axis */
    const TIME_STEPS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080].map(m => m * 60_000);

    /**
     * The chart of a trend: lines with axes, a fill under the first, the cursor while a finger is on it.
     *
     * @param {any} tile - Trend tile
     */
    function drawTrend(tile) {
        const canvas = tile.parts.canvas;
        const box = canvas?.getBoundingClientRect();
        if (!box || !box.width || !box.height) {
            return;
        }
        const w = box.width;
        const h = box.height;
        const ratio = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
            canvas.width = Math.round(w * ratio);
            canvas.height = Math.round(h * ratio);
        }
        const g = canvas.getContext('2d');
        g.setTransform(ratio, 0, 0, ratio, 0, 0);
        g.clearRect(0, 0, w, h);
        const style = getComputedStyle(canvas);
        const muted = style.getPropertyValue('--muted').trim() || '#8a96a3';
        const track = style.getPropertyValue('--track').trim() || '#33404c';
        const font = Math.max(10, Math.min(14, h / 12));
        g.font = `${font}px system-ui, sans-serif`;

        const now = Date.now();
        const span = tile.period * 3600_000;
        const t0 = now - span;
        const colors = [cssColor(tile.color) || SERIES_COLORS[0], ...SERIES_COLORS.slice(1)];
        const series = [0, 1, 2, 3]
            .filter(i => tile.items[i])
            .map(i => ({
                i,
                item: tile.items[i],
                color: colors[i],
                points: (tile.series[i] || []).filter(p => p[0] >= t0 - span * 0.02),
            }));
        // one axis per unit, two at most: the first unit left, a second right
        const units = [...new Set(series.map(s => s.item.unit))];
        const a = tile.args;
        const axes = units.map((unit, k) => {
            const values = series.filter(s => s.item.unit === unit).flatMap(s => s.points.map(p => p[1]));
            let lo = values.length ? Math.min(...values) : 0;
            let hi = values.length ? Math.max(...values) : 1;
            if (k === 0 && a.max > a.min) {
                lo = a.min;
                hi = a.max;
            } else {
                const margin = (hi - lo) * 0.05 || Math.abs(hi) * 0.05 || 1;
                lo -= margin;
                hi += margin;
            }
            return { unit, lo, hi, ticks: niceTicks(lo, hi, Math.max(2, Math.min(4, Math.floor(h / 45)))) };
        });
        // as many decimals as the step of the ticks needs, and no "-0"
        const label = (axis, v) => {
            const step = axis.ticks.length > 1 ? Math.abs(axis.ticks[1] - axis.ticks[0]) : 1;
            const d = Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9)));
            return fmt(Math.abs(v) < step * 1e-6 ? 0 : v, d);
        };
        const width = axis => (axis ? Math.max(...axis.ticks.map(v => g.measureText(label(axis, v)).width), 0) + 8 : 6);
        const left = width(axes[0]);
        const right = width(axes[1]);
        const top = font * 0.6;
        const bottom = font * 1.6;
        const pw = Math.max(1, w - left - right);
        const ph = Math.max(1, h - top - bottom);
        const X = time => left + ((time - t0) / span) * pw;
        const Y = (axis, v) => top + (1 - (v - axis.lo) / (axis.hi - axis.lo || 1)) * ph;

        // grid and the value axes
        g.lineWidth = 1;
        g.textBaseline = 'middle';
        axes.slice(0, 2).forEach((axis, k) => {
            for (const v of axis.ticks) {
                const y = Y(axis, v);
                if (y < top - 1 || y > top + ph + 1) {
                    continue;
                }
                if (k === 0) {
                    g.strokeStyle = track;
                    g.beginPath();
                    g.moveTo(left, Math.round(y) + 0.5);
                    g.lineTo(left + pw, Math.round(y) + 0.5);
                    g.stroke();
                }
                g.fillStyle = muted;
                g.textAlign = k === 0 ? 'right' : 'left';
                g.fillText(label(axis, v), k === 0 ? left - 5 : left + pw + 5, y);
            }
        });

        // the time axis: local time, round steps
        const steps = Math.max(2, Math.floor(pw / (font * 6)));
        const step = TIME_STEPS.find(s => span / s <= steps) || TIME_STEPS[TIME_STEPS.length - 1];
        const offset = new Date(now).getTimezoneOffset() * 60_000;
        const long = span > 24 * 3600_000;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        for (let time = Math.ceil((t0 - offset) / step) * step + offset; time <= now; time += step) {
            const x = X(time);
            const d = new Date(time);
            const text = !long
                ? d.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' })
                : step < 1440 * 60_000
                  ? d.toLocaleDateString(navigator.language, { weekday: 'short' }) +
                    ` ${d.toLocaleTimeString(navigator.language, { hour: '2-digit' })}`
                  : span > 8 * 24 * 3600_000
                    ? d.toLocaleDateString(navigator.language, { day: 'numeric', month: 'numeric' })
                    : d.toLocaleDateString(navigator.language, { weekday: 'short' });
            g.strokeStyle = track;
            g.beginPath();
            g.moveTo(Math.round(x) + 0.5, top + ph);
            g.lineTo(Math.round(x) + 0.5, top + ph + 4);
            g.stroke();
            g.fillStyle = muted;
            g.fillText(text, x, top + ph + 5);
        }

        // the lines, the first with a fill under it
        g.save();
        g.beginPath();
        g.rect(left, top, pw, ph);
        g.clip();
        series.forEach((s, k) => {
            const axis = axes[units.indexOf(s.item.unit)];
            if (!axis || s.points.length < 2) {
                return;
            }
            g.beginPath();
            s.points.forEach(([time, v], i) => {
                if (i) {
                    g.lineTo(X(time), Y(axis, v));
                } else {
                    g.moveTo(X(time), Y(axis, v));
                }
            });
            if (k === 0) {
                g.save();
                g.lineTo(X(s.points[s.points.length - 1][0]), top + ph);
                g.lineTo(X(s.points[0][0]), top + ph);
                g.closePath();
                g.globalAlpha = 0.15;
                g.fillStyle = s.color;
                g.fill();
                g.restore();
                g.beginPath();
                s.points.forEach(([time, v], i) => {
                    if (i) {
                        g.lineTo(X(time), Y(axis, v));
                    } else {
                        g.moveTo(X(time), Y(axis, v));
                    }
                });
            }
            g.lineWidth = 2;
            g.lineJoin = 'round';
            g.strokeStyle = s.color;
            g.stroke();
        });
        g.restore();

        // the cursor: the time under the finger and the value of each series then
        if (typeof tile.cursorX === 'number' && series.length) {
            const x = Math.max(left, Math.min(left + pw, tile.cursorX));
            const time = t0 + ((x - left) / pw) * span;
            g.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(Math.round(x) + 0.5, top);
            g.lineTo(Math.round(x) + 0.5, top + ph);
            g.stroke();
            const d = new Date(time);
            const lines = [
                {
                    text: long
                        ? `${d.toLocaleDateString(navigator.language, { weekday: 'short', day: 'numeric', month: 'numeric' })} ${d.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' })}`
                        : d.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' }),
                    color: '#fff',
                },
            ];
            for (const s of series) {
                if (!s.points.length) {
                    continue;
                }
                const near = s.points.reduce((best, p) =>
                    Math.abs(p[0] - time) < Math.abs(best[0] - time) ? p : best,
                );
                const axis = axes[units.indexOf(s.item.unit)];
                if (axis) {
                    g.fillStyle = s.color;
                    g.beginPath();
                    g.arc(X(near[0]), Y(axis, near[1]), 3.5, 0, Math.PI * 2);
                    g.fill();
                }
                lines.push({
                    text: `${s.item.label ? `${s.item.label} ` : ''}${fmt(near[1], s.item.decimals)}${s.item.unit ? ` ${s.item.unit}` : ''}`,
                    color: s.color,
                });
            }
            const bw = Math.max(...lines.map(l => g.measureText(l.text).width)) + 12;
            const bh = lines.length * font * 1.3 + 8;
            const bx = x + 10 + bw > left + pw ? x - 10 - bw : x + 10;
            g.fillStyle = 'rgba(16, 20, 24, 0.9)';
            g.fillRect(bx, top + 2, bw, bh);
            g.textAlign = 'left';
            g.textBaseline = 'top';
            lines.forEach((l, i) => {
                g.fillStyle = l.color;
                g.fillText(l.text, bx + 6, top + 6 + i * font * 1.3);
            });
        }
    }

    /**
     * The names and current values of the series in the head line, and which period is on.
     *
     * @param {any} tile - Trend tile
     */
    function drawLegend(tile) {
        const legend = tile.parts.legend;
        if (legend) {
            const colors = [cssColor(tile.color) || SERIES_COLORS[0], ...SERIES_COLORS.slice(1)];
            legend.innerHTML = [0, 1, 2, 3]
                .filter(i => tile.items[i])
                .map(i => {
                    const item = tile.items[i];
                    return `<span style="color:${colors[i]}">●</span><span class="name">${escapeHtml(item.label)}</span> ${itemHtml(item)}`;
                })
                .map(html => `<span class="serie">${html}</span>`)
                .join('');
        }
        for (const chip of tile.parts.chips || []) {
            chip.classList.toggle('on', Number(chip.dataset.hours) === tile.period);
        }
    }

    // ---- camera --------------------------------------------------------------------------------------------------

    /** The tile whose picture is shown on the whole screen, null = none */
    let fullTile = null;
    const fullEl = document.body.appendChild(el('div'));
    fullEl.id = 'camFull';
    fullEl.hidden = true;
    fullEl.addEventListener('click', () => closeFull(true));
    window.addEventListener('popstate', () => closeFull());

    /**
     * The picture of a camera tile on the whole screen: its picture element moves there (one stream, not two).
     *
     * @param {any} tile - Camera tile
     */
    function openFull(tile) {
        if (fullTile || !tile.cam) {
            return;
        }
        fullTile = tile;
        fullEl.appendChild(tile.cam.img);
        fullEl.hidden = false;
        try {
            history.pushState({ camera: true }, '');
        } catch {
            // without history the back button leaves the page
        }
        syncCameras();
    }

    /** @param {boolean} [back] - Also take the history entry of openFull back */
    function closeFull(back) {
        const tile = fullTile;
        if (!tile) {
            return;
        }
        fullTile = null;
        fullEl.hidden = true;
        tile.cam.box.insertBefore(tile.cam.img, tile.cam.box.firstChild);
        if (back && history.state?.camera) {
            history.back();
        }
        syncCameras();
    }

    /**
     * The picture of a camera tile, kept over a new layout of the page.
     *
     * @param {any} tile - Camera tile
     * @returns {any} Its camera
     */
    function cameraOf(tile) {
        if (!tile.cam) {
            const box = el('div', 'camera');
            const img = /** @type {HTMLImageElement} */ (box.appendChild(el('img')));
            img.alt = '';
            img.draggable = false;
            const off = box.appendChild(el('div', 'off'));
            off.appendChild(iconEl('camera-off'));
            off.appendChild(el('span', '', t('noPicture')));
            // run: the number of the current start, so that a request of an earlier one ends quietly
            const cam = { box, img, off, running: false, ok: false, timer: 0, ctrl: null, urls: [], run: 0 };
            img.addEventListener('load', () => {
                cam.ok = true;
                drawCamera(tile);
            });
            tile.cam = cam;
        }
        return tile.cam;
    }

    /**
     * Shows a picture; the one shown stays until this one is there (no flicker).
     *
     * @param {any} cam - Camera of a tile
     * @param {Blob} blob - The picture
     */
    function showPicture(cam, blob) {
        const url = URL.createObjectURL(blob);
        cam.urls.push(url);
        cam.img.src = url;
        while (cam.urls.length > 2) {
            URL.revokeObjectURL(cam.urls.shift());
        }
    }

    /**
     * @param {Uint8Array} hay - Bytes
     * @param {Uint8Array} needle - Bytes looked for
     * @param {number} from - First index
     * @returns {number} Index of the first match, -1 for none
     */
    function bytesIndexOf(hay, needle, from) {
        for (
            let i = hay.indexOf(needle[0], from);
            i >= 0 && i <= hay.length - needle.length;
            i = hay.indexOf(needle[0], i + 1)
        ) {
            let k = 1;
            while (k < needle.length && hay[i + k] === needle[k]) {
                k++;
            }
            if (k === needle.length) {
                return i;
            }
        }
        return -1;
    }

    const HEAD_END = new Uint8Array([13, 10, 13, 10]);
    /** A stream whose frames are bigger than this is no camera: it is dropped */
    const MAX_FRAME = 8 * 1024 * 1024;

    /**
     * The frames of a live picture (multipart/x-mixed-replace, MJPEG), read here rather than by an <img>: an <img>
     * keeps a stream open after its src is gone, and the camera would run on behind a hidden page.
     *
     * @param {Response} r - Answer of the adapter
     * @param {any} cam - Camera of a tile
     * @param {() => boolean} current - False when this run has ended
     */
    async function readFrames(r, cam, current) {
        const type = r.headers.get('content-type') || '';
        const m = /boundary="?([^";,]+)"?/i.exec(type);
        if (!m || !r.body) {
            showPicture(cam, await r.blob());
            return;
        }
        // "--" and the boundary starts every part; a camera that puts the dashes into the boundary itself matches too
        const boundary = new TextEncoder().encode(`--${m[1].replace(/^-+/, '')}`);
        const decoder = new TextDecoder();
        const reader = r.body.getReader();
        let buf = new Uint8Array(0);
        while (current()) {
            const { value, done } = await reader.read();
            if (done) {
                return;
            }
            const next = new Uint8Array(buf.length + value.length);
            next.set(buf);
            next.set(value, buf.length);
            buf = next;
            for (;;) {
                const start = bytesIndexOf(buf, boundary, 0);
                const head = start < 0 ? -1 : bytesIndexOf(buf, HEAD_END, start);
                if (head < 0) {
                    break;
                }
                const headers = decoder.decode(buf.subarray(start, head));
                const length = /content-length:\s*(\d+)/i.exec(headers);
                const body = head + HEAD_END.length;
                let end;
                if (length) {
                    end = body + Number(length[1]);
                    if (end > buf.length) {
                        break;
                    }
                } else {
                    end = bytesIndexOf(buf, boundary, body);
                    if (end < 0) {
                        break;
                    }
                    // the line break before the next boundary
                    while (end > body && (buf[end - 1] === 10 || buf[end - 1] === 13)) {
                        end--;
                    }
                }
                const kind = /content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1] || 'image/jpeg';
                if (current()) {
                    showPicture(cam, new Blob([buf.slice(body, end)], { type: kind }));
                }
                buf = buf.slice(end);
            }
            if (buf.length > MAX_FRAME) {
                throw new Error('frame too big');
            }
        }
    }

    /**
     * The picture of a camera from the adapter (GET cam/<page>/<slot>): every interval seconds one, or with interval 0
     * the frames of a live stream. Again after an error.
     *
     * @param {any} tile - Camera tile
     * @param {number} run - The start this belongs to
     */
    async function loadPicture(tile, run) {
        const cam = tile.cam;
        const src = tile.config?.src;
        const current = () => cam.running && cam.run === run;
        if (!current() || !src) {
            return;
        }
        const live = tile.config.interval === 0;
        const ctrl = new AbortController();
        cam.ctrl = ctrl;
        // a picture within 15 s; a stream only until its first answer
        const timer = setTimeout(() => ctrl.abort(), 15_000);
        let failed = false;
        try {
            const r = await fetch(`${src}?t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
            if (!r.ok) {
                throw new Error(String(r.status));
            }
            if (live) {
                clearTimeout(timer);
                await readFrames(r, cam, current);
            } else {
                const blob = await r.blob();
                if (current()) {
                    showPicture(cam, blob);
                }
            }
        } catch {
            failed = true;
        } finally {
            clearTimeout(timer);
            if (cam.ctrl === ctrl) {
                cam.ctrl = null;
            }
        }
        if (!current()) {
            return;
        }
        if (failed || live) {
            cam.ok = false;
            drawCamera(tile);
        }
        const wait = failed || live ? CAMERA_RETRY_MS : Math.max(1, tile.config.interval) * 1000;
        cam.timer = setTimeout(() => void loadPicture(tile, run), wait);
    }

    /** @param {any} tile - Camera tile */
    function startCamera(tile) {
        const cam = cameraOf(tile);
        if (cam.running || !tile.config?.src) {
            return;
        }
        cam.running = true;
        cam.run++;
        void loadPicture(tile, cam.run);
    }

    /** @param {any} tile - Camera tile: its request ends, and with it the adapter's request to the camera */
    function stopCamera(tile) {
        const cam = tile.cam;
        if (!cam?.running) {
            return;
        }
        cam.running = false;
        clearTimeout(cam.timer);
        cam.ctrl?.abort();
        cam.ctrl = null;
    }

    /** @param {any} tile - Camera tile: the placeholder while there is no picture */
    function drawCamera(tile) {
        if (tile.cam) {
            tile.cam.off.hidden = tile.cam.ok;
        }
    }

    /** Cameras run while their page is on screen (or their picture is on the whole screen), and only then. */
    function syncCameras() {
        const page = currentPage();
        const shown = !document.hidden && !clock.shown && !lock.locked;
        for (const tile of tiles.values()) {
            if (tile.args.type !== 'camera') {
                continue;
            }
            const on =
                shown && !!tile.cam?.box && (fullTile === tile || (tile.page === page && tile.cam.box.isConnected));
            if (on) {
                startCamera(tile);
            } else if (tile.cam) {
                stopCamera(tile);
            }
            drawCamera(tile);
        }
    }
    document.addEventListener('visibilitychange', syncCameras);
    setInterval(syncCameras, 1000);
    // the time axis of a trend moves on
    setInterval(() => {
        for (const tile of tiles.values()) {
            if (tile.args.type === 'trend' && tile.el?.isConnected) {
                drawTrend(tile);
            }
        }
    }, 60_000);

    // ---- pages, clock, idle ------------------------------------------------------------------------------------

    function currentPage() {
        const pages = pagesEl.querySelectorAll('.page');
        if (!pages.length || !pagesEl.clientWidth) {
            return 0;
        }
        const i = Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
        return Number(pages[Math.min(i, pages.length - 1)].dataset.page);
    }

    /** Titles of the pages (page_title): page → title */
    const pageTitles = new Map();

    /** The title of the page shown, next to the name of the tablet */
    function drawTitle() {
        $('pageTitle').textContent = pageTitles.get(currentPage()) || '';
    }

    /**
     * The dots of the pages, one button each: a tap goes to that page. The way off a page that a map fills, whose
     * every swipe moves the map. Built again only when the number of pages changes, else the buttons stay - a tap
     * while the pages scroll would otherwise lose its button between down and up.
     */
    function drawDots() {
        const dots = $('dots');
        const count = pagesEl.querySelectorAll('.page').length;
        const shown = count < 2 ? 0 : count;
        if (dots.children.length !== shown) {
            dots.textContent = '';
            for (let n = 0; n < shown; n++) {
                const dot = /** @type {HTMLButtonElement} */ (dots.appendChild(el('button')));
                dot.type = 'button';
                dot.dataset.index = String(n);
                dot.setAttribute('aria-label', t('page', { n: n + 1 }));
            }
        }
        const i = Math.round(pagesEl.scrollLeft / Math.max(1, pagesEl.clientWidth));
        [...dots.children].forEach((dot, n) => {
            dot.classList.toggle('on', n === i);
            dot.setAttribute('aria-current', n === i ? 'page' : 'false');
        });
    }
    $('dots').addEventListener('click', e => {
        const dot = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('#dots button'));
        if (dot) {
            pagesEl.scrollTo({ left: Number(dot.dataset.index) * pagesEl.clientWidth, behavior: 'smooth' });
        }
    });
    pagesEl.addEventListener(
        'scroll',
        () =>
            requestAnimationFrame(() => {
                drawDots();
                drawTitle();
                syncCameras();
            }),
        { passive: true },
    );

    const KEYPAD_MS = 30_000;

    function tick() {
        const now = new Date();
        $('clock').textContent = now.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' });
    }
    tick();
    setInterval(tick, 10_000);

    let lastTouch = Date.now();
    document.addEventListener(
        'pointerdown',
        () => {
            lastTouch = Date.now();
        },
        { capture: true, passive: true },
    );
    setInterval(() => {
        const idle = Date.now() - lastTouch;
        if (idle > IDLE_MS && pagesEl.scrollLeft > 0) {
            pagesEl.scrollTo({ left: 0, behavior: 'smooth' });
        }
        if (clock.enabled && !clock.shown && idle > clock.minutes * 60_000) {
            showClock();
        }
        // the keypad closes after 30 s without a key: back to the clock (as the satellite)
        if (clock.enabled && lock.locked && !clock.shown && idle > KEYPAD_MS) {
            showClock();
        }
        if (lock.enabled && !lock.locked) {
            // "when the display goes back to the clock": with the clock page that moment, else a minute untouched
            const limit = lock.mode === 0 ? lock.minutes * 60_000 : lock.mode === 1 && !clock.enabled ? IDLE_MS : 0;
            if (limit && idle > limit) {
                setLocked(true);
            }
        }
    }, 5000);

    // ---- the clock page of an idle tablet ----------------------------------------------------------------------

    const clock = { enabled: false, minutes: 2, shown: false };

    function drawClock() {
        const now = new Date();
        $('bigTime').textContent = now.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' });
        $('bigDate').textContent = now.toLocaleDateString(navigator.language, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        });
    }

    function showClock() {
        clock.shown = true;
        drawClock();
        $('clockPage').hidden = false;
        if (lock.enabled && lock.mode === 1 && !lock.locked) {
            setLocked(true);
        }
        drawPad();
    }

    function hideClock() {
        clock.shown = false;
        $('clockPage').hidden = true;
        drawPad();
    }

    setInterval(() => clock.shown && drawClock(), 10_000);

    // a touch on the clock: the keypad when the screen is locked, else the tiles
    $('clockPage').addEventListener('click', ev => {
        ev.stopPropagation();
        lastTouch = Date.now();
        hideClock();
    });

    /** @param {any} c - clock of the config: {enabled, minutes} */
    function clockConfig(c) {
        clock.enabled = !!c?.enabled;
        clock.minutes = Math.min(120, Math.max(1, Number(c?.minutes) || 2));
        if (!clock.enabled && clock.shown) {
            hideClock();
        }
    }

    // ---- screen lock (lock_config, as the firmware 2.1) -------------------------------------------------------

    const lock = {
        enabled: false,
        hash: '',
        length: 4,
        mode: 0,
        minutes: 5,
        locked: false,
        failed: 0,
        waitUntil: 0,
        typed: '',
    };
    let lockSeen = false;

    /** @param {any} d - lock_config */
    function lockConfig(d) {
        const was = lock.enabled;
        lock.enabled = !!d.enabled && /^[0-9a-f]{64}$/i.test(String(d.pin_hash || ''));
        lock.hash = String(d.pin_hash || '').toLowerCase();
        lock.length = Math.max(4, Math.min(6, Number(d.length) || 4));
        lock.mode = [0, 1, 2].includes(Number(d.mode)) ? Number(d.mode) : 0;
        lock.minutes = Math.max(1, Number(d.minutes) || 5);
        $('lockButton').hidden = !lock.enabled;
        if (!lock.enabled) {
            setLocked(false, true);
        } else if (!lockSeen || !was) {
            // after a start (of the app) a tablet with the lock on starts locked, as a satellite after a restart
            setLocked(true);
        } else {
            report();
        }
        lockSeen = true;
    }

    /**
     * @param {boolean} locked - Locked
     * @param {boolean} [quiet] - Do not report it (the adapter asked for it)
     */
    function setLocked(locked, quiet = false) {
        const next = lock.enabled && locked;
        if (next !== lock.locked || !quiet) {
            lock.locked = next;
            lock.typed = '';
            if (next && clock.enabled && !clock.shown) {
                // locked: the clock until the next touch
                showClock();
            }
            drawPad();
            report();
        }
    }

    function report() {
        if (ws && ws.readyState === 1 && lock.enabled) {
            ws.send(JSON.stringify({ type: 'lock', locked: lock.locked, failed: lock.failed }));
        }
    }

    function drawPad() {
        const pad = $('keypad');
        // a locked tablet with the clock page shows the clock first, the keypad after a touch
        pad.hidden = !lock.locked || clock.shown;
        $('stars').textContent =
            '•'.repeat(lock.typed.length) + '◦'.repeat(Math.max(0, lock.length - lock.typed.length));
        const wait = Math.ceil((lock.waitUntil - Date.now()) / 1000);
        $('padMessage').textContent = wait > 0 ? t('wait', { s: wait }) : lock.failed ? t('wrong') : '';
    }

    function buildPad() {
        const keys = pad => pad.querySelector('.keys');
        const box = keys($('keypad'));
        for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']) {
            const b = el('button', k ? '' : 'blank', k);
            b.type = 'button';
            b.addEventListener('click', () => key(k));
            box.appendChild(b);
        }
    }

    /** @param {string} k - Key of the keypad */
    function key(k) {
        if (!k || Date.now() < lock.waitUntil) {
            drawPad();
            return;
        }
        if (k === '⌫') {
            lock.typed = lock.typed.slice(0, -1);
        } else if (lock.typed.length < lock.length) {
            lock.typed += k;
        }
        if (lock.typed.length === lock.length) {
            if (sha256(`satellite-display:${lock.typed}`) === lock.hash) {
                lock.failed = 0;
                lock.typed = '';
                lastTouch = Date.now();
                setLocked(false);
                return;
            }
            lock.failed++;
            lock.typed = '';
            if (lock.failed % MAX_WRONG === 0) {
                lock.waitUntil = Date.now() + WAIT_MS;
                const timer = setInterval(() => {
                    drawPad();
                    if (Date.now() >= lock.waitUntil) {
                        clearInterval(timer);
                    }
                }, 1000);
            }
            report();
        }
        drawPad();
    }
    buildPad();
    $('lockButton').addEventListener('click', () => setLocked(true));

    // ---- notices -----------------------------------------------------------------------------------------------

    /**
     * @param {string} text - Text
     * @param {boolean} [block] - Cover the whole screen
     */
    function showNotice(text, block = false) {
        noticeEl.textContent = text;
        noticeEl.classList.toggle('block', block);
        noticeEl.dataset.kind = text === t('empty') ? 'empty' : '';
        noticeEl.hidden = false;
    }

    function hideNotice() {
        noticeEl.hidden = true;
    }

    // ---- the connection ----------------------------------------------------------------------------------------

    const accessKey = (() => {
        // the page of a tablet is /t/<key>/ (also the start page of the installed app); ?key= of older links
        const inPath = /^\/t\/([^/]+)\//.exec(location.pathname);
        let fromUrl = new URLSearchParams(location.search).get('key');
        if (inPath) {
            try {
                fromUrl = decodeURIComponent(inPath[1]);
            } catch {
                fromUrl = inPath[1];
            }
        }
        try {
            if (fromUrl) {
                localStorage.setItem('satellite-display.key', fromUrl);
                return fromUrl;
            }
            return localStorage.getItem('satellite-display.key') || '';
        } catch {
            return fromUrl || '';
        }
    })();

    /** Close code of the adapter: a newer connection of the same tablet took over (lib/tablet.js) */
    const REPLACED = 4000;
    /** Close code of the adapter: no tablet has this key (lib/tablet-server.js) */
    const UNKNOWN_KEY = 4001;
    let replacedHere = false;
    noticeEl.addEventListener('click', () => {
        if (replacedHere) {
            replacedHere = false;
            hideNotice();
            failures = 0;
            connect();
        }
    });

    let configured = false;
    let failures = 0;
    let retryTimer = 0;
    let connectingTimer = 0;

    function connect() {
        clearTimeout(retryTimer);
        if (ws && ws.readyState <= 1) {
            return;
        }
        const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?key=${encodeURIComponent(accessKey)}`;
        const socket = new WebSocket(url);
        ws = socket;
        let opened = false;
        clearTimeout(connectingTimer);
        connectingTimer = setTimeout(() => {
            if (socket.readyState !== 1) {
                showNotice(failures >= 3 ? t('refused') : t('connecting'));
            }
        }, 1500);
        socket.addEventListener('open', () => {
            opened = true;
            failures = 0;
            if (!replacedHere) {
                hideNotice();
            }
            $('link').classList.add('ok');
            socket.send(JSON.stringify({ type: 'hello', version: VERSION }));
        });
        socket.addEventListener('message', ev => {
            let msg;
            try {
                msg = JSON.parse(String(ev.data));
            } catch {
                return;
            }
            if (msg.type === 'config') {
                grid = msg.grid || grid;
                clockConfig(msg.clock);
                $('name').textContent = msg.name || '';
                // the keypad shows only the name of the tablet, never a page
                $('padName').textContent = msg.name || '';
                document.title = msg.name ? `${msg.name} - Tiles` : 'Tiles';
                configured = true;
                if (noticeEl.dataset.kind !== 'empty') {
                    hideNotice();
                }
                report();
            } else if (msg.type === 'action') {
                onAction(String(msg.name), msg.data || {});
            }
        });
        socket.addEventListener('close', ev => {
            if (ws !== socket) {
                return;
            }
            $('link').classList.remove('ok');
            if (ev.code === UNKNOWN_KEY) {
                // the key is not known (the tablet was removed or renamed away): say so, look again now and then
                showNotice(t('outdated'), true);
                retryTimer = setTimeout(connect, 30_000);
                return;
            }
            if (ev.code === REPLACED) {
                // the same link opened in another window (a browser tab next to the installed app): taking it back
                // at once would make the two windows throw each other out every second, so wait for a tap
                replacedHere = true;
                showNotice(t('replaced'), true);
                return;
            }
            if (!opened) {
                failures++;
            }
            const delay = Math.min(15_000, 1000 * 2 ** Math.min(failures, 4));
            retryTimer = setTimeout(connect, opened ? 1000 : delay);
            if (opened) {
                connectingTimer = setTimeout(() => showNotice(t('connecting')), 1500);
            }
        });
    }

    // back from the background (iOS closes the connection with the screen): connect at once
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            lastTouch = Date.now();
            if (!replacedHere && (!ws || ws.readyState > 1)) {
                failures = 0;
                connect();
            }
            keepAwake();
        }
    });

    // ---- keep the screen on, offline shell ---------------------------------------------------------------------

    let wakeLock = null;
    async function keepAwake() {
        try {
            if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => {
                    wakeLock = null;
                });
            }
        } catch {
            // not allowed (no secure context, battery saver): the screen goes dark by the settings of the tablet
        }
    }

    if ('serviceWorker' in navigator && window.isSecureContext) {
        navigator.serviceWorker.register('sw.js').catch(() => undefined);
    }

    if (!accessKey) {
        showNotice(t('noKey'), true);
    } else {
        connect();
        keepAwake();
    }
})();
