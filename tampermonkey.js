// ==UserScript==
// @name         Tealium event capture — Treehouse
// @namespace    treehouse.analytics
// @version      5.5
// @description  Logs every utag view/link event AND every client-to-server Tealium beacon (i.gif, rp.gif, /event), with an on-screen field picker and JSON/CSV export. Persists across page loads and tabs.
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
//
// TWO SOURCES are captured, and each can be switched off in the panel:
//
//   udo  — calls into utag: utag.view / utag.link / utag.track. This is what the
//          site ASKED to be tracked.
//   net  — the requests utag then makes to Tealium's collect layer: i.gif,
//          rp.gif, /event and the visitor-service lookups. This is what the
//          server ACTUALLY received.
//
// They are not redundant. Mapped attributes, consent gating and tag-level
// filtering all sit between the two, so an attribute can be present in the utag
// payload and absent from the beacon. Each beacon is linked back to the utag
// call that produced it and the difference is reported.
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
      'page_country', 'page_language', 'ut.event', 'event'
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
    // 'labels' is optional and only worth filling in where the raw name does not
    // explain itself. The raw key is always shown alongside the label, because it
    // is the name you need when searching Tealium or the Network tab — the label
    // is an aid, never a replacement.
    { name: 'Reddit', keys: [
      'reddit.event_name', 'reddit.pixel_id',
      'cp._rdt_uuid', 'cp._rdt_cid', 'cp._rdt_em',
      // reddit_pixel_event_id_PageVisit and _PageVisit_43: one per firing tag, the
      // suffix being the tag UID. This is what the pixel sends as m.conversionId,
      // and what the Conversions API must echo for the two to deduplicate.
      'reddit_pixel_event_id_*'
    ], labels: {
      'reddit_pixel_event_id_*': 'Event id for pixel/CAPI deduplication (per tag)',
      'cp._rdt_uuid': 'Reddit visitor id cookie',
      'cp._rdt_cid':  'Reddit click id cookie',
      'cp._rdt_em':   'Reddit hashed email cookie'
    }},
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
      'cp.OptanonConsent', 'cp.OptanonAlertBoxClosed', 'cp.eupubconsent-v2', 'cp.cc_cookie',
      // Sent as top-level beacon parameters alongside the payload, not inside it.
      'gdpr', 'gdpr_consent'
    ], labels: {
      'gdpr':         'IAB TCF applies (1 = in scope)',
      'gdpr_consent': 'IAB TCF consent string sent to the server',
      'google_ad_storage_consent':           'Consent Mode · ad_storage',
      'google_ad_user_data_consent':          'Consent Mode · ad_user_data',
      'google_ad_personalization_consent':    'Consent Mode · ad_personalization',
      'google_analytics_storage_consent':     'Consent Mode · analytics_storage',
      'google_ads_data_redaction':            'Consent Mode · redact ad identifiers when denied',
      'google_url_passthrough':               'Consent Mode · pass gclid in the URL when denied',
      'microsoft_ad_storage_consent':         'Microsoft UET · ad_storage',
      'tci.consent_type':                     'Tealium consent integration · decision type',
      'tci.purposes_with_consent_all':        'Purposes consented · all',
      'tci.purposes_with_consent_processed':  'Purposes consented · processed',
      'tci.purposes_with_consent_unprocessed':'Purposes consented · unprocessed',
      'cp.OptanonConsent':                    'OneTrust consent cookie',
      'cp.OptanonAlertBoxClosed':             'OneTrust banner dismissed at',
      'cp.eupubconsent-v2':                   'IAB TCF v2 consent string',
      'cp.cc_cookie':                         'Cookie-consent state'
    }},
    { name: 'Experiments', keys: [
      'ab_group.ab_active', 'ab_group.ab_specification',
      // experiment_tw9599_variant and friends: the test id is baked into the
      // attribute name, so it can only be matched by prefix.
      'experiment_*'
    ], labels: {
      'experiment_*': 'Per-experiment variant assignment (id is in the key)'
    }},
    { name: 'Tealium', keys: [
      'tealium_visitor_id', 'tealium_session_id', 'tealium_session_number',
      'tealium_session_event_number', 'tealium_random', 'tealium_timestamp_utc',
      'tealium_timestamp_epoch', 'tealium_timestamp_local',
      'tealium_account', 'tealium_profile', 'tealium_environment', 'tealium_datasource',
      'tealium_library_name', 'tealium_library_version',
      'ut.env', 'ut.profile', 'ut.version',
      'ut.account', 'ut.domain', 'ut.visitor_id', 'ut.session_id',
      'tealium.collect.datasourcekey', 'tealium.collect.profile',
      'tealium.collect.endpoint', 'post_time'
    ]},
    // utag's own per-tag bookkeeping, which rides along inside the collect POST.
    // Keyed by tag UID: loader.cfg.<uid>.<field>. Reading send=0 or consent=0 for
    // a UID tells you why a tag stayed quiet, which nothing else exposes.
    // The numeric values are reported verbatim — utag's 'load' codes in particular
    // are not documented anywhere I would trust, so no meaning is invented here.
    { name: 'Tealium loader (per tag)', keys: [
      'loader.cfg.*', 'loader.*'
    ], labels: {
      'loader.cfg.*': 'Per-tag load / send / wait / consent state, keyed by tag UID',
      'loader.*':     'Any other utag loader bookkeeping'
    }},
    { name: 'Tealium cookies', keys: [
      'cp.utag_main_v_id', 'cp.utag_main_ses_id', 'cp.utag_main__sn', 'cp.utag_main__ss',
      'cp.utag_main__se', 'cp.utag_main__st', 'cp.utag_main__pn',
      'cp.utag_main_dc_visit', 'cp.utag_main_dc_event', 'cp.utag_main_dc_region',
      'cp.utagdb'
    ], labels: {
      'cp.utag_main_v_id':   'Visitor id',
      'cp.utag_main_ses_id': 'Session id (session start, epoch ms)',
      'cp.utag_main__sn':    'Session number',
      'cp.utag_main__ss':    'First hit of the session (1 = yes)',
      'cp.utag_main__se':    'Events so far this session',
      'cp.utag_main__st':    'Session expires at (epoch ms)',
      'cp.utag_main__pn':    'Page views this session',
      'cp.utagdb':           'utag debug mode'
      // dc_visit / dc_event / dc_region are left unlabelled on purpose: they are
      // set by a Tealium integration whose exact semantics I would be guessing at,
      // and a wrong label is worse than none.
    }},
    { name: 'Browser / viewport', keys: [
      'browser.height', 'browser.width', 'browser.screen_height', 'browser.screen_width',
      'browser.timezone_offset', 'browser.*'
    ], labels: {
      'browser.height':          'Viewport height',
      'browser.width':           'Viewport width',
      'browser.screen_height':   'Screen height',
      'browser.screen_width':    'Screen width',
      'browser.timezone_offset': 'Timezone offset from UTC (minutes)',
      'browser.*':               'Any other browser attribute'
    }},
    // utag's navigation-timing block: 14 keys of pure plumbing, so it gets one
    // wildcard rather than fourteen checkboxes. Off by default — tick it when you
    // are actually chasing a performance question.
    { name: 'Performance timing', keys: [
      'timing.*'
    ], labels: {
      'timing.*': 'Navigation timing (dns, connect, ttfb, load, …) and its page context'
    }},
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
      'clarity.project_id', 'meta.facebook.pixel_id',
      'fb_event_id_*'
    ], labels: {
      'fb_event_id_*': 'Meta event id for pixel/CAPI deduplication (per tag)',
      'cp._ga':      'GA client id',
      'cp._ga_*':    'GA4 session state (per property)',
      'cp._fbp':     'Meta browser id',
      'cp._uetsid':  'Microsoft UET session id',
      'cp._uetvid':  'Microsoft UET visitor id',
      'cp._gcl_au':  'Google Ads first-party click id',
      // Correction: I previously labelled this "mistyped, always empty". A live
      // capture proved otherwise — it carries a normal Google Ads value. There is
      // a real cookie by this name here; Google's own is the single-underscore
      // _gcl_au, so both exist and it is worth knowing which your tags read.
      'cp.__gcl_au': 'Google Ads click id — non-standard double-underscore cookie',
      'cp.g_state':  'Google One Tap state'
    }},
    // ─────────────────────────────────────────────────────────────────────────
    // SCOPED GROUP. These are Reddit's own pixel parameters as they appear on the
    // wire, and they only apply to rows from the rp.gif endpoint.
    //
    // Scoping is not cosmetic. 'event', 'id', 'ts' and 'v' are far too generic to
    // catalogue globally: a UDO that happened to carry its own 'id' would be
    // silently filed under Reddit and shown with a Reddit label. Because this
    // group declares a scope, its keys are only ever recognised on an rp.gif hit,
    // and they are ticked under a qualified id ('rdt_wire:event') so they cannot
    // collide with a same-named attribute elsewhere.
    // ─────────────────────────────────────────────────────────────────────────
    { name: 'Reddit pixel (on the wire)', id: 'rdt_wire', scope: { endpoint: ['rp.gif'] },
      keys: [
        'event', 'id', 'uuid', 'click_id', 'em', 'external_id',
        'm.conversionId', 'm.*',
        'integration', 'partner', 'opt_out', 'esurl',
        'ts', 'v', 'sh', 'sw', 'db'
      ], labels: {
        'event':          'Reddit event name',
        'id':             'Reddit advertiser / pixel id',
        'uuid':           'Reddit visitor id (from the _rdt_uuid cookie)',
        'click_id':       'Reddit click id (from _rdt_cid)',
        'em':             'Hashed email — advanced matching',
        'external_id':    'Your own user id — advanced matching',
        'm.conversionId': 'Conversion id — deduplicates against the CAPI',
        'm.*':            'Any other event metadata (value, currency, itemCount …)',
        'integration':    'Reporting integration name',
        'partner':        'Reporting partner — TEALIUM when fired by a Tealium tag',
        'opt_out':        'Opt-out flag (1 = do not track)',
        'esurl':          'Event source URL',
        'ts':             'Client timestamp (epoch ms)',
        'v':              'Reddit pixel version',
        'sh':             'Screen height reported to Reddit',
        'sw':             'Screen width reported to Reddit',
        'db':             'Reddit pixel diagnostics flags'
      }}
  ];
  // Keys ending in '*' match by prefix — for values whose names carry a random
  // suffix (GA4 property ids, checkout tokens) and so cannot be listed literally.
  // Never captured: this script's own storage. 'ls.__tealium_cap' holds the
  // entire capture array, so recording it inside each row would nest the whole
  // history in every event and blow the localStorage quota within a few hits.
  var BLOCKLIST = ['ls.__tealium_cap', 'ls.__tealium_cap_fields', 'ls.__tealium_cap_custom',
                   'ls.__tealium_cap_ui', 'ls.__tealium_cap_sources',
                   'ls.__tealium_cap_migrated', 'ss.__tealium_cap'];
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
    'tealium.collect.endpoint', 'cp.__gcl_au',
    // Scoped keys are ticked under their qualified id.
    'rdt_wire:event', 'rdt_wire:id', 'rdt_wire:uuid', 'rdt_wire:click_id',
    'rdt_wire:em', 'rdt_wire:m.conversionId', 'rdt_wire:m.*',
    'rdt_wire:opt_out', 'rdt_wire:sh', 'rdt_wire:sw',
    'event', 'reddit_pixel_event_id_*', 'fb_event_id_*'
  ];
  // Newly catalogued keys are ticked here so a fresh install still shows them.
  // An existing install already has its own tick list in localStorage and will
  // NOT pick these up: cataloguing a key removes it from the Uncatalogued block,
  // so without ticking it in the Fields picker (or running __capResetFields())
  // it would be captured silently and vanish from the console and the exports.
  // ───────────────────────────────────────────────────────────────────────────
  // BEACON ENDPOINTS — which requests count as "sent to the server".
  //
  // First match wins, so the bare-host catch-alls are last. The filename tests
  // deliberately carry no host, because a first-party collect domain
  // (collect.pararius.nl and the like) still serves the same /i.gif.
  //   collect — an outbound event: this is a hit EventStream will process.
  //   visitor — an AudienceStream lookup: it READS the visitor profile and the
  //             interesting part is the response, not the request.
  //   vendor  — a third-party pixel a Tealium tag fired. Still a client-to-server
  //             event, but it carries the VENDOR's parameter names, not the UDO,
  //             so it is never diffed against the utag payload.
  // ───────────────────────────────────────────────────────────────────────────
  var NET_ENDPOINTS = [
    { id: 'i.gif',           kind: 'collect', test: /\/(vdata\/)?i\.gif(\?|$)/i },
    // rp.gif is Reddit's ad pixel, not a Tealium endpoint — alb.reddit.com serves
    // it. Caught here because it is fired BY a Tealium tag and is exactly the kind
    // of hit worth watching, but it is a vendor pixel and typed as one.
    { id: 'rp.gif', kind: 'vendor', vendor: 'reddit', test: /\/rp\.gif(\?|$)/i },
    { id: 's.gif',           kind: 'collect', test: /\/s\.gif(\?|$)/i },
    { id: 'uidc.gif',        kind: 'collect', test: /\/uidc\.gif(\?|$)/i },
    { id: '/bulk-event',     kind: 'collect', test: /\/bulk-event(\?|$)/i },
    { id: '/event',          kind: 'collect', test: /tealiumiq\.com\/event(\?|$)/i },
    // Tealium's collect path on a FIRST-PARTY domain:
    //   datacollect.rentaroof.co.uk/treehouse/treehouse-cdp/2/i.gif
    // The path shape /<account>/<profile>/<n>/<endpoint> is what identifies these,
    // but the shape alone is not distinctive enough for /event and /bulk-event —
    // a site's own /v1/x/2/event would match it. So those two also require a
    // collect-style hostname. i.gif needs no such guard, the filename carries it.
    // Add your CNAME prefix here if a brand uses something other than these.
    { id: '/event',      kind: 'collect', host: /^(data)?collect\.|^tms\.|^tags\./i,
      test: /\/[^\/]+\/[^\/]+\/\d+\/event(\?|$)/i },
    { id: '/bulk-event', kind: 'collect', host: /^(data)?collect\.|^tms\.|^tags\./i,
      test: /\/[^\/]+\/[^\/]+\/\d+\/bulk-event(\?|$)/i },
    { id: 'dle',             kind: 'visitor', test: /\/dle(\?|\/|$)/i },
    { id: 'datacloud',       kind: 'visitor', test: /datacloud\.tealiumiq\.com\//i },
    { id: 'visitor-service', kind: 'visitor', test: /visitor-service\.tealiumiq\.com\//i },
    { id: 'collect',         kind: 'collect', test: /collect\.tealiumiq\.com\//i }
  ];
  // Library and profile assets are requests, but not events — never log them.
  var NET_IGNORE = /(^|\.)tiqcdn\.com$/i;
  // Attributes that are SUPPOSED to differ between the utag payload and the
  // beacon, so comparing them would only produce noise: the timestamp and random
  // are stamped per hit, and 'ut.event' reports the last view rather than this
  // hit's type (see the closing note in this file).
  var NET_DIFF_IGNORE = /^tealium_(timestamp|random)|^tealium_session_event_number$|^ut\.event$/;
  var NET_LINK_WINDOW_MS = 1500;  // fallback only, same idea as CLICK_WINDOW_MS
  var NET_DEDUPE_MS = 3000;       // one request seen by two hooks is still one request
  var MAX_VALUE_LEN = 90;   // console display only; exports carry full values
  var MAX_ROWS = 500;
  var MAX_BYTES = 3000000;  // whole-store ceiling, see save()
  var RAW_MAX_FIELDS = 25;  // payloads at or under this size keep every raw key/value
  // A beacon carries the whole UDO as query parameters — routinely 100+ of them,
  // most uncatalogued and all of them interesting, since the point of watching
  // the wire is to see what actually went over it. So beacons keep raw values
  // well past RAW_MAX_FIELDS, with each value clipped to stay inside the quota.
  var NET_RAW_MAX_FIELDS = 150;
  var NET_RAW_MAX_LEN = 200;
  var STORE_KEY   = '__tealium_cap';
  var UI_KEY      = '__tealium_cap_ui';
  var FIELDS_KEY  = '__tealium_cap_fields';
  var CUSTOM_KEY  = '__tealium_cap_custom';
  var SOURCES_KEY = '__tealium_cap_sources';
  var MIGRATED_KEY = '__tealium_cap_migrated';
  // Cataloguing a key removes it from the Uncatalogued block, so on an existing
  // install — which already has its own tick list saved — a newly catalogued
  // attribute would go from visible-as-noise to invisible. Each release lists the
  // keys it added; they are ticked once, then the version is marked done, so a key
  // you later untick stays unticked. Fresh installs get them via DEFAULT_ON and
  // these passes are no-ops.
  var MIGRATIONS = [
    { v: '4.6', keys: ['odp.interior', 'google_ads_data_redaction', 'google_url_passthrough',
                       'tealium.collect.endpoint', 'cp.__gcl_au'] },
    { v: '5.2', keys: ['rdt_wire:event', 'rdt_wire:id', 'rdt_wire:uuid', 'rdt_wire:click_id',
                       'rdt_wire:em', 'rdt_wire:m.conversionId', 'rdt_wire:m.*',
                       'rdt_wire:opt_out', 'rdt_wire:sh', 'rdt_wire:sw'] },
    { v: '5.5', keys: ['event', 'reddit_pixel_event_id_*', 'fb_event_id_*'] }
  ];
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
  // Beacon rows are an order of magnitude bigger than utag rows, so hitting the
  // quota is an expected outcome rather than an exceptional one. Drop the oldest
  // half and retry instead of silently losing the write (which is what the bare
  // lsSet did — the catch swallowed it and captures just stopped accumulating).
  function save(rows) {
    rows = rows.slice(-MAX_ROWS);
    // An unwrapped first-party collect POST is ~12KB, so 500 of them would be far
    // past the quota. Bound the store by BYTES as well as rows, and pay for it by
    // dropping the oldest captures whole rather than by stripping fields from the
    // newest — a complete capture you can trust beats a mutilated one, and which
    // fields would have gone is not a choice this code should be making for you.
    var json = JSON.stringify(rows), evicted = 0;
    while (json.length > MAX_BYTES && rows.length > 1) {
      var keep = Math.max(1, rows.length - Math.ceil(rows.length / 4));
      evicted += rows.length - keep;
      rows = rows.slice(-keep);
      json = JSON.stringify(rows);
    }
    if (evicted) {
      console.log('%c[CAP] store at its ' + Math.round(MAX_BYTES / 1000) + 'KB limit — dropped the ' +
        evicted + ' oldest captures, ' + rows.length + ' kept', 'color:#ffa726;font-weight:bold');
    }
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(rows));
        return rows;
      } catch (e) {
        rows = rows.slice(Math.ceil(rows.length / 2));
        if (!rows.length) return rows;
        console.log('%c[CAP] store full — dropped the oldest captures, ' + rows.length + ' kept',
          'color:#ffa726;font-weight:bold');
      }
    }
    return rows;
  }
  // Which of the two sources is live. Unticking one stops it being recorded AND
  // hides what was already recorded; ticking it again brings those rows back.
  function sources() {
    var s = ls(SOURCES_KEY, null);
    if (!s || typeof s !== 'object') { s = { udo: true, net: true }; lsSet(SOURCES_KEY, s); }
    return s;
  }
  function setSource(k, on) { var s = sources(); s[k] = !!on; lsSet(SOURCES_KEY, s); }
  // Rows captured by v4.x carry no _kind, and every one of them is a utag event.
  function kindOf(r) { return r && r._kind === 'net' ? 'net' : 'udo'; }
  function sourceOn(kind) { return sources()[kind === 'net' ? 'net' : 'udo'] !== false; }
  function customKeys() { return ls(CUSTOM_KEY, []); }
  function groups() {
    var g = CATALOGUE.slice();
    var c = customKeys();
    if (c.length) g = g.concat([{ name: 'Custom', keys: c }]);
    return g;
  }
  // A scoped group's keys are stored and ticked under a qualified id, so a generic
  // wire name ('event', 'id') can never collide with an attribute of the same name
  // in another group.
  function qid(g, k) { return g.id ? g.id + ':' + k : k; }
  // No row means "every group" — the Fields picker and the CSV header want the
  // whole catalogue, it is only a concrete row that has a scope to satisfy.
  function groupApplies(g, row) {
    if (!g.scope) return true;
    if (!row) return true;
    var ep = row._net && row._net.endpoint;
    return !!ep && g.scope.endpoint.indexOf(ep) >= 0;
  }
  // The groups that apply to a row, SCOPED ONES FIRST. A scoped key is a more
  // specific claim than a generic entry of the same name, so on an rp.gif hit
  // 'event' is Reddit's event name; on any other row it is the generic Event
  // attribute. Whichever group claims a key first is the one that displays it.
  function groupsFor(row) {
    var applying = groups().filter(function (g) { return groupApplies(g, row); });
    if (!row) return applying;
    return applying.filter(function (g) { return !!g.scope; })
           .concat(applying.filter(function (g) { return !g.scope; }));
  }
  function allKeysFor(row) {
    var out = [];
    groupsFor(row).forEach(function (g) {
      g.keys.forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); });
    });
    return out;
  }
  // Which keys are DISPLAYED for a given row: ticked, and in a group that applies.
  function displayMatcher(row) {
    var on = enabledSet(), keys = [];
    groupsFor(row).forEach(function (g) {
      g.keys.forEach(function (k) { if (on[qid(g, k)]) keys.push(k); });
    });
    return makeMatcher(keys);
  }
  function labelFor(g, k) { return (g.labels && g.labels[k]) || ''; }
  // Human-readable where a label exists, but never at the cost of the literal
  // name: that is what you paste into Tealium or search the Network tab for.
  function dispKey(g, k) {
    var l = labelFor(g, k);
    return l ? l + '  (' + k + ')' : k;
  }
  function runMigrations() {
    try {
      var done = ls(MIGRATED_KEY, []);
      var changed = false;
      MIGRATIONS.forEach(function (m) {
        if (done.indexOf(m.v) >= 0) return;
        m.keys.forEach(function (k) { setEnabled(k, true); });
        done.push(m.v);
        changed = true;
      });
      if (changed) lsSet(MIGRATED_KEY, done);
    } catch (e) {}
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
  // One pass over the payload: catalogued keys are stored, the rest are
  // recorded as uncatalogued. Small payloads (bridge pushes, dataLayer relays)
  // are exactly the interesting ones and the catalogue never covers them, so
  // keep their raw key/value pairs verbatim. Big payloads only get the key
  // names, to stay inside the localStorage quota.
  // Shared by both sources so a beacon parameter is grouped, filtered and
  // exported under exactly the same rules as the utag attribute it came from.
  function splitPayload(row, d, rawMax, clip) {
    var isKnown   = makeMatcher(allKeysFor(row));
    var isBlocked = makeMatcher(BLOCKLIST);
    var extra = {}, n = 0;
    Object.keys(d).forEach(function (k) {
      if (isBlocked(k)) return;
      var v = d[k];
      if (v === undefined || v === null || v === '') return;
      if (clip) v = clipValue(v, clip);
      if (isKnown(k)) { row.data[k] = v; }
      else { extra[k] = v; n++; }
    });
    if (n) {
      row._uncat = n;
      row._extra = (Object.keys(d).length <= rawMax)
        ? extra
        : Object.keys(extra).slice(0, 60);
    }
  }
  function clipValue(v, max) {
    var s = (typeof v === 'object') ? JSON.stringify(v) : v;
    if (typeof s === 'string' && s.length > max) return s.slice(0, max) + '…';
    return v;
  }
  function build(via, type, d) {
    d = d || {};
    var row = {
      _time: new Date().toISOString().slice(11, 23),
      _kind: 'udo',
      _via: via, _type: type,
      _path: location.pathname, _host: location.hostname,
      _fields: Object.keys(d).length,
      data: {}
    };
    splitPayload(row, d, RAW_MAX_FIELDS, 0);
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
    var isOn = displayMatcher(row);
    // Beacons get their own two colours so a wire hit is never mistaken for a
    // utag call while scrolling the console: cyan for an outbound event, indigo
    // for a visitor-profile lookup.
    var colour = row._kind === 'net'
                 ? (row._type === 'visitor' ? '#5c6bc0'
                  : row._type === 'pixel'   ? '#ec407a' : '#26c6da')
               : row._via === 'recovered' ? '#9e9e9e'
               : row._type === 'view'     ? '#42a5f5' : '#66bb6a';
    var label = row._kind === 'net'
      ? (row._net.endpoint + (row._net.event ? '  ' + row._net.event : '') +
         (row._net.batch ? '  [' + row._net.batch.index + '/' + row._net.batch.of + ']' : ''))
      : ((on['interaction_id'] && row.data.interaction_id) ||
         (on['page_category'] && row.data.page_category) || row._type);
    console.groupCollapsed(
      '%c' + row._type.toUpperCase() + '%c  ' + label + '  %c' + row._path,
      'background:' + colour + ';color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold',
      'font-weight:bold',
      'color:#999;font-weight:normal'
    );
    if (row._kind === 'net' && row._net) {
      var nn = row._net, nl = [];
      var nline = function (k, v) {
        if (v === '' || v == null) return;
        nl.push('  ' + pad(k, 11) + '  ' + v);
      };
      nline('request', String(nn.method || 'GET').toUpperCase() + ' ' + nn.host + nn.req_path);
      nline('transport', nn.transport +
        (nn.duration_ms != null ? '  · ' + nn.duration_ms + 'ms' : '') +
        (nn.status != null ? '  · HTTP ' + nn.status : '') +
        (nn.bytes_out ? '  · ' + nn.bytes_out + 'B sent' : '') +
        (nn.bytes_in ? '  · ' + nn.bytes_in + 'B back' : ''));
      nline('profile', [nn.account, nn.profile, nn.env].filter(Boolean).join(' / '));
      // The URL can route into one profile while the payload declares another —
      // normal with a server-side CDP setup, where the collect endpoint belongs to
      // the server-side profile and the payload names the web profile it came from.
      // Showing only one of them hides half of where the hit is going.
      if (nn.route && nn.route !== [nn.account, nn.profile].filter(Boolean).join(' / ')) {
        nline('routed to', nn.route + '   (from the URL path)');
      }
      nline('datasource', nn.datasource);
      nline('params', row._fields + (nn.wire_params
        ? '  (' + nn.wire_params + ' on the wire, unwrapped from ' + (nn.expanded || []).join(', ') + ')'
        : ''));
      nline('tags', nn.tags);
      if (nn.link) {
        // Built with branches rather than a lookup object: an object literal
        // evaluates every branch, so a row with a link but no pairing would have
        // thrown on nn.paired.after_ms and taken the whole console entry with it.
        var ms = nn.paired ? nn.paired.after_ms : 0;
        nline('link',
          nn.link === 'direct' ? 'sent during the utag call — certain' :
          nn.link === 'async'  ? 'sent ' + ms + 'ms after the utag call, same event name — corroborated' :
          nn.link === 'unverified' ? 'sent ' + ms + 'ms after a utag call that it does NOT corroborate — treat as unrelated' :
          nn.link);
      }
      if (nn.paired) {
        nline('from', nn.paired.type + ' at ' + nn.paired.time +
          (nn.paired.interaction_id ? '  ·  ' + nn.paired.interaction_id : ''));
      }
      console.log('%c' + (row._type === 'visitor' ? 'Visitor service request'
                        : row._type === 'pixel' ? 'Vendor pixel — sent to ' + (nn.vendor || 'a third party')
                        : 'Beacon — sent to server') +
        '\n%c' + nl.join('\n'),
        'color:' + colour + ';font-weight:bold', 'color:inherit;font-family:monospace');
      if (nn.missing || nn.changed) {
        var w = [];
        (nn.missing || []).forEach(function (k) { w.push(pad('missing', 8) + '  ' + k); });
        (nn.changed || []).forEach(function (c) { w.push(pad('changed', 8) + '  ' + c); });
        console.log('%c⚠ ' + (nn.missing_total || w.length) + ' attribute' +
          ((nn.missing_total || w.length) === 1 ? '' : 's') +
          ' from the utag payload did not reach the server' +
          (nn.missing_total && nn.missing_total > (nn.missing || []).length
            ? ' (' + (nn.missing || []).length + ' of them ticked, listed below)' : '') +
          '\n%c  ' + w.join('\n  '),
          'color:#ffa726;font-weight:bold', 'color:#ffa726;font-family:monospace');
      }
    }
    var shown = {};
    groupsFor(row).forEach(function (g) {
      var inGroup = makeMatcher(g.keys);
      var present = Object.keys(row.data).filter(function (k) {
        return !shown[k] && inGroup(k) && isOn(k);
      });
      present.forEach(function (k) { shown[k] = true; });
      if (!present.length) return;
      var names = present.map(function (k) { return dispKey(g, k); });
      var width = Math.max.apply(null, names.map(function (n) { return n.length; }));
      console.log(
        '%c' + g.name + '\n%c' + present.map(function (k, i) {
          return '  ' + pad(names[i], width) + '  ' + fmtValue(row.data[k]);
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
      '%c' + row._time + '  ·  via ' + row._via + '  ·  ' + row._fields +
      (row._kind === 'net' ? ' parameters on the wire' : ' fields in payload'),
      'color:#999;font-style:italic'
    );
    console.groupEnd();
  }
  // The single choke point for the source switches: a paused source is not
  // stored and not printed, so pausing beacons really does stop them consuming
  // the 500-row budget rather than just hiding them.
  function push(row) {
    if (!sourceOn(kindOf(row))) return false;
    var rows = load();
    rows.push(row);
    save(rows);
    print(row);
    refreshBadge();
    return true;
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
      var row = build(fn, type, d);
      // Marked before it is stored, and regardless of whether it is stored:
      // pausing utag events is a display and volume decision, and it must not
      // quietly disable the beacon diff, which is the whole reason to watch the
      // wire in the first place.
      markUdo(row, d);
      push(row);
    } catch (e) {
      console.log('%c[CAP] error', 'color:#e53935', e && e.message);
    }
  }
  // Our wrapper runs BEFORE the original utag call, so by the time the collect
  // tag builds its beacon the utag row already exists and `activeUdo` is set.
  // Same deterministic trick as the click correlation: anything that fires while
  // the utag call is still on the stack is linked with certainty, and only
  // genuinely asynchronous senders fall back to the time window.
  var activeUdo = null, lastUdo = null;
  function markUdo(row, d) {
    var info = { row: row, payload: d, at: new Date().getTime() };
    activeUdo = info;
    lastUdo = info;
    setTimeout(function () { if (activeUdo === info) activeUdo = null; }, 0);
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
  // NETWORK CAPTURE — what actually left the browser
  //
  // utag sends collect hits by several different means depending on version,
  // tag configuration and payload size, so all of them are wrapped:
  //   image   — new Image(); img.src = '…/i.gif?…'   (the classic, and still the
  //             most common; the whole payload is in the query string)
  //   beacon  — navigator.sendBeacon(url, body)
  //   fetch   — POST to /event with a JSON body
  //   xhr     — older transports and the visitor-service lookups
  //   perf    — a PerformanceObserver safety net that catches anything the
  //             wrappers missed: requests made before this script patched (the
  //             observer is created with buffered:true so it replays those), and
  //             images whose src was set with setAttribute, which bypasses the
  //             property setter entirely.
  // The observer also enriches rows the wrappers did record, with the transfer
  // size, duration and — where Chrome exposes it — the response status. A 4xx
  // from collect is the kind of failure nothing else in the console reports.
  // ───────────────────────────────────────────────────────────────────────────
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function absUrl(u) {
    try { return new URL(String(u), location.href).href; } catch (e) { return String(u || ''); }
  }
  function endpointFor(url) {
    var u = String(url || '');
    if (!u) return null;
    var h = '';
    try { h = new URL(u, location.href).hostname; } catch (e) {}
    if (h && NET_IGNORE.test(h)) return null;
    for (var i = 0; i < NET_ENDPOINTS.length; i++) {
      var e = NET_ENDPOINTS[i];
      if (e.host && !(h && e.host.test(h))) continue;   // host-guarded rules
      if (e.test.test(u)) return e;
    }
    return null;
  }
  // Repeated parameters are kept as an array rather than overwritten: that is how
  // a UDO array arrives on the wire, and collapsing it would fake a mismatch
  // against the utag payload.
  function parseQuery(qs) {
    var out = {};
    if (!qs) return out;
    String(qs).replace(/^[?&]/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = i < 0 ? pair : pair.slice(0, i);
      var v = i < 0 ? '' : pair.slice(i + 1);
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (e) {}
      try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) {}
      if (!k) return;
      if (hasOwn(out, k)) out[k] = [].concat(out[k], v);
      else out[k] = v;
    });
    return out;
  }
  // JSON bodies are flattened to dot notation so they land on the same catalogue
  // keys as the query-string form: {"odp":{"city":"Utrecht"}} -> 'odp.city'.
  function flatten(v, prefix, out, depth) {
    out = out || {};
    if (v == null) return out;
    if (typeof v !== 'object' || Array.isArray(v)) {
      if (prefix) out[prefix] = v;
      return out;
    }
    Object.keys(v).forEach(function (k) {
      var key = prefix ? prefix + '.' + k : k;
      var val = v[k];
      if (val && typeof val === 'object' && !Array.isArray(val) && (depth || 0) < 4) {
        flatten(val, key, out, (depth || 0) + 1);
      } else out[key] = val;
    });
    return out;
  }
  // Collect POSTs one event as {…} or {data:{…}}, and batches as
  // {data:{events:[…]}} or a bare array. A batch becomes one row per event.
  function eventsFromJSON(j) {
    var list = [];
    // A batch envelope states the account, profile and datasource once for the
    // whole request. Those are inherited by each event rather than left behind,
    // otherwise every batched row would look like it came from nowhere.
    function one(o, inherited) {
      if (!o || typeof o !== 'object') return;
      var d = {};
      Object.keys(inherited || {}).forEach(function (k) { d[k] = inherited[k]; });
      if (o.data && typeof o.data === 'object') {
        var env = {};
        Object.keys(d).forEach(function (k) { env[k] = d[k]; });
        Object.keys(o).forEach(function (k) { if (k !== 'data') env[k] = o[k]; });
        Object.keys(o.data).forEach(function (k) { if (k !== 'events') env[k] = o.data[k]; });
        if (Array.isArray(o.data.events)) {
          o.data.events.forEach(function (ev) { one(ev, env); });
          return;
        }
        d = env;
      } else {
        Object.keys(o).forEach(function (k) { d[k] = o[k]; });
      }
      list.push(flatten(d, '', {}, 0));
    }
    if (Array.isArray(j)) j.forEach(function (o) { one(o, null); });
    else one(j, null);
    return list;
  }
  function bodyToText(body) {
    if (body == null) return null;
    if (typeof body === 'string') return body;
    try {
      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        var parts = [];
        body.forEach(function (v, k) { parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v))); });
        return parts.join('&');
      }
    } catch (e) {}
    return null;   // Blob / ArrayBuffer — read asynchronously at the call site
  }
  // A parameter whose VALUE is a JSON object is an envelope, not an attribute.
  // Tealium's first-party collect POST is the case that matters:
  //   gdpr=1&gdpr_consent=CQok…&data={"page_category":"home","loader.cfg":{…}}
  // Left alone, that whole payload is one opaque string — three parameters, none
  // of them catalogued, and no diff against the utag call possible. Unwrapped, the
  // contents merge in at the top level under their real names, so they land in
  // their normal catalogue groups and the diff works as it does for a GET beacon.
  //
  // Merged flat rather than prefixed ('page_category', not 'data.page_category')
  // because the envelope is transport: the attribute's real name is the inner one.
  // The row records which parameters were unwrapped, so the parameter list never
  // silently disagrees with what you see in the Network tab.
  // The envelope nests TWICE. The form parameter data= holds a JSON document
  // which itself has a 'data' member holding the UDO:
  //   data={"loader.cfg":{…},"data":{"page_category":"listing",…}}
  // Flattening that blindly yields 'data.page_category', which is catalogued
  // nowhere, groups nowhere, and makes the diff report the entire payload as
  // missing. eventsFromJSON already knows this convention — it is the same shape
  // the JSON POST bodies use — so envelopes go through it rather than through a
  // raw flatten, and the UDO comes out under its real attribute names.
  //
  // Returns a LIST: an envelope is allowed to contain a batch of events, and each
  // one becomes its own row.
  function expandEnvelopes(d) {
    var base = {}, expanded = [], events = null;
    Object.keys(d).forEach(function (k) {
      var v = d[k];
      if (typeof v !== 'string') { base[k] = v; return; }
      var t = v.replace(/^\s+/, '');
      if (t.charAt(0) !== '{' && t.charAt(0) !== '[') { base[k] = v; return; }
      var parsed = null;
      try { parsed = JSON.parse(t); } catch (e) { base[k] = v; return; }
      if (!parsed || typeof parsed !== 'object') { base[k] = v; return; }
      var evs = eventsFromJSON(parsed);
      if (!evs.length) { base[k] = v; return; }
      events = (events || []).concat(evs);
      expanded.push(k);
    });
    if (!events) return { list: [base], expanded: expanded };
    // Envelope-level parameters (gdpr, gdpr_consent) ride along on every event;
    // the unwrapped payload wins on a collision, being the actual attribute.
    return {
      expanded: expanded,
      list: events.map(function (ev) {
        var o = {};
        Object.keys(base).forEach(function (k) { o[k] = base[k]; });
        Object.keys(ev).forEach(function (k) { o[k] = ev[k]; });
        return o;
      })
    };
  }
  // Per-tag summary from the loader block. Only 'send' and 'consent' are read,
  // because those two are unambiguous; nothing else is interpreted.
  function tagSummary(d) {
    var ids = {}, n = 0, sending = 0, blocked = 0;
    Object.keys(d).forEach(function (k) {
      var m = /^loader\.cfg\.([^.]+)\.(.+)$/.exec(k);
      if (!m) return;
      if (!ids[m[1]]) { ids[m[1]] = true; n++; }
      if (m[2] === 'send' && String(d[k]) === '1') sending++;
      if (m[2] === 'consent' && String(d[k]) === '0') blocked++;
    });
    if (!n) return '';
    return n + ' configured  ·  ' + sending + ' with send=1' +
      (blocked ? '  ·  ' + blocked + ' with consent=0' : '');
  }
  function paramsFromBody(body) {
    var t = bodyToText(body);
    if (t == null) return [];
    t = t.replace(/^\s+/, '');
    if (!t) return [];
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      try { return eventsFromJSON(JSON.parse(t)); }
      catch (e) { return [{ _unparsed_body: t.slice(0, 400) }]; }
    }
    if (t.indexOf('=') > -1) return [parseQuery(t)];
    return [{ _body: t.slice(0, 400) }];
  }
  // Every Tealium hit carries tealium_random and a timestamp, so two identical
  // URLs inside a few seconds are always one request seen by two hooks — never
  // two real requests.
  var netSeen = [];
  function netDupe(url) {
    var now = new Date().getTime();
    netSeen = netSeen.filter(function (e) { return now - e[1] <= NET_DEDUPE_MS; });
    for (var i = 0; i < netSeen.length; i++) if (netSeen[i][0] === url) return true;
    netSeen.push([url, now]);
    if (netSeen.length > 200) netSeen = netSeen.slice(-200);
    return false;
  }
  function sameValue(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
      return JSON.stringify([].concat(a)) === JSON.stringify([].concat(b));
    }
    if (a && typeof a === 'object') return asText(a) === String(b);
    return String(a) === String(b);
  }
  // Links a beacon to the utag call that produced it, then reports what changed
  // in between. Only the ticked keys are listed — the total is counted over the
  // whole payload so the headline number stays honest.
  function linkNet(row, d) {
    var now = new Date().getTime();
    var src = null, link = '';
    if (activeUdo) { src = activeUdo; link = 'direct'; }
    else if (lastUdo && (now - lastUdo.at) <= NET_LINK_WINDOW_MS) { src = lastUdo; link = 'async'; }
    if (!src) return;
    // An async attachment has lost the dispatch link, so it must EARN the label:
    // the beacon has to name the same event as the utag payload. A beacon with no
    // event name to compare — a visitor-profile lookup, say — is not corroborated
    // by the mere fact that a utag call happened recently, so it stays unverified
    // and is never diffed. Absence of contradiction is not corroboration.
    if (link === 'async') {
      var be = d.tealium_event, ue = src.payload && src.payload.tealium_event;
      if (!be || !ue || String(be) !== String(ue)) link = 'unverified';
    }
    row._net.link = link;
    row._net.paired = {
      time: src.row._time,
      type: src.row._type,
      event: (src.row.data && src.row.data.tealium_event) || '',
      interaction_id: (src.row.data && src.row.data.interaction_id) || '',
      after_ms: now - src.at
    };
    if (link === 'unverified' || row._type !== 'beacon') return;
    var isOn = enabledMatcher();
    var missing = [], changed = [], total = 0;
    Object.keys(src.payload || {}).forEach(function (k) {
      var v = src.payload[k];
      if (v === undefined || v === null || v === '') return;
      if (NET_DIFF_IGNORE.test(k)) return;
      if (!hasOwn(d, k)) {
        total++;
        if (isOn(k)) missing.push(k);
      } else if (!sameValue(v, d[k])) {
        if (isOn(k)) changed.push(k + ' — utag "' + fmtValue(v) + '" vs beacon "' + fmtValue(d[k]) + '"');
      }
    });
    if (missing.length) row._net.missing = missing;
    if (changed.length) row._net.changed = changed;
    if (total) row._net.missing_total = total;
  }
  function buildNet(info) {
    var d = info.params || {};
    // On a first-party collect domain the account and profile are in the PATH,
    // not the parameters: /treehouse/treehouse-cdp/2/i.gif
    var fp = /^\/([^\/]+)\/([^\/]+)\/\d+\/(i\.gif|event|bulk-event)$/i.exec(info.path || '');
    var row = {
      _time: new Date().toISOString().slice(11, 23),
      _kind: 'net',
      _via: info.transport,
      _type: info.endpoint.kind === 'visitor' ? 'visitor'
           : info.endpoint.kind === 'vendor'  ? 'pixel' : 'beacon',
      _path: location.pathname, _host: location.hostname,
      _fields: Object.keys(d).length,
      _net: {
        endpoint: info.endpoint.id,
        method: info.method || 'GET',
        transport: info.transport,
        url: String(info.url || '').slice(0, 1500),
        host: info.host || '',
        req_path: info.path || '',
        account: d.tealium_account || d['ut.account'] || (fp ? fp[1] : ''),
        profile: d.tealium_profile || d['ut.profile'] || d['tealium.collect.profile'] || (fp ? fp[2] : ''),
        env: d.tealium_environment || d['ut.env'] || '',
        datasource: d.tealium_datasource || d['tealium.collect.datasourcekey'] || '',
        vendor: info.endpoint.vendor || '',
        route: fp ? (fp[1] + ' / ' + fp[2]) : '',
        // A vendor pixel has no tealium_event; its own event name is the useful
        // headline, so fall back to it for pixels only.
        event: d.tealium_event || (info.endpoint.kind === 'vendor' ? (d.event || '') : ''),
        bytes_out: info.bytes_out || 0
      },
      data: {}
    };
    if (info.batch) row._net.batch = info.batch;
    if (info.wire_params && info.wire_params !== row._fields) row._net.wire_params = info.wire_params;
    if (info.expanded && info.expanded.length) row._net.expanded = info.expanded;
    var tags = tagSummary(d);
    if (tags) row._net.tags = tags;
    splitPayload(row, d, NET_RAW_MAX_FIELDS, NET_RAW_MAX_LEN);
    linkNet(row, d);
    return row;
  }
  function noteRequest(url, method, body, transport, patch) {
    try {
      var abs = absUrl(url);
      var ep = endpointFor(abs);
      if (!ep) return false;
      if (!sourceOn('net')) return false;      // paused: nothing parsed, nothing stored
      if (netDupe(abs)) return false;
      var q = {}, host = '', path = abs;
      try { var U = new URL(abs); q = parseQuery(U.search); host = U.hostname; path = U.pathname; } catch (e) {}
      var bodyText = bodyToText(body);
      var bodies = paramsFromBody(body);
      if (!bodies.length) bodies = [null];
      // One request can yield several rows: a batched body, an envelope holding a
      // batch, or both. Flatten that to a single list first so the batch numbering
      // counts real rows rather than one of the two nestings.
      var units = [];
      for (var i = 0; i < bodies.length; i++) {
        var raw = {};
        Object.keys(q).forEach(function (k) { raw[k] = q[k]; });
        if (bodies[i]) { var b = bodies[i]; Object.keys(b).forEach(function (k) { raw[k] = b[k]; }); }
        var ex = expandEnvelopes(raw);
        var wire = Object.keys(raw).length;
        ex.list.forEach(function (p) {
          units.push({ params: p, wire: wire, expanded: ex.expanded });
        });
      }
      var recorded = false;
      units.forEach(function (u, idx) {
        var row = buildNet({
          url: abs, host: host, path: path, method: method, transport: transport,
          endpoint: ep, params: u.params,
          wire_params: u.wire,
          expanded: u.expanded,
          bytes_out: abs.length + (bodyText ? bodyText.length : 0),
          batch: units.length > 1 ? { index: idx + 1, of: units.length } : null
        });
        if (patch) Object.keys(patch).forEach(function (k) { row._net[k] = patch[k]; });
        if (push(row)) recorded = true;
      });
      return recorded;
    } catch (e) { return false; }
  }
  // Late-arriving facts about a request already logged. The row was printed
  // before the response existed, so an error status is announced separately
  // rather than silently landing in the export.
  function enrich(url, patch) {
    try {
      var abs = absUrl(url).slice(0, 1500);
      var rows = load(), stop = Math.max(0, rows.length - 40), hit = false;
      for (var i = rows.length - 1; i >= stop; i--) {
        var r = rows[i];
        if (kindOf(r) !== 'net' || !r._net || r._net.url !== abs) continue;
        if (r._net.status != null && patch.status != null) continue;
        Object.keys(patch).forEach(function (k) { if (patch[k] != null) r._net[k] = patch[k]; });
        hit = true;
        break;
      }
      if (hit) {
        save(rows);
        if (patch.status && !(patch.status >= 200 && patch.status < 400)) {
          console.log('%c[CAP] beacon returned ' + patch.status + '%c  ' + abs.slice(0, 160),
            'background:#e53935;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold', 'color:#999');
        }
      }
      return hit;
    } catch (e) { return false; }
  }
  function installNetHooks() {
    // fetch
    try {
      if (typeof window.fetch === 'function' && !window.fetch.__cap) {
        var of = window.fetch;
        var wf = function (input, init) {
          var url = '', method = 'GET', body = null;
          try {
            if (typeof input === 'string') url = input;
            else if (input && input.url) { url = input.url; method = input.method || method; }
            else url = String(input || '');
            if (init) { method = init.method || method; body = init.body; }
          } catch (e) {}
          var logged = noteRequest(url, method, body, 'fetch');
          var p = of.apply(this, arguments);
          if (logged && p && p.then) {
            p.then(function (res) { enrich(url, { status: res && res.status }); },
                   function () { enrich(url, { status: 'failed' }); });
          }
          return p;
        };
        wf.__cap = true;
        window.fetch = wf;
      }
    } catch (e) {}
    // XMLHttpRequest
    try {
      var xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
      if (xo && !xo.__cap) {
        var wo = function (m, u) { this.__capM = m; this.__capU = u; return xo.apply(this, arguments); };
        wo.__cap = true;
        XMLHttpRequest.prototype.open = wo;
        var ws = function (b) {
          var self = this;
          if (noteRequest(self.__capU, self.__capM, b, 'xhr')) {
            try {
              self.addEventListener('loadend', function () { enrich(self.__capU, { status: self.status }); });
            } catch (e) {}
          }
          return xs.apply(this, arguments);
        };
        ws.__cap = true;
        XMLHttpRequest.prototype.send = ws;
      }
    } catch (e) {}
    // sendBeacon — a Blob body can only be read asynchronously, so that row is
    // recorded a microtask later. It still wins the dedupe race against the
    // PerformanceObserver, which does not run until the next task.
    try {
      if (navigator.sendBeacon && !navigator.sendBeacon.__cap) {
        var ob = navigator.sendBeacon;
        var wb = function (url, data) {
          try {
            if (data && typeof data.text === 'function' && typeof data.size === 'number') {
              data.text().then(function (t) { noteRequest(url, 'POST', t, 'beacon'); }, function () {
                noteRequest(url, 'POST', null, 'beacon');
              });
            } else noteRequest(url, 'POST', data, 'beacon');
          } catch (e) {}
          return ob.apply(navigator, arguments);
        };
        wb.__cap = true;
        navigator.sendBeacon = wb;
      }
    } catch (e) {}
    // img.src — the classic i.gif transport. Wrapping the prototype's own setter
    // catches new Image() and document.createElement('img') alike, and passes
    // straight through to the native setter so nothing about loading changes.
    try {
      var dsc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      if (dsc && dsc.set && !dsc.set.__cap) {
        var ns = function (v) {
          try { noteRequest(v, 'GET', null, 'image'); } catch (e) {}
          return dsc.set.call(this, v);
        };
        ns.__cap = true;
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
          get: dsc.get, set: ns, configurable: true, enumerable: dsc.enumerable
        });
      }
    } catch (e) {}
  }
  function installPerf() {
    if (!window.PerformanceObserver) return;
    function handle(entries) {
      entries.forEach(function (e) {
        try {
          if (!e || !e.name || !endpointFor(e.name)) return;
          var patch = {};
          if (e.duration) patch.duration_ms = Math.round(e.duration);
          if (e.transferSize) patch.bytes_in = e.transferSize;
          if (e.responseStatus) patch.status = e.responseStatus;
          if (enrich(e.name, patch)) return;
          noteRequest(e.name, e.initiatorType === 'beacon' ? 'POST' : 'GET', null,
                      'perf:' + (e.initiatorType || '?'), patch);
        } catch (err) {}
      });
    }
    try {
      new PerformanceObserver(function (list) { handle(list.getEntries()); })
        .observe({ type: 'resource', buffered: true });
    } catch (e) {
      try {
        new PerformanceObserver(function (list) { handle(list.getEntries()); })
          .observe({ entryTypes: ['resource'] });
        if (performance.getEntriesByType) handle(performance.getEntriesByType('resource'));
      } catch (e2) {}
    }
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
    return load().filter(function (r) { return sourceOn(kindOf(r)); }).map(function (r) {
      var on = displayMatcher(r);
      var o = { _time: r._time, _kind: kindOf(r), _type: r._type, _via: r._via,
                _host: r._host, _path: r._path, _fields: r._fields, data: {} };
      if (r._extra) { o._uncat = r._uncat; o._extra = r._extra; }
      if (r._net) { o._net = r._net; }
      if (r._dom) { o._dom = r._dom; }
      if (r._afterClick) { o._afterClick = r._afterClick; }
      Object.keys(r.data).forEach(function (k) { if (on(k)) o.data[k] = r.data[k]; });
      return o;
    });
  }
  function countBy(kind) {
    return load().filter(function (r) { return kindOf(r) === kind; }).length;
  }
  function toJSON() { return JSON.stringify(visibleRows(), null, 2); }
  function toCSV() {
    var rows = visibleRows();
    var meta = ['_time', '_kind', '_type', '_via', '_host', '_path', '_fields',
                '_net_endpoint', '_net_method', '_net_transport', '_net_status', '_net_ms',
                '_net_bytes_out', '_net_profile', '_net_route', '_net_datasource', '_net_link',
                '_net_from', '_net_missing', '_net_changed', '_net_wire_params',
                '_net_expanded', '_net_tags', '_net_url',
                '_dom_interaction_id', '_dom_element_text', '_dom_component_name',
                '_dom_classes', '_dom_form', '_dom_link', '_dom_mismatch', '_extra'];
    // Derived columns: the markup's own view of the element that was engaged with,
    // and the wire facts for beacon rows. Both sources share the attribute columns
    // that follow, so a utag row and its beacon line up side by side.
    function metaVal(r, m) {
      var a = r._dom && r._dom.analytics, el = r._dom && r._dom.element, f = r._dom && r._dom.form;
      var n = r._net;
      switch (m) {
        case '_net_endpoint':  return n ? n.endpoint : '';
        case '_net_method':    return n ? n.method : '';
        case '_net_transport': return n ? n.transport : '';
        case '_net_status':    return n && n.status != null ? n.status : '';
        case '_net_ms':        return n && n.duration_ms != null ? n.duration_ms : '';
        case '_net_bytes_out': return n && n.bytes_out ? n.bytes_out : '';
        case '_net_profile':   return n ? [n.account, n.profile, n.env].filter(Boolean).join('/') : '';
        case '_net_route':     return n ? (n.route || '') : '';
        case '_net_datasource':return n ? n.datasource : '';
        case '_net_link':      return n ? (n.link || '') : '';
        case '_net_from':      return n && n.paired ? (n.paired.type + ' ' + n.paired.time) : '';
        case '_net_missing':   return n && n.missing ? n.missing.join(' ; ') : '';
        case '_net_changed':   return n && n.changed ? n.changed.join(' ; ') : '';
        case '_net_wire_params': return n && n.wire_params != null ? n.wire_params : '';
        case '_net_expanded':  return n && n.expanded ? n.expanded.join(' ; ') : '';
        case '_net_tags':      return n ? (n.tags || '') : '';
        case '_net_url':       return n ? n.url : '';
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
  // Badge reads "utag · beacons", and drops the half you have paused.
  function refreshBadge() {
    if (!badgeEl) return;
    var s = sources(), u = countBy('udo'), n = countBy('net'), parts = [];
    if (s.udo !== false) parts.push(String(u));
    if (s.net !== false) parts.push(String(n));
    badgeEl.textContent = parts.length ? parts.join(' · ') : '—';
    badgeEl.title = u + ' utag events and ' + n + ' beacons in the store';
  }
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
        var allOn = g.keys.every(function (k) { return enabledSet()[qid(g, k)]; });
        g.keys.forEach(function (k) { setEnabled(qid(g, k), !allOn); });
        renderFields();
      });
      head.appendChild(toggle);
      fieldsEl.appendChild(head);
      if (g.scope) {
        fieldsEl.appendChild(el('div', 'font-size:10px;color:#777;margin:0 0 3px',
          'Only recognised on ' + g.scope.endpoint.join(', ') + ' rows.'));
      }
      g.keys.forEach(function (k) {
        var row = el('label', 'display:flex;align-items:baseline;gap:6px;padding:2px 0;cursor:pointer;font-size:11px;color:#ddd');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!on[qid(g, k)];
        cb.style.cssText = 'margin:0;cursor:pointer;flex:none';
        cb.addEventListener('change', function () { setEnabled(qid(g, k), cb.checked); });
        row.appendChild(cb);
        // Label first where there is one, with the raw key kept alongside in dim
        // monospace — you still need the literal name to search Tealium.
        var lab = labelFor(g, k);
        if (lab) {
          var box = el('span', 'display:flex;flex-direction:column;gap:1px;min-width:0');
          box.appendChild(el('span', null, lab));
          box.appendChild(el('span', 'font-family:ui-monospace,Menlo,monospace;color:#8a8a8a;font-size:10px', k));
          row.appendChild(box);
        } else {
          row.appendChild(el('span', 'font-family:ui-monospace,Menlo,monospace', k));
        }
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
      // If the typed key already exists in a catalogue group, tick it there —
      // under that group's qualified id, so a scoped key ends up in the right one.
      var host = null;
      CATALOGUE.forEach(function (g) { if (!host && g.keys.indexOf(k) >= 0) host = g; });
      if (host) {
        setEnabled(qid(host, k), true);
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
  // A half-built widget is worse than none: hostEl would be set, so every later
  // attempt would short-circuit on the `if (hostEl)` guard and the pill would
  // stay missing for the rest of the session with no way back. So a failure
  // anywhere in construction tears the node down and clears the references,
  // which lets the watchdog try again.
  function buildUI() {
    if (hostEl || !document.body) return;
    try {
      buildUIInner();
    } catch (e) {
      try { if (hostEl && hostEl.parentNode) hostEl.parentNode.removeChild(hostEl); } catch (e2) {}
      hostEl = badgeEl = panelEl = toastEl = fieldsEl = null;
      console.log('%c[CAP] panel failed to build — retrying shortly%c  ' + (e && e.message),
        'background:#e53935;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold', 'color:#999');
    }
  }
  function buildUIInner() {
    var ui = ls(UI_KEY, {});
    hostEl = document.createElement('div');
    hostEl.id = '__tealium_cap_host';
    // Clamped to the viewport. A position dragged on a wide monitor and then
    // reloaded on a narrow window would otherwise put the pill off-screen, which
    // looks exactly like the script having stopped working.
    var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
    var right = Math.min(Math.max(0, ui.right != null ? ui.right : 16), Math.max(0, vw - 90));
    var bottom = Math.min(Math.max(0, ui.bottom != null ? ui.bottom : 16), Math.max(0, vh - 40));
    hostEl.style.cssText = 'position:fixed;z-index:2147483647;' +
      'right:' + right + 'px;bottom:' + bottom + 'px;';
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
    // Sources — the two switches. Unticking pauses capture as well as hiding,
    // so beacons stop eating the row budget when you only care about utag calls.
    var srcWrap = el('div', 'margin:2px 0 9px');
    srcWrap.appendChild(el('div', 'font-weight:700;color:#8ecdf5;font-size:11px;' +
      'text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px', 'Sources'));
    [['udo', 'utag events  ·  view / link / track', '#66bb6a'],
     ['net', 'Server-side beacons  ·  i.gif, rp.gif, /event', '#26c6da']].forEach(function (s) {
      var lab = el('label', 'display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:11px;color:#ddd');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = sources()[s[0]] !== false;
      cb.style.cssText = 'margin:0;cursor:pointer';
      cb.addEventListener('change', function () {
        setSource(s[0], cb.checked);
        refreshBadge();
        toast((cb.checked ? 'Capturing ' : 'Paused ') + (s[0] === 'net' ? 'beacons' : 'utag events'));
      });
      lab.appendChild(cb);
      lab.appendChild(el('span', 'width:7px;height:7px;border-radius:50%;flex:none;background:' + s[2]));
      lab.appendChild(el('span', null, s[1]));
      srcWrap.appendChild(lab);
    });
    srcWrap.appendChild(el('div', 'font-size:10px;color:#777;margin-top:4px',
      'Unticked is not recorded and not exported. Rows captured while it was on come back when you tick it again.'));
    panelEl.appendChild(srcWrap);
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
  // Sites that hydrate or client-side route can replace the contents of <body>,
  // which silently detaches our host node. Nothing in the widget's own lifecycle
  // would notice, so the pill would simply be gone until the next reload. Check
  // that it is still attached and put it back if not.
  function watchdog() {
    setInterval(function () {
      try {
        if (!document.body) return;
        if (!hostEl) { buildUI(); return; }
        if (hostEl.isConnected === false || !document.body.contains(hostEl)) {
          document.body.appendChild(hostEl);
        }
      } catch (e) {}
    }, 2000);
  }
  function init() {
    runMigrations();
    buildUI();
    if (hostEl) console.log('%c[CAP] panel ready', 'color:#66bb6a');
    setTimeout(recoverInitialView, 800);
  }
  // Both of these must be in place before utag.js runs, hence @run-at
  // document-start. The observer is created second so the wrappers get first
  // sight of anything they can describe more fully than a resource entry can.
  runMigrations();   // before the first capture prints, not just at init
  installNetHooks();
  installPerf();
  watchClicks();   // before init: clicks must be seen even if the UI never builds
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // Belt and braces. init() is idempotent, so a second call costs nothing, and
  // this covers a DOMContentLoaded we somehow never receive.
  setTimeout(init, 1500);
  watchdog();
  // ───────────────────────────────────────────────────────────────────────────
  // Console helpers
  // ───────────────────────────────────────────────────────────────────────────
  window.__capDump = function () {
    console.table(visibleRows().map(function (r) {
      return {
        time: r._time, kind: r._kind, type: r._type,
        endpoint: r._net ? r._net.endpoint : '',
        status: r._net && r._net.status != null ? r._net.status : '',
        page_category: r.data.page_category,
        interaction_id: r.data.interaction_id,
        dom_interaction_id: r._dom && r._dom.analytics ? r._dom.analytics.interaction_id : '',
        mismatch: (r._dom && r._dom.mismatch) || (r._net && r._net.missing) ? '⚠' : '',
        element_text: r.data.element_text,
        listing_id: r.data['odp.listing_id_short'] || r.data['odp.listing_id'],
        reddit_event: r.data['reddit.event_name'],
        path: r._path
      };
    }));
    return toJSON();
  };
  // Beacons only, with the wire facts and what the utag payload lost on the way.
  window.__capNet = function () {
    var rows = visibleRows().filter(function (r) { return r._kind === 'net'; });
    console.table(rows.map(function (r) {
      var n = r._net || {};
      return {
        time: r._time, endpoint: n.endpoint, method: n.method, transport: n.transport,
        status: n.status != null ? n.status : '', ms: n.duration_ms != null ? n.duration_ms : '',
        bytes: n.bytes_out || '', event: n.event,
        profile: [n.account, n.profile, n.env].filter(Boolean).join('/'),
        datasource: n.datasource, params: r._fields, link: n.link || '',
        from: n.paired ? n.paired.time : '',
        not_sent: n.missing ? n.missing.join(', ') : (n.missing_total ? n.missing_total + ' attrs' : '')
      };
    }));
    return rows;
  };
  // __capSources()            -> current state
  // __capSources(true, false) -> utag on, beacons off
  window.__capSources = function (udo, net) {
    if (arguments.length) {
      setSource('udo', !!udo);
      setSource('net', arguments.length > 1 ? !!net : sources().net !== false);
      refreshBadge();
    }
    var s = sources();
    console.log('%c[CAP] sources%c  utag ' + (s.udo !== false ? 'on' : 'OFF') +
      '  ·  beacons ' + (s.net !== false ? 'on' : 'OFF'),
      'background:#66bb6a;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold', 'color:#999');
    return s;
  };
  // Force the pill back: tears down whatever is there, forgets the stored drag
  // position, and rebuilds at the default corner. First thing to try if the pill
  // is missing — captures are unaffected either way, they are in localStorage.
  window.__capPanel = function () {
    try { if (hostEl && hostEl.parentNode) hostEl.parentNode.removeChild(hostEl); } catch (e) {}
    hostEl = badgeEl = panelEl = toastEl = fieldsEl = null;
    try { localStorage.removeItem(UI_KEY); } catch (e) {}
    buildUI();
    console.log('%c[CAP] panel ' + (hostEl ? 'rebuilt bottom-right' : 'could NOT be built'),
      'color:' + (hostEl ? '#66bb6a' : '#e53935') + ';font-weight:bold');
    return !!hostEl;
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
    '%c[CAP] armed%c  utag + beacons · panel bottom-right · __capDump() · __capNet() · ' +
    '__capCSV() · __capSources() · __capClear() · __capResetFields()',
    'background:#66bb6a;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold',
    'color:#999'
  );
})();
// Note on 'ut.event': in captured payloads it reads "view" even on link events,
// because it reflects the last page view rather than the current track type.
// Use the _type column instead.