// ==UserScript==
// @name         Tealium event capture — Treehouse
// @namespace    treehouse.analytics
// @version      4.6
// @description  Logs every utag view/link event, with an on-screen field picker and JSON/CSV export. Persists across page loads and tabs.
// @match        *://*.rentaroof.co.uk/*
// @match        *://*.huurwoningen.nl/*
// @match        *://*.huurwoningen.com/*
// @match        *://*.pararius.nl/*
// @match        *://*.pararius.com/*
// @match        *://*.immomiet.de/*
// @match        *://*.mietsy.de/*
// @match        *://*.toitpourtoi.fr/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
// Domains are inferred from the Tealium profile names (huurwoningen-nl -> huurwoningen.nl etc.).
// Add or correct @match lines as needed — staging/acceptance hosts are not covered.
//
// You should not need to edit this file to change which attributes are shown.
// Use the Fields picker in the on-screen panel; it also takes custom keys.
(function () {
  'use strict';
  // ───────────────────────────────────────────────────────────────────────────
  // CATALOGUE — every attribute the picker offers.
  // Everything here is always CAPTURED; the picker controls what is DISPLAYED
  // and EXPORTED, so ticking a box later also reveals it on past captures.
  // ───────────────────────────────────────────────────────────────────────────
  var CATALOGUE = [
    { name: 'Event', keys: [
      'tealium_event', 'page_category', 'page_currency', 'brand',
      'page_country', 'page_language', 'ut.event'
    ]},
    { name: 'Interaction', keys: [
      'component_name', 'element_type', 'element_text',
      'interaction_id', 'interaction_type', 'destination_url'
    ]},
    { name: 'Listing (ODP)', keys: [
      'odp.listing_id_short', 'odp.listing_id', 'odp.property', 'odp.title', 'odp.city',
      'odp.offer', 'odp.price_pcm', 'odp.price_pw', 'odp.rooms', 'odp.bedrooms',
      'odp.interior', 'odp.offered_since', 'odp.page_type'
    ]},
    { name: 'Search (SERP)', keys: [
      'serp.result.search_query', 'serp.result.property_results',
      'serp.result.sorting', 'serp.result.page_number', 'serp.result.view'
    ]},
    { name: 'User', keys: [
      'logged_in', 'customer_id_sha256', 'customer_id', 'user_id', 'customer_type',
      'property_alerts_count', 'favourites_count', 'pets',
      'first_name_filled_in', 'last_name_filled_in',
      'telephone_number_filled_in', 'motivation_letter_filled_in'
    ]},
    { name: 'Reddit', keys: [
      'reddit.event_name', 'reddit.pixel_id',
      'cp._rdt_uuid', 'cp._rdt_cid', 'cp._rdt_em'
    ]},
    { name: 'Consent', keys: [
      'consent_decision', 'tci.consent_type',
      'tci.purposes_with_consent_all', 'tci.purposes_with_consent_processed',
      'tci.purposes_with_consent_unprocessed',
      'google_ad_storage_consent', 'google_ad_user_data_consent',
      'google_ad_personalization_consent', 'google_analytics_storage_consent',
      // Consent Mode transport settings rather than per-purpose decisions: they
      // control whether Google tags strip ad identifiers and whether gclid is
      // carried in the URL when ad_storage is denied. Kept in this group because
      // their value only makes sense next to the consent flags that drive them.
      'google_ads_data_redaction', 'google_url_passthrough',
      'microsoft_ad_storage_consent',
      'cp.OptanonConsent', 'cp.OptanonAlertBoxClosed', 'cp.eupubconsent-v2', 'cp.cc_cookie'
    ]},
    { name: 'Experiments', keys: [
      'ab_group.ab_active', 'ab_group.ab_specification'
    ]},
    { name: 'Tealium', keys: [
      'tealium_visitor_id', 'tealium_session_id', 'tealium_session_number',
      'tealium_session_event_number', 'tealium_random', 'tealium_timestamp_utc',
      'tealium_timestamp_epoch', 'tealium_timestamp_local',
      'tealium_account', 'tealium_profile', 'tealium_environment', 'tealium_datasource',
      'tealium_library_name', 'tealium_library_version',
      'ut.env', 'ut.profile', 'ut.version',
      'ut.account', 'ut.domain', 'ut.visitor_id', 'ut.session_id',
      'tealium.collect.datasourcekey', 'tealium.collect.profile',
      'tealium.collect.endpoint'
    ]},
    { name: 'Tealium cookies', keys: [
      'cp.utag_main_v_id', 'cp.utag_main_ses_id', 'cp.utag_main__sn', 'cp.utag_main__ss',
      'cp.utag_main__se', 'cp.utag_main__st', 'cp.utag_main__pn',
      'cp.utag_main_dc_visit', 'cp.utag_main_dc_event', 'cp.utag_main_dc_region',
      'cp.utagdb'
    ]},
    { name: 'Page / DOM', keys: [
      'dom.url', 'dom.pathname', 'dom.referrer', 'dom.title', 'dom.query_string',
      'dom.domain', 'dom.hash', 'dom.viewport_width', 'dom.viewport_height',
      'browser_agent', 'language_settings_browser'
    ]},
    { name: 'Meta tags', keys: [
      'meta.og:title', 'meta.og:url', 'meta.og:image', 'meta.description',
      'meta.og:description', 'meta.og:site_name', 'meta.og:type',
      'meta.og:image:width', 'meta.og:image:height',
      'meta.twitter:card', 'meta.viewport', 'meta.robots'
    ]},
    { name: 'localStorage', keys: [
      'ls.tealium_timing', 'ls.lastExternalReferrer', 'ls.lastExternalReferrerTime',
      'ls.dfValue', 'ls._gcl_ls', 'ls._uetsid', 'ls._uetsid_exp',
      'ls._uetvid', 'ls._uetvid_exp', 'ls.__paypal_gw_*'
    ]},
    { name: 'sessionStorage', keys: [
      'ss.tealium_fired_events', 'ss.dfValue', 'ss.checkout-conversion:*'
    ]},
    { name: 'Other vendors', keys: [
      'cp._ga', 'cp._ga_*', 'cp._fbp', 'cp._uetsid', 'cp._uetvid', 'cp._gcl_au',
      // Google's cookie is named _gcl_au, so cp._gcl_au is the correct mapping.
      // The double-underscore spelling also turns up in payloads — listed so it is
      // captured rather than dropped, but it points at a mistyped Cookie data
      // source in the profile and is worth fixing there.
      'cp.__gcl_au',
      'cp.g_state', 'cp._ta', 'cp._tas', 'cp._tac',
      'clarity.project_id', 'meta.facebook.pixel_id'
    ]}
  ];
  // Keys ending in '*' match by prefix — for values whose names carry a random
  // suffix (GA4 property ids, checkout tokens) and so cannot be listed literally.
  // Never captured: this script's own storage. 'ls.__tealium_cap' holds the
  // entire capture array, so recording it inside each row would nest the whole
  // history in every event and blow the localStorage quota within a few hits.
  var BLOCKLIST = ['ls.__tealium_cap', 'ls.__tealium_cap_fields', 'ls.__tealium_cap_custom',
                   'ls.__tealium_cap_ui', 'ss.__tealium_cap'];
  // Ticked on first run.
  var DEFAULT_ON = [
    'tealium_event', 'page_category', 'page_currency',
    'component_name', 'element_type', 'element_text',
    'interaction_id', 'interaction_type', 'destination_url',
    'odp.listing_id_short', 'odp.listing_id', 'odp.property', 'odp.title', 'odp.city',
    'odp.interior',
    'serp.result.search_query',
    'logged_in', 'customer_id_sha256',
    'reddit.event_name', 'reddit.pixel_id', 'cp._rdt_uuid', 'cp._rdt_cid', 'cp._rdt_em',
    'consent_decision', 'tci.consent_type',
    'google_ads_data_redaction', 'google_url_passthrough',
    'tealium.collect.endpoint', 'cp.__gcl_au'
  ];
  // Newly catalogued keys are ticked here so a fresh install still shows them.
  // An existing install already has its own tick list in localStorage and will
  // NOT pick these up: cataloguing a key removes it from the Uncatalogued block,
  // so without ticking it in the Fields picker (or running __capResetFields())
  // it would be captured silently and vanish from the console and the exports.
  var MAX_VALUE_LEN = 90;   // console display only; exports carry full values
  var MAX_ROWS = 500;
  var RAW_MAX_FIELDS = 25;  // payloads at or under this size keep every raw key/value
  var STORE_KEY  = '__tealium_cap';
  var UI_KEY     = '__tealium_cap_ui';
  var FIELDS_KEY = '__tealium_cap_fields';
  var CUSTOM_KEY = '__tealium_cap_custom';
  // ───────────────────────────────────────────────────────────────────────────
  // Storage — localStorage so captures survive tab closes and span tabs.
  // Clear between test runs.
  // ───────────────────────────────────────────────────────────────────────────
  function ls(k, fallback) {
    try { var v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load() { return ls(STORE_KEY, []); }
  function save(rows) { lsSet(STORE_KEY, rows.slice(-MAX_ROWS)); }
  function customKeys() { return ls(CUSTOM_KEY, []); }
  function groups() {
    var g = CATALOGUE.slice();
    var c = customKeys();
    if (c.length) g = g.concat([{ name: 'Custom', keys: c }]);
    return g;
  }
  function allKeys() {
    var out = [];
    groups().forEach(function (g) { g.keys.forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); }); });
    return out;
  }
  function enabledSet() {
    var arr = ls(FIELDS_KEY, null);
    if (!arr) { arr = DEFAULT_ON.slice(); lsSet(FIELDS_KEY, arr); }
    var s = {};
    arr.forEach(function (k) { s[k] = true; });
    return s;
  }
  // Turns a list of catalogue entries into a test for concrete payload keys.
  // Entries ending in '*' match by prefix; everything else must match exactly.
  function makeMatcher(keys) {
    var exact = {}, prefixes = [];
    keys.forEach(function (k) {
      if (k.charAt(k.length - 1) === '*') prefixes.push(k.slice(0, -1));
      else exact[k] = true;
    });
    return function (k) {
      if (exact[k]) return true;
      for (var i = 0; i < prefixes.length; i++) {
        if (k.indexOf(prefixes[i]) === 0) return true;
      }
      return false;
    };
  }
  function enabledMatcher() { return makeMatcher(Object.keys(enabledSet())); }
  function setEnabled(k, on) {
    var arr = ls(FIELDS_KEY, DEFAULT_ON.slice());
    var i = arr.indexOf(k);
    if (on && i < 0) arr.push(k);
    if (!on && i >= 0) arr.splice(i, 1);
    lsSet(FIELDS_KEY, arr);
  }
  // ───────────────────────────────────────────────────────────────────────────
  // DOM watch — remembers the element that was engaged with and the
  // data-analytics payload its markup carried at that moment.
  //
  // Why this matters: data-analytics attributes are rendered server-side. When a
  // component toggles state client-side without a reload (the favourite button
  // does exactly this), the attribute is not rewritten, so the tracked event can
  // describe the state the page was BUILT in rather than the state it is in.
  // Recording both sides is the only way to see that divergence.
  // ───────────────────────────────────────────────────────────────────────────
  // Correlation is primarily DETERMINISTIC, not time-based. Our listener runs in
  // the capture phase on window, i.e. before any site handler. While a click is
  // dispatching, `activeClick` is set; it is cleared on the next task, after the
  // whole dispatch has unwound. So a utag call made by the element's own handler
  // is linked with certainty — same dispatch, no guessing.
  //
  // `lastClick` is only a fallback for tracking that fires from an async callback
  // (after a fetch, or once a modal has rendered), where the dispatch has already
  // ended. Those attachments are corroborated against the fields that do not
  // change with component state, and are labelled so they are never mistaken for
  // the certain kind.
  var activeClick = null;
  var lastClick = null;
  var CLICK_WINDOW_MS = 2000;   // fallback only
  function describe(node) {
    if (!node || !node.tagName) return null;
    var cls = (typeof node.className === 'string' ? node.className : '') || '';
    var out = {
      tag: node.tagName.toLowerCase(),
      classes: cls,
      text: (node.textContent || '').trim().slice(0, 80)
    };
    if (node.getAttribute) {
      var ap = node.getAttribute('aria-pressed');
      var al = node.getAttribute('aria-label');
      if (ap != null) out.aria_pressed = ap;
      if (al != null) out.aria_label = al;
    }
    return out;
  }
  function watchClicks() {
    ['pointerdown', 'click'].forEach(function (ev) {
      window.addEventListener(ev, function (e) {
        try {
          var path = (e.composedPath && e.composedPath()) || [e.target];
          if (hostEl && path.indexOf(hostEl) >= 0) return;   // ignore this widget
          var holder = null;
          for (var i = 0; i < path.length; i++) {
            if (path[i] && path[i].getAttribute && path[i].getAttribute('data-analytics')) {
              holder = path[i]; break;
            }
          }
          var raw = holder ? holder.getAttribute('data-analytics') : null;
          var parsed = null;
          if (raw) {
            try { parsed = JSON.parse(raw); } catch (err) { parsed = { _unparsed: raw }; }
          }
          var form = null;
          try {
            var f = (holder || path[0]);
            f = f && f.closest ? f.closest('form') : null;
            if (f) form = { action: f.getAttribute('action'), method: f.getAttribute('method') };
          } catch (err) {}
          var info = {
            at: new Date().getTime(),
            analytics: parsed,
            element: describe(holder) || describe(path[0]),
            target: describe(path[0]),
            form: form
          };
          activeClick = info;
          lastClick = info;
          // Cleared on the next task — by then the click has finished dispatching
          // through every handler, so anything still calling utag is asynchronous.
          setTimeout(function () { if (activeClick === info) activeClick = null; }, 0);
        } catch (err) {}
      }, true);
    });
  }
  // Only interactions carry an engaged element. A page view is not caused by the
  // element that happens to have been clicked most recently — attaching markup to
  // one would imply a causal link that isn't there. View-typed events that closely
  // follow a click still get a one-line note (useful for the odd click-triggered
  // pseudo-view, e.g. the External listing mail alert artifact), but no
  // data-analytics block and no mismatch checks.
  function same(x, y) {
    return x != null && y != null && String(x).toLowerCase() === String(y).toLowerCase();
  }
  function differs(x, y) {
    return x != null && y != null && String(x).toLowerCase() !== String(y).toLowerCase();
  }
  function attachDom(row, d, type) {
    var src = null, link = '';
    if (activeClick) {
      src = activeClick;
      link = 'direct';                      // same click dispatch — certain
    } else if (lastClick && (new Date().getTime() - lastClick.at) <= CLICK_WINDOW_MS) {
      src = lastClick;
      link = 'async';                       // fired after the dispatch ended
    }
    if (!src) return;
    var age = new Date().getTime() - src.at;
    if (String(type).toLowerCase() === 'view') {
      var e0 = src.element;
      row._afterClick = (link === 'direct' ? 'emitted during a click on ' : age + 'ms after a click on ') +
        (e0 ? '<' + e0.tag + '>' + (e0.text ? ' “' + e0.text.slice(0, 40) + '”' : '') : 'an unknown element');
      return;
    }
    var a = src.analytics;
    // For an async attachment the dispatch link is gone, so corroborate against
    // the fields that do NOT change with component state. interaction_id and
    // element_text are deliberately excluded — those are exactly the ones that go
    // stale, and using them to confirm the pairing would hide the bug we are
    // looking for.
    if (link === 'async' && a) {
      var ok = (a.component_name == null || same(a.component_name, d['component_name'])) &&
               (a.element_type   == null || same(a.element_type,   d['element_type']));
      if (!ok) link = 'unverified';
    }
    var dom = { analytics: a, element: src.element, form: src.form, after_ms: age, link: link };
    // Compared case-insensitively so the extension's lowercasing is not reported
    // as a difference. Real staleness shows up as different words, not case.
    if (a && link !== 'unverified') {
      var flags = [];
      if (differs(a.interaction_id, d['interaction_id'])) {
        flags.push('interaction_id — DOM "' + a.interaction_id + '" vs payload "' + d['interaction_id'] + '"');
      }
      if (differs(a.element_text, d['element_text'])) {
        flags.push('element_text — DOM "' + a.element_text + '" vs payload "' + d['element_text'] + '"');
      }
      if (flags.length) dom.mismatch = flags;
    }
    row._dom = dom;
  }
  // ───────────────────────────────────────────────────────────────────────────
  // Row building — stores every catalogued key that is present
  // ───────────────────────────────────────────────────────────────────────────
  function build(via, type, d) {
    d = d || {};
    var row = {
      _time: new Date().toISOString().slice(11, 23),
      _via: via, _type: type,
      _path: location.pathname, _host: location.hostname,
      _fields: Object.keys(d).length,
      data: {}
    };
    // One pass over the payload: catalogued keys are stored, the rest are
    // recorded as uncatalogued. Small payloads (bridge pushes, dataLayer relays)
    // are exactly the interesting ones and the catalogue never covers them, so
    // keep their raw key/value pairs verbatim. Big payloads only get the key
    // names, to stay inside the localStorage quota.
    var isKnown   = makeMatcher(allKeys());
    var isBlocked = makeMatcher(BLOCKLIST);
    var extra = {}, n = 0;
    Object.keys(d).forEach(function (k) {
      if (isBlocked(k)) return;
      var v = d[k];
      if (v === undefined || v === null || v === '') return;
      if (isKnown(k)) { row.data[k] = v; }
      else { extra[k] = v; n++; }
    });
    if (n) {
      row._uncat = n;
      row._extra = (Object.keys(d).length <= RAW_MAX_FIELDS)
        ? extra
        : Object.keys(extra).slice(0, 60);
    }
    attachDom(row, d, type);
    return row;
  }
  function asText(v) { return (typeof v === 'object') ? JSON.stringify(v) : String(v); }
  function fmtValue(v) {
    var s = asText(v);
    return s.length > MAX_VALUE_LEN ? s.slice(0, MAX_VALUE_LEN) + '…' : s;
  }
  function pad(s, n) { while (s.length < n) s += ' '; return s; }
  function print(row) {
    var on = enabledSet();
    var isOn = enabledMatcher();
    var colour = row._via === 'recovered' ? '#9e9e9e'
               : row._type === 'view'     ? '#42a5f5' : '#66bb6a';
    var label = (on['interaction_id'] && row.data.interaction_id) ||
                (on['page_category'] && row.data.page_category) || row._type;
    console.groupCollapsed(
      '%c' + row._type.toUpperCase() + '%c  ' + label + '  %c' + row._path,
      'background:' + colour + ';color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold',
      'font-weight:bold',
      'color:#999;font-weight:normal'
    );
    var shown = {};
    groups().forEach(function (g) {
      var inGroup = makeMatcher(g.keys);
      var present = Object.keys(row.data).filter(function (k) {
        return !shown[k] && inGroup(k) && isOn(k);
      });
      present.forEach(function (k) { shown[k] = true; });
      if (!present.length) return;
      var width = Math.max.apply(null, present.map(function (k) { return k.length; }));
      console.log(
        '%c' + g.name + '\n%c' + present.map(function (k) {
          return '  ' + pad(k, width) + '  ' + fmtValue(row.data[k]);
        }).join('\n'),
        'color:' + colour + ';font-weight:bold',
        'color:inherit;font-family:monospace'
      );
    });
    if (row._dom) {
      var dm = row._dom, lines = [];
      if (dm.analytics) {
        Object.keys(dm.analytics).forEach(function (k) {
          lines.push('  ' + pad(k, 16) + '  ' + fmtValue(dm.analytics[k]));
        });
      } else {
        lines.push('  (no data-analytics on the clicked element or its ancestors)');
      }
      if (dm.element) {
        lines.push('  ' + pad('· element', 16) + '  <' + dm.element.tag + '>' +
          (dm.element.classes ? '  class="' + dm.element.classes + '"' : ''));
        if (dm.element.text) lines.push('  ' + pad('· live text', 16) + '  ' + fmtValue(dm.element.text));
        if (dm.element.aria_pressed != null) {
          lines.push('  ' + pad('· aria-pressed', 16) + '  ' + dm.element.aria_pressed);
        }
      }
      if (dm.form) {
        lines.push('  ' + pad('· form', 16) + '  ' + (dm.form.method || '') + ' ' + (dm.form.action || ''));
      }
      lines.push('  ' + pad('· link', 16) + '  ' + ({
        direct:     'same click dispatch — certain',
        async:      'fired ' + dm.after_ms + 'ms later, corroborated on component_name/element_type',
        unverified: 'fired ' + dm.after_ms + 'ms later and does NOT corroborate — treat as unrelated'
      })[dm.link] || dm.link);
      console.log('%cDOM — engaged element\n%c' + lines.join('\n'),
        'color:#ab47bc;font-weight:bold', 'color:inherit;font-family:monospace');
      if (dm.mismatch) {
        console.log('%c⚠ markup disagrees with the tracked payload\n%c  ' + dm.mismatch.join('\n  '),
          'color:#ffa726;font-weight:bold', 'color:#ffa726;font-family:monospace');
      }
    }
    if (row._afterClick) {
      console.log('%c· ' + row._afterClick, 'color:#9e9e9e;font-style:italic');
    }
    if (row._extra) {
      var isRaw = !Array.isArray(row._extra);
      console.log(
        '%cUncatalogued (' + row._uncat + ')\n%c' + (isRaw
          ? Object.keys(row._extra).map(function (k) {
              return '  ' + k + '  ' + fmtValue(row._extra[k]);
            }).join('\n')
          : '  ' + row._extra.join(', ') + '  …names only, payload too large'),
        'color:#ffa726;font-weight:bold',
        'color:inherit;font-family:monospace'
      );
    }
    console.log(
      '%c' + row._time + '  ·  via ' + row._via + '  ·  ' + row._fields + ' fields in payload',
      'color:#999;font-style:italic'
    );
    console.groupEnd();
  }
  function push(row) {
    var rows = load();
    rows.push(row);
    save(rows);
    print(row);
    refreshBadge();
  }
  // ───────────────────────────────────────────────────────────────────────────
  // Hook — handles all three call shapes:
  //   utag.track('link', data)      positional  ← what Treehouse sites use
  //   utag.track({event, data})     object form
  //   utag.link(data)
  // ───────────────────────────────────────────────────────────────────────────
  function record(fn, args) {
    try {
      var o = args[0], d = {}, type = fn;
      if (typeof o === 'string') {
        type = o;
        if (args[1] && typeof args[1] === 'object') d = args[1];
      } else if (o && typeof o === 'object') {
        if (o.data && typeof o.data === 'object') { type = o.event || fn; d = o.data; }
        else { d = o; }
      }
      push(build(fn, type, d));
    } catch (e) {
      console.log('%c[CAP] error', 'color:#e53935', e && e.message);
    }
  }
  var hooked = false;
  function hook(u) {
    if (hooked || !u || typeof u.track !== 'function') return false;
    ['view', 'link', 'track'].forEach(function (fn) {
      var orig = u[fn];
      if (typeof orig !== 'function' || orig.__cap) return;
      var w = function () { record(fn, arguments); return orig.apply(u, arguments); };
      w.__cap = true;
      u[fn] = w;
    });
    hooked = true;
    console.log('%c[CAP] hooked utag', 'color:#66bb6a;font-weight:bold');
    return true;
  }
  var tries = 0;
  var iv = setInterval(function () {
    if (hook(window.utag) || ++tries > 4000) clearInterval(iv);
  }, 5);
  // utag.js defines utag.track and fires the first view inside one synchronous
  // script execution, so no poll can interleave. That first view is reconstructed
  // from utag_data instead and marked via:"recovered". Everything after is live.
  function recoverInitialView() {
    try {
      if (!window.utag_data) return;
      var seen = load().some(function (r) {
        return r._path === location.pathname && (r._type === 'view' || r._via === 'recovered');
      });
      if (!seen) push(build('recovered', 'view', window.utag_data));
    } catch (e) {}
  }
  // ───────────────────────────────────────────────────────────────────────────
  // Export — respects the field picker
  // ───────────────────────────────────────────────────────────────────────────
  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }
  function visibleRows() {
    var on = enabledMatcher();
    return load().map(function (r) {
      var o = { _time: r._time, _type: r._type, _via: r._via, _host: r._host, _path: r._path, _fields: r._fields, data: {} };
      if (r._extra) { o._uncat = r._uncat; o._extra = r._extra; }
      if (r._dom) { o._dom = r._dom; }
      if (r._afterClick) { o._afterClick = r._afterClick; }
      Object.keys(r.data).forEach(function (k) { if (on(k)) o.data[k] = r.data[k]; });
      return o;
    });
  }
  function toJSON() { return JSON.stringify(visibleRows(), null, 2); }
  function toCSV() {
    var rows = visibleRows();
    var meta = ['_time', '_type', '_via', '_host', '_path', '_fields',
                '_dom_interaction_id', '_dom_element_text', '_dom_component_name',
                '_dom_classes', '_dom_form', '_dom_link', '_dom_mismatch', '_extra'];
    // Derived columns: the markup's own view of the element that was engaged with.
    function metaVal(r, m) {
      var a = r._dom && r._dom.analytics, el = r._dom && r._dom.element, f = r._dom && r._dom.form;
      switch (m) {
        case '_dom_interaction_id': return a ? a.interaction_id : '';
        case '_dom_element_text':   return a ? a.element_text : '';
        case '_dom_component_name': return a ? a.component_name : '';
        case '_dom_classes':        return el ? el.classes : '';
        case '_dom_form':           return f ? ((f.method || '') + ' ' + (f.action || '')).trim() : '';
        case '_dom_mismatch':       return r._dom && r._dom.mismatch ? r._dom.mismatch.join(' ; ') : '';
        case '_dom_link':           return r._dom ? r._dom.link : '';
        default: return r[m];
      }
    }
    // Columns are the concrete keys actually present, ordered by catalogue group
    // (a wildcard entry can expand to several real columns).
    var seen = {}, cols = [];
    rows.forEach(function (r) { Object.keys(r.data).forEach(function (k) { seen[k] = true; }); });
    var taken = {};
    groups().forEach(function (g) {
      var inGroup = makeMatcher(g.keys);
      Object.keys(seen).forEach(function (k) {
        if (!taken[k] && inGroup(k)) { taken[k] = true; cols.push(k); }
      });
    });
    function esc(v) {
      if (v === undefined || v === null) return '';
      var s = asText(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [meta.concat(cols).join(',')];
    rows.forEach(function (r) {
      lines.push(meta.map(function (m) { return esc(metaVal(r, m)); })
        .concat(cols.map(function (c) { return esc(r.data[c]); })).join(','));
    });
    return lines.join('\n');
  }
  function download(text, filename, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }
  function copy(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); done(ok);
    }
  }
  // ───────────────────────────────────────────────────────────────────────────
  // Floating panel
  //
  // Event handling note: the widget lives in a shadow root, and the ONLY place
  // propagation is stopped is a bubble-phase listener on the host element. An
  // earlier version blocked in the capture phase on an inner node, which killed
  // the widget's own handlers before they ran — that was the dead-click bug.
  // Drag listeners use capture on window so they still fire while the pointer
  // is over the host.
  // ───────────────────────────────────────────────────────────────────────────
  var badgeEl = null, panelEl = null, hostEl = null, toastEl = null, fieldsEl = null;
  function refreshBadge() { if (badgeEl) badgeEl.textContent = String(load().length); }
  function toast(msg, ok) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.color = ok === false ? '#ff8a80' : '#b9f6ca';
    toastEl.style.opacity = '1';
    setTimeout(function () { toastEl.style.opacity = '0'; }, 1800);
  }
  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }
  function renderFields() {
    fieldsEl.textContent = '';
    var on = enabledSet();
    groups().forEach(function (g) {
      var head = el('div', 'display:flex;align-items:center;justify-content:space-between;' +
        'margin:8px 0 3px;font-weight:700;color:#8ecdf5;font-size:11px;text-transform:uppercase;letter-spacing:.4px');
      head.appendChild(el('span', null, g.name));
      var toggle = el('span', 'cursor:pointer;color:#888;font-weight:600;text-transform:none;letter-spacing:0', 'all / none');
      toggle.addEventListener('click', function () {
        var allOn = g.keys.every(function (k) { return enabledSet()[k]; });
        g.keys.forEach(function (k) { setEnabled(k, !allOn); });
        renderFields();
      });
      head.appendChild(toggle);
      fieldsEl.appendChild(head);
      g.keys.forEach(function (k) {
        var row = el('label', 'display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;font-size:11px;color:#ddd');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!on[k];
        cb.style.cssText = 'margin:0;cursor:pointer';
        cb.addEventListener('change', function () { setEnabled(k, cb.checked); });
        row.appendChild(cb);
        row.appendChild(el('span', 'font-family:ui-monospace,Menlo,monospace', k));
        fieldsEl.appendChild(row);
      });
    });
    // Custom key entry
    var add = el('div', 'display:flex;gap:4px;margin:10px 0 2px');
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'add any UDO key…';
    input.style.cssText = 'flex:1;min-width:0;background:#2a2a2a;border:1px solid #444;color:#eee;' +
      'border-radius:5px;padding:5px 6px;font:11px ui-monospace,Menlo,monospace';
    var btn = el('button', 'background:#2f6f3f;border:0;color:#fff;border-radius:5px;padding:5px 9px;' +
      'font:700 11px inherit;cursor:pointer', 'Add');
    function addKey() {
      var k = input.value.trim();
      if (!k) return;
      var c = customKeys();
      if (CATALOGUE.some(function (g) { return g.keys.indexOf(k) >= 0; })) {
        setEnabled(k, true);
      } else if (c.indexOf(k) < 0) {
        c.push(k); lsSet(CUSTOM_KEY, c); setEnabled(k, true);
      }
      input.value = '';
      renderFields();
      toast('Added ' + k);
    }
    btn.addEventListener('click', addKey);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addKey(); } });
    add.appendChild(input); add.appendChild(btn);
    fieldsEl.appendChild(add);
    fieldsEl.appendChild(el('div', 'font-size:10px;color:#777;margin-top:4px',
      'All catalogued keys are always captured — these boxes filter the console and the exports, including past captures.'));
  }
  function buildUI() {
    if (hostEl || !document.body) return;
    var ui = ls(UI_KEY, {});
    hostEl = document.createElement('div');
    hostEl.id = '__tealium_cap_host';
    hostEl.style.cssText = 'position:fixed;z-index:2147483647;' +
      'right:' + (ui.right != null ? ui.right : 16) + 'px;' +
      'bottom:' + (ui.bottom != null ? ui.bottom : 16) + 'px;';
    document.body.appendChild(hostEl);
    // The one and only propagation guard: bubble phase, on the host, so inner
    // handlers have already run and the site's handlers never see the event.
    ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'keydown']
      .forEach(function (ev) { hostEl.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    var root = hostEl.attachShadow ? hostEl.attachShadow({ mode: 'open' }) : hostEl;
    var wrap = el('div', 'font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif');
    var pill = el('div', 'display:flex;align-items:center;gap:8px;background:#1e1e1e;color:#eee;' +
      'font-weight:700;font-size:12px;padding:8px 10px;border-radius:999px;' +
      'box-shadow:0 3px 12px rgba(0,0,0,.35);cursor:grab;user-select:none');
    pill.appendChild(el('span', 'width:8px;height:8px;border-radius:50%;background:#66bb6a'));
    pill.appendChild(el('span', null, 'CAP'));
    badgeEl = el('span', 'background:#333;border-radius:999px;padding:2px 7px', '0');
    pill.appendChild(badgeEl);
    wrap.appendChild(pill);
    panelEl = el('div', 'display:none;margin-top:8px;background:#1e1e1e;color:#eee;border-radius:10px;' +
      'padding:10px;box-shadow:0 3px 16px rgba(0,0,0,.4);width:280px;max-height:70vh;overflow:auto');
    wrap.appendChild(panelEl);
    function mkBtn(label, css) {
      return el('button', 'display:block;width:100%;margin:4px 0;padding:7px 9px;border:0;border-radius:6px;' +
        'background:' + (css || '#2f2f2f') + ';color:#eee;font:700 12px inherit;text-align:left;cursor:pointer', label);
    }
    var bFields = mkBtn('⚙  Fields…');
    var bCopy   = mkBtn('Copy JSON');
    var bJSON   = mkBtn('Download JSON');
    var bCSV    = mkBtn('Download CSV');
    var bClear  = mkBtn('Clear captures', '#4a2222');
    [bFields, bCopy, bJSON, bCSV, bClear].forEach(function (b) { panelEl.appendChild(b); });
    toastEl = el('div', 'margin-top:6px;font-size:11px;opacity:0;transition:opacity .2s;min-height:14px');
    panelEl.appendChild(toastEl);
    fieldsEl = el('div', 'display:none;border-top:1px solid #333;margin-top:8px;padding-top:4px');
    panelEl.appendChild(fieldsEl);
    bFields.addEventListener('click', function () {
      var open = fieldsEl.style.display === 'none';
      fieldsEl.style.display = open ? 'block' : 'none';
      bFields.textContent = open ? '⚙  Fields ▾' : '⚙  Fields…';
      if (open) renderFields();
    });
    bCopy.addEventListener('click', function () {
      var n = load().length;
      copy(toJSON(), function (ok) { toast(ok ? 'Copied ' + n + ' events' : 'Copy failed', ok); });
    });
    bJSON.addEventListener('click', function () {
      download(toJSON(), 'tealium-capture-' + stamp() + '.json', 'application/json');
      toast('Downloaded ' + load().length + ' events');
    });
    bCSV.addEventListener('click', function () {
      download(toCSV(), 'tealium-capture-' + stamp() + '.csv', 'text/csv');
      toast('Downloaded ' + load().length + ' events');
    });
    bClear.addEventListener('click', function () {
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      refreshBadge(); toast('Cleared');
    });
    root.appendChild(wrap);
    refreshBadge();
    // Click anywhere outside the widget (or press Escape) to close.
    // composedPath() is used because the widget lives in a shadow root, so
    // e.target from outside reports the host, never the inner element.
    function closePanel() {
      panelEl.style.display = 'none';
      fieldsEl.style.display = 'none';
      bFields.textContent = '⚙  Fields…';
    }
    function isOutside(e) {
      var path = (e.composedPath && e.composedPath()) || [];
      if (path.indexOf(hostEl) >= 0) return false;
      return !(hostEl.contains && hostEl.contains(e.target));
    }
    ['mousedown', 'touchstart'].forEach(function (ev) {
      window.addEventListener(ev, function (e) {
        if (panelEl.style.display === 'none') return;
        if (isOutside(e)) closePanel();
      }, true);
    });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelEl.style.display !== 'none') closePanel();
    }, true);
    // Drag to reposition; a click without movement toggles the panel.
    var dragging = false, moved = false, sx = 0, sy = 0, sr = 0, sb = 0;
    pill.addEventListener('mousedown', function (e) {
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      sr = parseInt(hostEl.style.right, 10) || 16;
      sb = parseInt(hostEl.style.bottom, 10) || 16;
      pill.style.cursor = 'grabbing';
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var dx = sx - e.clientX, dy = sy - e.clientY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      hostEl.style.right = Math.max(0, sr + dx) + 'px';
      hostEl.style.bottom = Math.max(0, sb + dy) + 'px';
    }, true);
    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      pill.style.cursor = 'grab';
      if (moved) {
        lsSet(UI_KEY, { right: parseInt(hostEl.style.right, 10), bottom: parseInt(hostEl.style.bottom, 10) });
      } else {
        panelEl.style.display = (panelEl.style.display === 'none') ? 'block' : 'none';
      }
    }, true);
  }
  function init() {
    buildUI();
    setTimeout(recoverInitialView, 800);
  }
  watchClicks();   // before init: clicks must be seen even if the UI never builds
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // ───────────────────────────────────────────────────────────────────────────
  // Console helpers
  // ───────────────────────────────────────────────────────────────────────────
  window.__capDump = function () {
    console.table(visibleRows().map(function (r) {
      return {
        time: r._time, type: r._type,
        page_category: r.data.page_category,
        interaction_id: r.data.interaction_id,
        dom_interaction_id: r._dom && r._dom.analytics ? r._dom.analytics.interaction_id : '',
        mismatch: r._dom && r._dom.mismatch ? '⚠' : '',
        element_text: r.data.element_text,
        listing_id: r.data['odp.listing_id_short'] || r.data['odp.listing_id'],
        reddit_event: r.data['reddit.event_name'],
        path: r._path
      };
    }));
    return toJSON();
  };
  window.__capCSV = toCSV;
  window.__capClear = function () {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    refreshBadge();
    console.log('%c[CAP] cleared', 'color:#66bb6a');
  };
  window.__capResetFields = function () {
    lsSet(FIELDS_KEY, DEFAULT_ON.slice());
    try { localStorage.removeItem(CUSTOM_KEY); } catch (e) {}
    if (fieldsEl && fieldsEl.style.display !== 'none') renderFields();
    console.log('%c[CAP] fields reset to defaults', 'color:#66bb6a');
  };
  console.log(
    '%c[CAP] armed%c  panel bottom-right · __capDump() · __capCSV() · __capClear() · __capResetFields()',
    'background:#66bb6a;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold',
    'color:#999'
  );
})();
// Note on 'ut.event': in captured payloads it reads "view" even on link events,
// because it reflects the last page view rather than the current track type.
// Use the _type column instead.