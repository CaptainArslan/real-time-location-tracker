(() => {
    'use strict';

    // ---------------- Settings ----------------
    const SELF = 'self';
    const NAME_KEY = 'tracker-name';
    const MAX_TRAIL_POINTS = 200;   // per person
    const MIN_TRAIL_STEP_M = 3;     // ignore GPS jitter smaller than this
    // Orienteering map colours for other people (water, forest, contour, ...)
    const OTHER_COLORS = ['#2B6CB0', '#2F7D4A', '#9A5B34', '#1F7A80', '#8A6D0B', '#5A5F9E'];

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mobileQuery = window.matchMedia('(max-width: 640px)');

    const $ = (id) => document.getElementById(id);
    const els = {
        panel: $('panel'),
        sheetToggle: $('sheet-toggle'),
        status: $('status'),
        statusText: $('status-text'),
        name: $('name-input'),
        notice: $('notice'),
        list: $('people'),
        count: $('people-count'),
        empty: $('empty'),
        copy: $('copy-link'),
        copyLabel: $('copy-label'),
        zoomIn: $('zoom-in'),
        zoomOut: $('zoom-out'),
        locate: $('locate-btn'),
        fit: $('fit-btn'),
    };

    const storage = {
        get(key) { try { return localStorage.getItem(key); } catch { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
    };

    // ---------------- State ----------------
    const people = new Map();   // id -> person (SELF is you)
    let myName = (storage.get(NAME_KEY) || '').slice(0, 24);
    let lastFix = null;         // your latest { latitude, longitude, accuracy }
    let following = true;       // keep the map centred on you
    let hasCentered = false;

    els.name.value = myName;

    // ---------------- Map ----------------
    const map = L.map('map', { zoomControl: false, worldCopyJump: true }).setView([20, 0], 2);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            + ' | Built by <a href="https://portfolio-cyan-five-61.vercel.app/">M Arslan</a>',
    }).addTo(map);

    map.on('dragstart', () => setFollowing(false));

    // ---------------- Helpers ----------------
    function distanceMeters([lat1, lng1], [lat2, lng2]) {
        const R = 6371000;
        const toRad = (d) => (d * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(a));
    }

    function formatDistance(m) {
        if (m < 1000) return `${Math.round(m)} m`;
        if (m < 10000) return `${(m / 1000).toFixed(1)} km`;
        return `${Math.round(m / 1000)} km`;
    }

    function timeAgo(ms) {
        const s = Math.max(0, Math.round(ms / 1000));
        if (s < 10) return 'just now';
        if (s < 60) return `${s} s ago`;
        const min = Math.round(s / 60);
        if (min < 60) return `${min} min ago`;
        return `${Math.round(min / 60)} h ago`;
    }

    function colorFor(id) {
        let hash = 0;
        for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
        // Start from the id's colour, but skip colours already on the map
        const used = new Set([...people.values()].map((p) => p.color));
        for (let i = 0; i < OTHER_COLORS.length; i++) {
            const color = OTHER_COLORS[(hash + i) % OTHER_COLORS.length];
            if (!used.has(color)) return color;
        }
        return OTHER_COLORS[hash % OTHER_COLORS.length];
    }

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function displayName(p) {
        if (p.isSelf) return myName ? `${myName} (you)` : 'You';
        return p.name || `Guest ${p.id.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase()}`;
    }

    function initial(p) {
        return displayName(p).charAt(0).toUpperCase();
    }

    function el(tag, className) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        return node;
    }

    // ---------------- Markers & list rows ----------------
    function pinIcon(p) {
        const pin = el('div', p.isSelf ? 'pin pin--self' : 'pin');
        pin.style.setProperty('--c', p.color);
        const dot = el('span', 'pin-dot');
        if (!p.isSelf) dot.textContent = initial(p);   // textContent: names are user input
        pin.appendChild(dot);
        return L.divIcon({ html: pin, className: 'pin-icon', iconSize: [34, 34], iconAnchor: [17, 17] });
    }

    function createRow(p) {
        const li = el('li');
        const btn = el('button', 'person');
        btn.type = 'button';
        btn.addEventListener('click', () => focusPerson(p.id));

        const avatar = el('span', p.isSelf ? 'avatar avatar--self' : 'avatar');
        avatar.style.setProperty('--c', p.color);
        avatar.setAttribute('aria-hidden', 'true');
        const main = el('span', 'person-main');
        const name = el('span', 'person-name');
        const sub = el('span', 'person-sub');
        const dist = el('span', 'person-dist');
        main.append(name, sub);
        btn.append(avatar, main, dist);
        li.append(btn);

        p.els = { li, btn, avatar, name, sub, dist };
    }

    function refreshPerson(p) {
        const name = displayName(p);
        p.els.name.textContent = name;
        p.label.textContent = p.isSelf ? 'You' : name;
        if (!p.isSelf) p.els.avatar.textContent = initial(p);

        if (p.isSelf) {
            p.els.sub.textContent = p.accuracyM ? `Accurate to ${formatDistance(p.accuracyM)}` : 'Location found';
            p.els.dist.textContent = '';
        } else {
            p.els.sub.textContent = `Updated ${timeAgo(Date.now() - p.updatedAt)}`;
            p.els.dist.textContent = lastFix
                ? formatDistance(distanceMeters([lastFix.latitude, lastFix.longitude], [p.lat, p.lng]))
                : '';
        }

        const away = p.els.dist.textContent ? `, ${p.els.dist.textContent} away` : '';
        p.els.btn.setAttribute('aria-label', `${name}, ${p.els.sub.textContent}${away}. Show on map`);
    }

    function upsertPerson(id, data, isSelf = false) {
        const latlng = [data.latitude, data.longitude];
        let p = people.get(id);

        if (!p) {
            const color = isSelf ? cssVar('--overprint') : colorFor(id);
            p = { id, isSelf, color, name: '', points: [] };

            p.label = el('span');
            p.marker = L.marker(latlng, { icon: pinIcon(p), keyboard: false, zIndexOffset: isSelf ? 1000 : 0 })
                .bindTooltip(p.label, { permanent: true, direction: 'bottom', offset: [0, 16], className: 'pin-label' })
                .addTo(map);
            p.trail = L.polyline([], {
                color, weight: isSelf ? 5 : 4, opacity: 0.75, lineCap: 'round', lineJoin: 'round', interactive: false,
            }).addTo(map);
            if (isSelf) {
                p.accuracy = L.circle(latlng, {
                    radius: 0, color, weight: 1, opacity: 0.45, fillColor: color, fillOpacity: 0.08, interactive: false,
                }).addTo(map);
            }

            createRow(p);
            people.set(id, p);
        } else {
            p.marker.setLatLng(latlng);
        }

        const newName = isSelf ? myName : (data.name || '');
        const nameChanged = newName !== p.name;
        p.name = newName;
        p.lat = data.latitude;
        p.lng = data.longitude;
        p.accuracyM = data.accuracy;
        p.updatedAt = data.updatedAt || Date.now();

        // Trail: only add a point when they actually moved
        const last = p.points[p.points.length - 1];
        if (!last || distanceMeters(last, latlng) >= MIN_TRAIL_STEP_M) {
            p.points.push(latlng);
            if (p.points.length > MAX_TRAIL_POINTS) p.points.shift();
            p.trail.setLatLngs(p.points);
        }

        if (p.accuracy) {
            p.accuracy.setLatLng(latlng);
            p.accuracy.setRadius(data.accuracy || 0);
        }
        if (nameChanged && !isSelf) p.marker.setIcon(pinIcon(p));

        refreshPerson(p);
        renderList();
    }

    function removePerson(id) {
        const p = people.get(id);
        if (!p) return;
        p.marker.remove();
        p.trail.remove();
        if (p.accuracy) p.accuracy.remove();
        p.els.li.remove();
        people.delete(id);
        renderList();
    }

    // You first, then everyone else nearest-first
    function renderList() {
        const self = people.get(SELF);
        const others = [...people.values()].filter((p) => !p.isSelf);
        if (lastFix) {
            const here = [lastFix.latitude, lastFix.longitude];
            others.sort((a, b) => distanceMeters(here, [a.lat, a.lng]) - distanceMeters(here, [b.lat, b.lng]));
        } else {
            others.sort((a, b) => displayName(a).localeCompare(displayName(b)));
        }
        const ordered = (self ? [self, ...others] : others).map((p) => p.els.li);

        // Only touch the DOM if the order changed (keeps keyboard focus stable)
        const current = [...els.list.children];
        if (ordered.length !== current.length || ordered.some((li, i) => li !== current[i])) {
            els.list.replaceChildren(...ordered);
        }

        const total = people.size;
        els.count.textContent = total === 1 ? '1 person' : `${total} people`;
        els.empty.hidden = others.length > 0;
    }

    // ---------------- Map controls ----------------
    function setFollowing(on) {
        following = on;
        els.locate.setAttribute('aria-pressed', String(on));
    }

    // Map centre that puts `latlng` in the middle of the *visible* area,
    // i.e. not hidden behind the side panel (desktop) or bottom sheet (phone).
    function visibleCenter(latlng, zoom) {
        const offset = mobileQuery.matches
            ? L.point(0, els.panel.offsetHeight / 2)
            : L.point(-(els.panel.offsetWidth + 32) / 2, 0);
        return map.unproject(map.project(latlng, zoom).add(offset), zoom);
    }

    function fitPadding() {
        if (mobileQuery.matches) {
            return { paddingTopLeft: [40, 40], paddingBottomRight: [72, els.panel.offsetHeight + 40], maxZoom: 17 };
        }
        return { paddingTopLeft: [els.panel.offsetWidth + 56, 48], paddingBottomRight: [96, 48], maxZoom: 17 };
    }

    function focusPerson(id) {
        const p = people.get(id);
        if (!p) return;
        setFollowing(p.isSelf);
        const zoom = Math.max(map.getZoom(), 16);
        map.flyTo(visibleCenter([p.lat, p.lng], zoom), zoom, { animate: !reduceMotion, duration: 0.8 });
    }

    function fitEveryone() {
        const points = [...people.values()].map((p) => [p.lat, p.lng]);
        if (!points.length) return;
        setFollowing(false);
        if (points.length === 1) {
            map.flyTo(visibleCenter(points[0], 16), 16, { animate: !reduceMotion });
        } else {
            map.flyToBounds(points, { ...fitPadding(), animate: !reduceMotion });
        }
    }

    els.zoomIn.addEventListener('click', () => map.zoomIn());
    els.zoomOut.addEventListener('click', () => map.zoomOut());
    els.fit.addEventListener('click', fitEveryone);
    els.locate.addEventListener('click', () => {
        if (!lastFix) return;
        setFollowing(true);
        focusPerson(SELF);
    });

    // ---------------- Panel ----------------
    els.sheetToggle.addEventListener('click', () => {
        const open = els.panel.dataset.open !== 'true';
        els.panel.dataset.open = String(open);
        els.sheetToggle.setAttribute('aria-expanded', String(open));
        els.sheetToggle.setAttribute('aria-label', open ? 'Hide people list' : 'Show people list');
    });

    // Lift the map credit above the bottom sheet on phones
    const syncSheetHeight = () => {
        const h = mobileQuery.matches ? els.panel.offsetHeight : 0;
        document.documentElement.style.setProperty('--sheet-h', `${h}px`);
    };
    if ('ResizeObserver' in window) new ResizeObserver(syncSheetHeight).observe(els.panel);
    mobileQuery.addEventListener('change', syncSheetHeight);
    syncSheetHeight();

    let nameTimer;
    els.name.addEventListener('input', () => {
        clearTimeout(nameTimer);
        nameTimer = setTimeout(() => {
            myName = els.name.value.trim().slice(0, 24);
            storage.set(NAME_KEY, myName);
            const me = people.get(SELF);
            if (me) refreshPerson(me);
            sendLocation();
        }, 400);
    });

    // ---------------- Appearance (System / Light / Dark) ----------------
    const THEME_KEY = 'tracker-theme';
    const themeMeta = $('theme-color');
    const themeRadios = document.querySelectorAll('input[name="theme"]');
    let themeChoice = storage.get(THEME_KEY) || 'system';

    function applyTheme() {
        const root = document.documentElement;
        if (themeChoice === 'light' || themeChoice === 'dark') root.dataset.theme = themeChoice;
        else delete root.dataset.theme;

        themeMeta.content = cssVar('--paper');
        // Your trail and accuracy circle are drawn by Leaflet, so recolour them
        const me = people.get(SELF);
        if (me) {
            me.color = cssVar('--overprint');
            me.trail.setStyle({ color: me.color });
            me.accuracy.setStyle({ color: me.color, fillColor: me.color });
        }
    }

    themeRadios.forEach((radio) => {
        radio.checked = radio.value === themeChoice;
        radio.addEventListener('change', () => {
            themeChoice = radio.value;
            storage.set(THEME_KEY, themeChoice);
            applyTheme();
        });
    });
    // "System" follows the device if it switches between light and dark
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    applyTheme();

    let copyTimer;
    els.copy.addEventListener('click', async () => {
        let message;
        try {
            await navigator.clipboard.writeText(window.location.href);
            message = 'Link copied';
        } catch {
            message = "Couldn't copy. Copy the address bar instead.";
        }
        els.copyLabel.textContent = message;
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { els.copyLabel.textContent = 'Copy invite link'; }, 2500);
    });

    function showNotice(text, tone = 'info') {
        els.notice.textContent = text;
        els.notice.dataset.tone = tone;
        els.notice.hidden = false;
    }

    function hideNotice() {
        els.notice.hidden = true;
    }

    // Keep "Updated 12 s ago" fresh
    setInterval(() => people.forEach(refreshPerson), 5000);

    // ---------------- Socket ----------------
    const socket = io();

    function setStatus(state, text) {
        els.status.dataset.state = state;
        els.statusText.textContent = text;
    }

    function sendLocation() {
        if (lastFix && socket.connected) socket.emit('send-location', { ...lastFix, name: myName });
    }

    socket.on('connect', () => {
        setStatus('live', 'Live');
        // After a reconnect the server sends a fresh list, so clear old markers
        [...people.keys()].forEach((id) => { if (id !== SELF) removePerson(id); });
        sendLocation();
    });
    socket.on('disconnect', () => setStatus('offline', 'Reconnecting'));
    socket.on('connect_error', () => setStatus('offline', 'Offline'));

    socket.on('existing-users', (list) => {
        list.forEach((user) => { if (user.id !== socket.id) upsertPerson(user.id, user); });
        if (noOwnLocation && !hasCentered) showOthersInstead();
    });

    // Without your own location, zoom to whoever else is on the map
    let noOwnLocation = false;
    function showOthersInstead() {
        noOwnLocation = true;
        if (hasCentered || people.size === 0) return;
        hasCentered = true;
        fitEveryone();
    }

    socket.on('receive-location', (data) => {
        if (data.id === socket.id) return;   // you're drawn from your own GPS
        upsertPerson(data.id, data);
        if (noOwnLocation && !hasCentered) showOthersInstead();
    });

    socket.on('user-disconnected', ({ id }) => removePerson(id));

    // ---------------- Geolocation ----------------
    function onPosition(position) {
        const { latitude, longitude, accuracy } = position.coords;
        lastFix = { latitude, longitude, accuracy: Math.round(accuracy) };
        hideNotice();

        upsertPerson(SELF, { ...lastFix, updatedAt: Date.now() }, true);
        sendLocation();
        people.forEach(refreshPerson);   // distances changed

        if (!hasCentered) {
            els.locate.disabled = false;
            map.setView(visibleCenter([latitude, longitude], 16), 16);
            hasCentered = true;
        } else if (following) {
            map.panTo(visibleCenter([latitude, longitude], map.getZoom()), { animate: !reduceMotion });
        }
    }

    function onPositionError(error) {
        if (!lastFix) showOthersInstead();
        if (error.code === error.PERMISSION_DENIED) {
            showNotice('Location access is blocked. Allow it for this site in your browser settings, then reload the page.', 'error');
        } else if (lastFix) {
            // Keep showing the last known position; the browser keeps trying
        } else if (error.code === error.POSITION_UNAVAILABLE) {
            showNotice("Your device can't find its position. Turn on location services or move somewhere with a clearer view of the sky.", 'warn');
        } else {
            showNotice('Still waiting for a GPS signal. Indoors this can take a little longer.', 'warn');
        }
    }

    if (!('geolocation' in navigator)) {
        showNotice("This browser can't share location. Try a recent version of Chrome, Safari, or Firefox.", 'error');
        showOthersInstead();
    } else if (!window.isSecureContext) {
        showNotice('Location only works over a secure connection. Open this page with https:// (or on localhost).', 'error');
        showOthersInstead();
    } else {
        showNotice('Finding your location. Allow location access if your browser asks.');
        navigator.geolocation.watchPosition(onPosition, onPositionError, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
        });
    }
})();
