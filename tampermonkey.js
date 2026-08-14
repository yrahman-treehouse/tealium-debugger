// ==UserScript==
// @name         Tealium event capture — Treehouse
// @namespace    treehouse.analytics
// @version      7.5
// @description  Logs every utag view/link event, every client-to-server Tealium beacon (i.gif, /event) AND the vendor pixels the tags fire (Meta, GA4, Google Ads, UET/Bing, Clarity, Awin, Reddit) — plus a discovery survey of any third-party tracking endpoint NOT in the catalogue, attributed to the script that fired it. On-screen field picker and JSON/CSV export, persists across page loads and tabs.
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
//   net  — the requests utag then makes: Tealium's own collect layer (i.gif,
//          /event, the visitor-service lookups) AND the third-party pixels its
//          tags fire — Meta, GA4, Google Ads, Microsoft UET, Clarity, Awin,
//          Reddit. This is what ACTUALLY left the browser, and to whom.
//
// They are not redundant. Mapped attributes, consent gating and tag-level
// filtering all sit between the two, so an attribute can be present in the utag
// payload and absent from the beacon. Each beacon is linked back to the utag
// call that produced it and the difference is reported.
//
// A vendor pixel is shown as its own row type and is NEVER diffed against the
// utag payload: it carries the vendor's parameter names, not the UDO, so the
// two have no attributes in common and a diff would be pure noise. What it
// answers instead is "did this tag fire, to which account, with what event
// name, value and consent signal" — which is the question a tag audit asks.
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
      'reddit_pixel_event_id_*': 'Event id for pixel/CAPI dedupe (per tag)',
      'cp._rdt_uuid': 'Reddit visitor id cookie',
      'cp._rdt_cid':  'Reddit click id cookie',
      'cp._rdt_em':   'Reddit hashed email cookie'
    }},
    { name: 'Consent', keys: [
      'consent_decision', 'tci.consent_type', 'tci.event_id',
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
      'google_ads_data_redaction':            'Consent Mode · redact ad ids when denied',
      'google_url_passthrough':               'Consent Mode · pass gclid when denied',
      'microsoft_ad_storage_consent':         'Microsoft UET · ad_storage',
      'tci.consent_type':                     'Tealium consent integration · decision type',
      'tci.event_id':                         'Tealium consent integration · event id',
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
      'experiment_*': 'Per-experiment variant (id is in the key)'
    }},
    // Labels below are Tealium's own definitions of its automatically-collected
    // data sources. The ut.* half is worth reading once: almost all of it is a
    // COPY of a tealium_* attribute, so a mismatch between the two on the same
    // hit means something rewrote one of them.
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
    ], labels: {
      'tealium_visitor_id':           'Copy of the utag_main_v_id cookie',
      'tealium_session_id':           'Copy of utag_main_ses_id (start, epoch ms)',
      'tealium_session_number':       'Sessions for this visitor (utag_main__sn)',
      'tealium_session_event_number': 'Events so far this session (utag_main__se)',
      'tealium_random':               'Random number, stamped per hit',
      'tealium_timestamp_utc':        'UTC timestamp',
      'tealium_timestamp_epoch':      'Unix timestamp in seconds',
      'tealium_timestamp_local':      'Local timestamp',
      'tealium_account':              'Tealium account name',
      'tealium_profile':              'Tealium account profile',
      'tealium_environment':          'Publish environment (prod / qa / dev)',
      'tealium_datasource':           'Data source key',
      'tealium_library_name':         'Library name',
      'tealium_library_version':      'Library version',
      'ut.env':                       'Copy of tealium_environment',
      'ut.profile':                   'Copy of tealium_profile',
      'ut.version':                   'Publish version — utag.js version + timestamp',
      'ut.account':                   'Copy of tealium_account',
      'ut.domain':                    'Top-level domain used for setting cookies',
      'ut.visitor_id':                'Copy of tealium_visitor_id',
      'ut.session_id':                'Copy of tealium_session_id'
    }},
    // utag's own per-tag bookkeeping, which rides along inside the collect POST.
    // Keyed by tag UID: loader.cfg.<uid>.<field>. Reading send=0 or consent=0 for
    // a UID tells you why a tag stayed quiet, which nothing else exposes.
    // The numeric values are reported verbatim — utag's 'load' codes in particular
    // are not documented anywhere I would trust, so no meaning is invented here.
    { name: 'Tealium loader (per tag)', keys: [
      'loader.cfg.*', 'loader.*'
    ], labels: {
      'loader.cfg.*': 'Per-tag load/send/wait/consent, by tag UID',
      'loader.*':     'Any other utag loader bookkeeping'
    }},
    { name: 'Tealium cookies', keys: [
      'cp.utag_main_v_id', 'cp.utag_main_ses_id', 'cp.utag_main__sn', 'cp.utag_main__ss',
      'cp.utag_main__se', 'cp.utag_main__st', 'cp.utag_main__pn',
      'cp.utag_main_dc_visit', 'cp.utag_main_dc_event', 'cp.utag_main_dc_region',
      'cp.utag_main_dc_group', 'cp.utagdb'
    ], labels: {
      'cp.utag_main_v_id':   'Visitor id',
      'cp.utag_main_ses_id': 'Session id (session start, epoch ms)',
      'cp.utag_main__sn':    'Session number',
      'cp.utag_main__ss':    'First hit of the session (1 = yes)',
      'cp.utag_main__se':    'Events so far this session',
      'cp.utag_main__st':    'Session expires at (epoch ms)',
      'cp.utag_main__pn':    'Page views this session',
      'cp.utagdb':           'utag debug mode',
      // Previously left unlabelled as guesswork. Tealium documents all four: they
      // are set by the Collect tag, not by utag.js itself, which is why they only
      // appear once that tag is live.
      'cp.utag_main_dc_visit':  'Sessions in which the Collect tag has fired',
      'cp.utag_main_dc_event':  'Events for which the Collect tag has fired',
      'cp.utag_main_dc_region': 'AudienceStream region storing this visit',
      'cp.utag_main_dc_group':  'Random number for the Collect sample size'
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
      'timing.*': 'Navigation timing (dns, ttfb, load …) + context'
    }},
    { name: 'Page / DOM', keys: [
      'dom.url', 'dom.pathname', 'dom.referrer', 'dom.title', 'dom.query_string',
      'dom.domain', 'dom.hash', 'dom.viewport_width', 'dom.viewport_height',
      'browser_agent', 'language_settings_browser'
    ], labels: {
      'dom.url':             'Full URL of the page (document.URL)',
      'dom.pathname':        'URL path, without query string or domain',
      'dom.referrer':        'URL of the previous page (document.referrer)',
      'dom.title':           'Text between the <title> tags',
      'dom.query_string':    'Full query string (location.search)',
      'dom.domain':          'Full domain of the URL (location.hostname)',
      'dom.hash':            'URL hash fragment, without the #',
      'dom.viewport_width':  'Width of the browser viewport',
      'dom.viewport_height': 'Height of the browser viewport'
    }},
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
      'cp._gcl_aw', 'cp._gcl_dc', 'cp._fbc', 'cp._clck', 'cp._clsk',
      'cp._awin_awc', 'cp.awc',
      'cp.g_state', 'cp._ta', 'cp._tas', 'cp._tac',
      'clarity.project_id', 'meta.facebook.pixel_id',
      'fb_event_id_*'
    ], labels: {
      'fb_event_id_*': 'Meta event id for pixel/CAPI dedupe (per tag)',
      'cp._ga':      'GA client id',
      'cp._ga_*':    'GA4 session state (per property)',
      'cp._fbp':     'Meta browser id',
      'cp._fbc':     'Meta click id (from fbclid on landing page)',
      'cp._clck':    'Clarity visitor id',
      'cp._clsk':    'Clarity session id',
      'cp._awin_awc': 'Awin click ref (awc), set by the MasterTag',
      'cp.awc':      'Awin click ref set on the landing page',
      'cp._uetsid':  'Microsoft UET session id',
      'cp._uetvid':  'Microsoft UET visitor id',
      'cp._gcl_au':  'Google Ads first-party click id',
      'cp._gcl_aw':  'Google Ads click id from Search (gclid)',
      'cp._gcl_dc':  'Google Ads click id from Display (dclid)',
      // Correction: I previously labelled this "mistyped, always empty". A live
      // capture proved otherwise — it carries a normal Google Ads value. There is
      // a real cookie by this name here; Google's own is the single-underscore
      // _gcl_au, so both exist and it is worth knowing which your tags read.
      'cp.__gcl_au': 'Google Ads click id — non-standard __ cookie',
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
        'ts', 'v', 'sh', 'sw', 'db',
        // Sent alongside m.* on live conversion hits.
        'category', 'name'
      ], labels: {
        'event':          'Reddit event name',
        'id':             'Reddit advertiser / pixel id',
        'uuid':           'Reddit visitor id (_rdt_uuid cookie)',
        'click_id':       'Reddit click id (from _rdt_cid)',
        'em':             'Hashed email — advanced matching',
        'external_id':    'Your own user id — advanced matching',
        'm.conversionId': 'Conversion id — dedupes against the CAPI',
        'm.*':            'Other event metadata (value, currency …)',
        'integration':    'Reporting integration name',
        'partner':        'Reporting partner — TEALIUM if Tealium-fired',
        'opt_out':        'Opt-out flag (1 = do not track)',
        'esurl':          'Event source URL',
        'ts':             'Client timestamp (epoch ms)',
        'v':              'Reddit pixel version',
        'sh':             'Screen height reported to Reddit',
        'sw':             'Screen width reported to Reddit',
        'db':             'Reddit pixel diagnostics flags',
        'category':       'Product category sent to Reddit',
        'name':           'Product name sent to Reddit'
      }},
    // ─────────────────────────────────────────────────────────────────────────
    // The remaining scoped groups follow the same rule as Reddit's: these are
    // the VENDOR's parameter names as they appear on the wire, recognised only
    // on that vendor's endpoint. Several of them collide across vendors — 'v',
    // 'id', 'ev', 'ec', 'r' and 'sid' each mean something different to Meta,
    // UET and GA4 — and scoping is what keeps a Meta label off a GA4 hit.
    //
    // Only parameters whose meaning is documented or unambiguous are labelled.
    // Anything else is left out of the catalogue entirely rather than guessed
    // at: it still shows up in the Uncatalogued block, where it is honest.
    // ─────────────────────────────────────────────────────────────────────────
    { name: 'Meta pixel (on the wire)', id: 'fb_wire', scope: { endpoint: ['fb/tr'] },
      keys: [
        'id', 'ev', 'eid', 'dl', 'rl', 'if', 'ts', 'sw', 'sh', 'v', 'r', 'ec',
        'fbp', 'fbc', 'it', 'coo', 'rqm', 'cd[*', 'ud[*',
        // Seen on live hits. 'a' is the one worth reading of these: it names
        // Tealium as the thing that fired the pixel, which is how you tell a
        // Tealium-fired Meta hit from one hardcoded in the page.
        'a', 'cdl', 'ler', 'plt', 'tz',
        // ── UNLABELLED ON PURPOSE ────────────────────────────────────────
        // Researched, not guessed. These, and the equivalents in the UET, Google
        // Ads, GA4 and GTM groups below, are absent from every primary source:
        // Meta's pixel reference, Microsoft's UET parameter table, the gtag.js
        // parameter reference, and Google's own server-side "internal
        // parameters" page — which lists names and types but publishes no
        // description column at all.
        //
        // Pages that DO define them ("bo = byte order", "sv = server version",
        // "o = offset or counter") are inferring from a sample URL and say so if
        // you read them closely. Copying that in would turn somebody's guess
        // into something that looks authoritative inside a debugger, which is
        // the one thing this catalogue must not do. They stay catalogued,
        // ticked and visible under their real names, with no invented meaning.
        //
        // If you find a real source, this is the place to fix it.
        'aems', 'iw', 'o', 'tm',
        // 38 parameters on a single hit, each a short feature-flag code, so they
        // get one wildcard rather than 38 checkboxes. Off by default — see the
        // note above DEFAULT_ON.
        'expv2[*'
      ], labels: {
        'id':   'Meta pixel id',
        'ev':   'Meta event name (PageView, Purchase, …)',
        'eid':  'Event id — dedupes against the CAPI',
        'dl':   'Page URL',
        'rl':   'Referrer URL',
        'if':   'Fired inside an iframe',
        'ts':   'Client timestamp (epoch ms)',
        'sw':   'Screen width reported to Meta',
        'sh':   'Screen height reported to Meta',
        'v':    'Meta pixel version',
        'r':    'Pixel release channel (stable, …)',
        'ec':   'Event count — nth from this pixel this page',
        'fbp':  'Meta browser id (the _fbp cookie value)',
        'fbc':  'Meta click id (_fbc cookie, from fbclid)',
        'it':   'Pixel initialisation time (epoch ms)',
        'coo':  'First-party cookie use enabled',
        'rqm':  'Transport the pixel chose (GET / POST)',
        'cd[*': 'Custom data — value, currency, content_ids …',
        'ud[*': 'Advanced matching — hashed em, ph, fn, id …',
        'a':    'Agent that fired it (tmtealium = Tealium)',
        'cdl':  'Cookie-deprecation label; API_unavailable = none',
        'ler':  'Last external referrer',
        'plt':  'Page load time (ms)',
        'tz':   'Timezone offset from UTC (minutes)',
        'expv2[*': 'Meta feature-flag vector, ~38 codes per hit'
      }},
    { name: 'Awin conversion (on the wire)', id: 'awin_wire', scope: { endpoint: ['awin'] },
      keys: [
        'tt', 'tv', 'merchant', 'amount', 'cr', 'ref', 'parts', 'ch', 'vc',
        'testmode', 'cks', 'pt'
      ], labels: {
        'tt':       'Tracking type — ns = new sale',
        'tv':       'Awin tracking version (2 = image tag)',
        'merchant': 'Awin advertiser id',
        'amount':   'Commissionable order value',
        'cr':       'Currency of amount',
        'ref':      'Your order reference — deduplicates the sale',
        'parts':    'Commission group breakdown — GROUP:amount',
        'ch':       'Attributed channel (aw = affiliate)',
        'vc':       'Voucher code used',
        'testmode': 'Test mode (1 = not booked as a real sale)',
        'cks':      'Awin click reference (the awc value)',
        'pt':       'Product-level tracking string (AW:P|…)'
      }},
    { name: 'Microsoft UET (on the wire)', id: 'uet_wire', scope: { endpoint: ['uet'] },
      keys: [
        'ti', 'evt', 'ea', 'ec', 'el', 'ev', 'gv', 'gc', 'Ver', 'mid', 'sid',
        'vid', 'p', 'r', 'tl', 'lt', 'sw', 'sh', 'msclkid', 'prodid',
        'pagetype', 'asc', 'uach',
        // From live hits. 'tcf' is the useful one — it spells out the consent
        // state UET actually acted on, which 'asc' only summarises.
        'tcf', 'lg', 'rn',
        // Named but unlabelled — see the note in the Meta group.
        'bo', 'tm', 'cdb', 'src', 'vids', 'pi', 'sc', 'sv'
      ], labels: {
        'ti':      'UET tag id',
        'evt':     'Hit type — pageLoad, custom, …',
        'ea':      'Event action',
        'ec':      'Event category',
        'el':      'Event label',
        'ev':      'Event value',
        'gv':      'Revenue / goal value',
        'gc':      'Currency of gv',
        'Ver':     'UET library version',
        'mid':     'Message id — unique per hit',
        'sid':     'UET session id',
        'vid':     'UET visitor id',
        'p':       'Page URL',
        'r':       'Referrer URL',
        'tl':      'Page title',
        'lt':      'Page load time (ms)',
        'sw':      'Screen width reported to UET',
        'sh':      'Screen height reported to UET',
        'msclkid': 'Microsoft click id',
        'prodid':  'Product id — remarketing (ecomm_prodid)',
        'pagetype':'Page type — remarketing (ecomm_pagetype)',
        'asc':     'Consent Mode · ad_storage (G=grant, D=deny)',
        'uach':    'User-agent client hints',
        'tcf':     'Consent UET acted on — gdpr=Y/N, as/ms=G|D',
        'lg':      'Browser language',
        'rn':      'Cache buster'
      }},
    // Clarity uploads a JSON body whose envelope is a POSITIONAL ARRAY, not an
    // object: 'e' is [version, sequence, start, duration, projectId, userId,
    // sessionId, pageNum, …]. There is no key per field to catalogue, so the
    // top-level members are all that can be named here. The value of this entry
    // is seeing THAT Clarity uploaded and how big the payload was — for the
    // contents, read the array positionally or use Clarity's own debug mode.
    { name: 'Clarity upload (on the wire)', id: 'clarity_wire', scope: { endpoint: ['clarity'] },
      keys: ['e', 'a', 'p', 'd'], labels: {
        'e': 'Envelope [ver,seq,start,dur,proj,user,sess,page]',
        'a': 'Analytics events in the upload',
        'p': 'Playback (session recording) events',
        'd': 'Dimension / metadata entries'
      }},
    { name: 'Google Ads (on the wire)', id: 'gads_wire', scope: { endpoint: ['gads'] },
      keys: [
        'label', 'value', 'currency_code', 'oid', 'data', 'gtm', 'gcs', 'gcd',
        'dma', 'dma_cps', 'npa', 'auid', 'gclaw', 'gad_source',
        'ct_cookie_present', 'random', 'cv', 'fst', 'url', 'ref', 'tiba',
        'u_h', 'u_w', 'u_tz', 'frm',
        // From live hits.
        'en', 'is_vtc', 'pscdl', 'tag_exp', 'hn', 'bg',
        // Named but unlabelled — see the note in the Meta group.
        'cid', 'ipr', 'rmt_tld', 'guid', 'async', 'fmt', 'rfmt', 'ept', 'rcb',
        '_tu', 'tcfd',
        // User-Agent Client Hints: the browser fingerprint Google now collects in
        // place of the UA string. Eight parameters on every hit, identical across
        // Google Ads and GA4, and never the answer to a tagging question — so
        // catalogued and named, but off by default.
        'uaa', 'uab', 'uafvl', 'uamb', 'uam', 'uap', 'uapv', 'uaw',
        // The /ccm/collect and /rmkt/collect endpoints. These carry GA4-style
        // names on a Google ADS hit, which is exactly why they are scoped: 'tid'
        // here is an AW- conversion id, not a G- measurement id.
        'tid', 'dl', 'dr', 'dt', 'rnd', 'scrsrc', 'tfd', 'ep.*',
        // Named but unlabelled — see the note in the Meta group.
        'apvc', 'ae', 'navt', 'tft', 'tids', 'gcu', 'gcp', 'gap.fsrc'
      ], labels: {
        'label':             'Conversion label — the AW-xxxxx/label pair',
        'value':             'Conversion value',
        'currency_code':     'Currency of value',
        'oid':               'Order / transaction id — dedupes conversion',
        'data':              'Custom conversion params (key=value)',
        'gtm':               'Google tag container version',
        'gcs':               'Consent Mode signal — ad/analytics bits',
        'gcd':               'Consent Mode detail — per-purpose + defaults',
        'dma':               'EEA / DMA rules apply (1 = yes)',
        'dma_cps':           'DMA consent-per-service state',
        'npa':               'Non-personalised ads (1 = yes)',
        'auid':              'Google Ads first-party click id (_gcl_au)',
        'gclaw':             'Google Ads click id (gclid) from the URL',
        'gad_source':        'Ad source from the landing URL',
        'ct_cookie_present': 'Conversion-tracking cookie was present',
        'random':            'Cache buster',
        'cv':                'Conversion tag version',
        'fst':               'First-seen timestamp for this tag',
        'url':               'Page URL',
        'ref':               'Referrer URL',
        'tiba':              'Page title',
        'u_h':               'Screen height reported to Google',
        'u_w':               'Screen width reported to Google',
        'u_tz':              'Timezone offset (minutes)',
        'frm':               'Fired inside a frame',
        'en':                'gtag event — gtag.config on load, conversion',
        'is_vtc':            'View-through conversion (1 = yes, no click)',
        'pscdl':             'Privacy Sandbox cookie-deprecation label',
        'tag_exp':           'Google tag experiment ids for this hit',
        'hn':                'Host that served the conversion tag',
        'bg':                'Legacy conversion iframe background colour',
        'uaa':               'Client hint · CPU architecture',
        'uab':               'Client hint · CPU bitness',
        'uafvl':             'Client hint · brand and full version list',
        'uamb':              'Client hint · mobile (1 = yes)',
        'uam':               'Client hint · device model',
        'uap':               'Client hint · platform',
        'uapv':              'Client hint · platform version',
        'uaw':               'Client hint · WoW64',
        'tid':               'Google Ads conversion id (AW-…)',
        'dl':                'Page URL',
        'dr':                'Referrer URL',
        'dt':                'Page title',
        'rnd':               'Cache buster',
        'scrsrc':            'Host of the sending script — names the TMS',
        'tfd':               'Time from page load to this hit (ms)',
        'ep.*':              'Event parameter — e.g. ep.ads_data_redaction'
      }},
    // GTM's telemetry ping. Worth cataloguing on a Tealium site for one reason:
    // 'id' names the container and 'tr'/'ti' list the tag features it is running,
    // so this row answers "is something OTHER than Tealium managing tags here".
    { name: 'GTM diagnostics (on the wire)', id: 'gtm_wire', scope: { endpoint: ['gtm'] },
      keys: [
        'id', 'e', 'tag_exp', 'gtm', 'cv', 'rv', 'tc', 'z',
        // Named but unlabelled — see the note in the Meta group.
        'v', 't', 'pid', 'es', 'eid', 'u', 'h', 'tr', 'ti', 'ut',
        // The /td ping. Same container talking about itself on a second path, so
        // the parameters live here rather than in a group of their own.
        'seq', 'exp', 'dl', 'tdp', 'frm', 'rtg',
        // Named but unlabelled — see the note in the Meta group.
        'slo', 'hlo', 'lst', 'bt', 'ct', 'jsp', 'pcid'
      ], labels: {
        'id':      'Container / tag id (AW-…, G-…, GTM-…)',
        'e':       'What is reported — gtm.init on load',
        'tag_exp': 'Google tag experiment ids for this hit',
        'gtm':     'Google tag container version',
        'cv':      'Container version',
        'rv':      'Container release version',
        'tc':      'Tag count in the container',
        'z':       'Cache buster',
        'seq':     'Sequence number of this ping on the page',
        'exp':     'Google tag experiment ids for this hit',
        'dl':      'Page URL',
        'tdp':     'Diagnostics payload — container id, then tag ids',
        'frm':     'Fired inside a frame',
        'rtg':     'Remarketing tag id the container is running'
      }},
    // PromptWatch posts JSON, so these keys are the FLATTENED body: the nested
    // 'payload' object arrives as payload.href, payload.referrer and so on, and
    // those dotted names are what the row actually carries.
    { name: 'PromptWatch (on the wire)', id: 'pw_wire', scope: { endpoint: ['promptwatch'] },
      keys: [
        'project_id', 'action', 'version',
        'payload.href', 'payload.referrer', 'payload.locale', 'payload.timezone'
      ], labels: {
        'project_id':        'PromptWatch project the hit is written to',
        'action':            'What is being reported — the event name',
        'version':           'Client library version',
        'payload.href':      'Page URL',
        'payload.referrer':  'Referrer URL',
        'payload.locale':    'Browser locale',
        'payload.timezone':  'Browser timezone'
      }},
    { name: 'GA4 (on the wire)', id: 'ga4_wire', scope: { endpoint: ['ga4'] },
      keys: [
        'en', 'tid', 'v', 'cid', 'sid', 'sct', 'seg', '_p', '_s', 'uid',
        'dl', 'dr', 'dt', 'ul', 'sr', 'cu', '_et', '_ee', '_fv', '_ss', '_nsi',
        'gcs', 'gcd', 'dma', 'dma_cps', 'npa', 'gtm', 'ir', 'tt', '_dbg',
        'pscdl', 'frm', '_eu', 'ep.*', 'epn.*', 'up.*', 'upn.*', 'pr*', 'sst.*',
        // From live hits.
        'tfd', 'tag_exp',
        // Named but unlabelled — see the note in the Meta group.
        'gaf', 'rcb', '_tu', 'tcfd',
        // The same client-hint block Google Ads sends; off by default for the
        // same reason.
        'uaa', 'uab', 'uafvl', 'uamb', 'uam', 'uap', 'uapv', 'uaw'
      ], labels: {
        'en':      'GA4 event name',
        'tid':     'Measurement id (G-XXXXXXX)',
        'v':       'Measurement Protocol version (2 = GA4)',
        'cid':     'GA client id (from the _ga cookie)',
        'sid':     'GA session id',
        'sct':     'Session count for this visitor',
        'seg':     'Session engaged (1 = yes)',
        '_p':      'Page load id — same on every hit this view',
        '_s':      'Hit sequence number within this page load',
        'uid':     'User id',
        'dl':      'Page URL',
        'dr':      'Referrer URL',
        'dt':      'Page title',
        'ul':      'User language',
        'sr':      'Screen resolution',
        'cu':      'Currency',
        '_et':     'Engagement time since the previous hit (ms)',
        '_ee':     'Enhanced measurement produced this event',
        '_fv':     'First visit (1 = yes)',
        '_ss':     'Session start (1 = yes)',
        '_nsi':    'A new session id was issued',
        'gcs':     'Consent Mode signal — ad/analytics bits',
        'gcd':     'Consent Mode detail — per-purpose + defaults',
        'dma':     'EEA / DMA rules apply (1 = yes)',
        'dma_cps': 'DMA consent-per-service state',
        'npa':     'Non-personalised ads (1 = yes)',
        'gtm':     'Google tag container version',
        'ir':      'Ignore referrer',
        'tt':      'Traffic type override',
        '_dbg':    'GA4 debug mode — hit goes to DebugView',
        'pscdl':   'Privacy Sandbox cookie-deprecation label',
        'frm':     'Fired inside a frame',
        '_eu':     'Feature-usage bitmask',
        'ep.*':    'Event parameter (string)',
        'epn.*':   'Event parameter (number)',
        'up.*':    'User property (string)',
        'upn.*':   'User property (number)',
        'pr*':     'Item in the items array — pr1, pr2, … packed',
        'sst.*':   'Server-side tagging metadata',
        'tfd':     'Time from page load to this hit (ms)',
        'tag_exp': 'Google tag experiment ids for this hit',
        'uaa':     'Client hint · CPU architecture',
        'uab':     'Client hint · CPU bitness',
        'uafvl':   'Client hint · brand and full version list',
        'uamb':    'Client hint · mobile (1 = yes)',
        'uam':     'Client hint · device model',
        'uap':     'Client hint · platform',
        'uapv':    'Client hint · platform version',
        'uaw':     'Client hint · WoW64'
      }},
    { name: 'Universal Analytics (on the wire)', id: 'ua_wire', scope: { endpoint: ['ga/ua'] },
      keys: ['v', 'tid', 't', 'cid', 'uid', 'dl', 'dr', 'dt', 'ul', 'sr', 'ec',
             'ea', 'el', 'ev', 'ni', 'cu', 'z'], labels: {
        'v':   'Measurement Protocol version (1 = UA)',
        'tid': 'Property id (UA-XXXXXX)',
        't':   'Hit type — pageview, event, transaction …',
        'cid': 'GA client id',
        'uid': 'User id',
        'dl':  'Page URL',
        'dr':  'Referrer URL',
        'dt':  'Page title',
        'ul':  'User language',
        'sr':  'Screen resolution',
        'ec':  'Event category',
        'ea':  'Event action',
        'el':  'Event label',
        'ev':  'Event value',
        'ni':  'Non-interaction hit',
        'cu':  'Currency',
        'z':   'Cache buster'
      }}
  ];
  // Keys ending in '*' match by prefix — for values whose names carry a random
  // suffix (GA4 property ids, checkout tokens) and so cannot be listed literally.
  // Never captured: this script's own storage. 'ls.__tealium_cap' holds the
  // entire capture array, so recording it inside each row would nest the whole
  // history in every event and blow the localStorage quota within a few hits.
  var BLOCKLIST = ['ls.__tealium_cap', 'ls.__tealium_cap_fields', 'ls.__tealium_cap_custom',
                   'ls.__tealium_cap_ui', 'ls.__tealium_cap_sources',
                   'ls.__tealium_cap_migrated', 'ls.__tealium_cap_disc',
                   'ls.__tealium_cap_pills', 'ls.__tealium_cap_labels',
                   'ls.__tealium_cap_groups',
                   'ss.__tealium_cap'];
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
    // Vendor click ids. Catalogued in an UNSCOPED group, so they have to be
    // ticked: cataloguing alone would have moved them out of Uncatalogued and
    // straight into invisibility on installs that map these cookies.
    'cp._fbc', 'cp._gcl_aw', 'cp._gcl_dc', 'cp._awin_awc', 'cp.awc',
    'cp._clck', 'cp._clsk',
    // Everything below this point is derived, not listed — see wireDefaults().
    'event', 'reddit_pixel_event_id_*', 'fb_event_id_*',
    'tci.event_id'
  ];
  // ───────────────────────────────────────────────────────────────────────────
  // The vendor wire groups are ticked BY SUBTRACTION: everything a group
  // catalogues is shown, except the families named here.
  //
  // The previous version listed the ticked keys one by one and it went wrong in
  // the obvious way. Each time a group gained parameters I ticked the handful I
  // was thinking about, and the rest stayed catalogued-but-invisible — GA4 ended
  // up hiding 30 of its 52 parameters, including first-visit, session-start,
  // engagement time and the client id. A debugger whose default is to hide most
  // of the payload is not doing its job, and no amount of care with a hand-kept
  // list would have held: the list and the catalogue drift the moment either
  // changes. Deriving it means a parameter added to a group is visible by
  // default, and staying hidden is the thing you have to ask for.
  //
  // What stays off is only ever high-volume machine noise: the browser
  // fingerprint Google sends on every hit, Google's experiment ids, Meta's ~38
  // feature flags, and GTM's opaque bitfields. Each is catalogued and labelled
  // and one click away in the Fields picker.
  // ───────────────────────────────────────────────────────────────────────────
  var WIRE_NOISE = {
    '*':        ['tag_exp', 'uaa', 'uab', 'uafvl', 'uam', 'uamb', 'uap', 'uapv', 'uaw'],
    'fb_wire':  ['expv2[*'],
    'gtm_wire': ['u', 'h', 'z']
  };
  function wireDefaults() {
    var out = [];
    CATALOGUE.forEach(function (g) {
      if (!g.scope) return;
      var noise = (WIRE_NOISE['*'] || []).concat(WIRE_NOISE[g.id] || []);
      g.keys.forEach(function (k) { if (noise.indexOf(k) < 0) out.push(qid(g, k)); });
    });
    return out;
  }
  DEFAULT_ON = DEFAULT_ON.concat(wireDefaults());
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
    { id: 'collect',         kind: 'collect', test: /collect\.tealiumiq\.com\//i },
    // ─── VENDOR PIXELS ───────────────────────────────────────────────────────
    // Third-party endpoints a Tealium tag fires. None of them is a Tealium
    // endpoint and none carries the UDO, so they are typed 'vendor': shown as
    // pixel rows and never diffed against the utag payload.
    //
    // Each entry names the parameter that carries the vendor's own event name
    // ('eventKey'), because none of them agrees on it — Meta says ev, UET says
    // evt, GA4 says en. That value becomes the row headline in the console.
    //
    // Every test is either host-guarded or matches a path specific enough that
    // it cannot be confused with a site's own routes. The library files
    // (connect.facebook.net, bat.js, clarity.ms/tag/…, dwin1.com) are requests
    // but not events, and match nothing here on purpose.
    // Meta pixel. rqm=POST hits carry the same parameters in the body.
    { id: 'fb/tr', kind: 'vendor', vendor: 'Meta', eventKey: ['ev'],
      host: /(^|\.)facebook\.com$/i, test: /\/tr\/?(\?|$)/i },
    // Awin conversion tag. tv=2 is the image tag; the .php spellings are the
    // older form and are still in the wild.
    { id: 'awin', kind: 'vendor', vendor: 'Awin', eventKey: ['tt'],
      host: /(^|\.)awin1\.com$/i, test: /\/s?read\.(img|php)(\?|$)/i },
    // Microsoft Advertising UET. /actionp/ is the variant some tag versions use.
    { id: 'uet', kind: 'vendor', vendor: 'Microsoft Advertising (UET)', eventKey: ['evt', 'ea'],
      host: /(^|\.)bat\.bing\.(com|net)$/i, test: /\/actionp?\/\d+(\?|$)/i },
    // Microsoft Clarity. A POST with a JSON body, not a pixel — see the
    // catalogue group for why its fields cannot be broken out individually.
    { id: 'clarity', kind: 'vendor', vendor: 'Microsoft Clarity',
      host: /(^|\.)clarity\.ms$/i, test: /\/(collect|c\.gif)(\?|$)/i },
    // Google Ads conversions and remarketing. The conversion label lives in the
    // path for /conversion/AW-xxx/ hits and in the 'label' parameter otherwise;
    // the newer endpoints name the event in 'en' instead, so both are read.
    { id: 'gads', kind: 'vendor', vendor: 'Google Ads', eventKey: ['label', 'en'],
      test: /\/pagead\/(1p-)?(viewthrough)?(conversion|user-list)\//i },
    { id: 'gads', kind: 'vendor', vendor: 'Google Ads',
      test: /\/ads\/ga-audiences(\?|$)/i },
    // The Google tag's current conversion path, which replaced /pagead/ for
    // accounts on the newer tag. Same account, same conversions, different URL —
    // it turns up on google.com, on pagead2.googlesyndication.com and on
    // ad.doubleclick.net (/ccm/s/collect), so this is matched on path alone.
    { id: 'gads', kind: 'vendor', vendor: 'Google Ads', eventKey: ['label', 'en'],
      test: /\/ccm\/(s\/)?collect(\?|$)/i },
    // Remarketing, likewise moved off /pagead/viewthroughconversion. The AW id
    // is the path segment: /rmkt/collect/11229689579/
    { id: 'gads', kind: 'vendor', vendor: 'Google Ads', eventKey: ['label', 'en'],
      test: /\/rmkt\/collect\//i },
    // GTM reporting on ITSELF — which container loaded, which tags fired. Not a
    // marketing hit and nothing is measured by it, but it is proof that a Google
    // tag container is running on the page and it names the ids that container
    // manages. On a Tealium site that is worth seeing rather than filtering out.
    { id: 'gtm', kind: 'vendor', vendor: 'Google Tag Manager (diagnostics)', eventKey: ['e'],
      host: /(^|\.)googletagmanager\.com$/i, test: /\/a(\?|$)/i },
    // /td is the same conversation on a different path — the newer Google tag
    // reports itself here, with the container in 'id' and the tag ids in 'tdp'.
    // It shares the 'gtm' id deliberately: one pill, one switch, one catalogue
    // group, exactly as the five Google Ads entries above share theirs. The path
    // that matched is on the row's request line when you need to tell them apart.
    { id: 'gtm', kind: 'vendor', vendor: 'Google Tag Manager (diagnostics)', eventKey: ['e'],
      host: /(^|\.)googletagmanager\.com$/i, test: /\/td(\?|$)/i },
    // PromptWatch, found by the discovery survey on rentaroof: a POST of JSON,
    // loaded by its own client.min.js which GTM injects. The parameter names are
    // the flattened body, so 'payload.href' is the literal captured key.
    { id: 'promptwatch', kind: 'vendor', vendor: 'PromptWatch', eventKey: ['action'],
      host: /(^|\.)promptwatch\.com$/i, test: /\/event(\?|$)/i },
    // GA4. /g/collect is distinctive enough to need no host guard, which is what
    // catches a server-side container on a first-party domain.
    { id: 'ga4', kind: 'vendor', vendor: 'Google Analytics 4', eventKey: ['en'],
      test: /\/g\/(s\/)?collect(\?|$)/i },
    { id: 'ga4', kind: 'vendor', vendor: 'Google Analytics 4', eventKey: ['en'],
      test: /\/mp\/collect(\?|$)/i },
    // Universal Analytics, host-guarded because a bare /collect is far too
    // generic. Only fires if something is still sending v=1 hits. 'collect' is
    // anchored as the first or second path segment so this cannot also claim the
    // GA4 /g/collect above it.
    { id: 'ga/ua', kind: 'vendor', vendor: 'Universal Analytics', eventKey: ['t'],
      host: /(^|\.)google-analytics\.com$|(^|\.)analytics\.google\.com$/i,
      test: /\/\/[^\/]+\/([jr]\/)?collect(\?|$)/i }
  ];
  // Library and profile assets are requests, but not events — never log them.
  var NET_IGNORE = /(^|\.)tiqcdn\.com$/i;
  // ───────────────────────────────────────────────────────────────────────────
  // CONSOLE PILLS — one look tells you who the hit went to.
  //
  // Keyed by endpoint id, so the two-entry vendors (gads, ga4) share one style.
  // 'tag' replaces the generic PIXEL badge: a row that says META reads faster
  // than one that says PIXEL and makes you go and find the endpoint name.
  //
  // The colours approximate each vendor's primary brand colour, adjusted where
  // two of them would otherwise be indistinguishable at pill size — Meta and
  // Google Ads are both blue, so Meta keeps the deeper one. Clarity and Awin are
  // the two I am least sure of and are picked mainly to stay distinct from the
  // rest; if you know the real brand values, this map is the only place to change
  // them and nothing else needs touching. Text colour is not stored: it is
  // computed from the background so any colour you drop in stays readable.
  // ───────────────────────────────────────────────────────────────────────────
  var VENDOR_PILL = {
    'fb/tr':   { tag: 'META',    colour: '#0866ff' },  // Meta blue
    'rp.gif':  { tag: 'REDDIT',  colour: '#ff4500' },  // Reddit orange-red
    'ga4':     { tag: 'GA4',     colour: '#f9ab00' },  // Google Analytics amber
    'ga/ua':   { tag: 'UA',      colour: '#a65200' },  // darker: legacy
    'gads':    { tag: 'GADS',    colour: '#4285f4' },  // Google blue
    'uet':     { tag: 'UET',     colour: '#008373' },  // Bing teal
    'clarity': { tag: 'CLARITY', colour: '#9c27b0' },  // approximate
    'awin':    { tag: 'AWIN',    colour: '#d81b60' },  // approximate
    // Brown, and not a brand value — I do not know PromptWatch's. Picked because
    // it is the one family nothing else here occupies, which is the only job a
    // pill colour has to do.
    'promptwatch': { tag: 'PWATCH', colour: '#795548' },
    // Grey on purpose: GTM's ping measures nothing, it only proves GTM is here.
    // A brand colour would give it the same visual weight as a real marketing
    // hit, which is the wrong signal.
    'gtm':     { tag: 'GTM',     colour: '#5f6368' }
  };
  // What the on-screen pill calls itself.
  var PILL_NAME = 'TAGS';
  var PILL_VENDOR_FALLBACK = '#ec407a';  // a vendor endpoint with no entry above
  var PILL_BEACON  = '#26c6da';          // Tealium collect
  var PILL_VISITOR = '#4527a0';          // Tealium visitor service
  // utag calls are the site's own intent and the reference every beacon is
  // compared against, so they get a colour family no vendor uses (green) AND a
  // ring, which is what makes them findable while scrolling past a wall of
  // vendor pills.
  var PILL_VIEW      = '#1b7f3b';
  var PILL_LINK      = '#5f9e26';
  var PILL_RECOVERED = '#616161';
  // ───────────────────────────────────────────────────────────────────────────
  // DISCOVERY — the vendors that are NOT in the list above.
  //
  // Everything up to here can only find hits somebody already knew to look for.
  // The interesting failure of a tag audit is the opposite one: a pixel nobody
  // remembers adding, or one a vendor's own library loads behind your back. So
  // every request that does NOT match a known endpoint gets a second look.
  //
  // Two rules keep this from ruining the tool.
  //
  // FIRST: discovery is a SURVEY, not a capture. A property page makes a few
  // hundred requests; recorded as normal rows they would blow past MAX_ROWS and
  // MAX_BYTES within two page views and evict the real captures — the feature
  // would destroy the thing it is meant to support. So discoveries go to their
  // own store, with their own budget, deduplicated by host + path SHAPE rather
  // than per hit: one line per endpoint, with a count. Read it, and when
  // something turns out to matter, promote it to a NET_ENDPOINTS entry above and
  // it gets the full treatment.
  //
  // SECOND: attribution beats pattern-matching. Guessing "does this look like
  // tracking" from the URL alone can only ever recognise shapes I thought of,
  // which is precisely the problem being solved. The stack knows better: the
  // script that made the request is on it. So DISC_TEALIUM identifies utag's own
  // code, every script utag loads is remembered (transitively — a library loaded
  // BY a Tealium-loaded library still counts), and each request is labelled with
  // who actually fired it. A pixel Tealium did not fire is still worth seeing,
  // and knowing that it wasn't Tealium is itself the finding.
  // ───────────────────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────
  // CONTAINERS — which tag manager fired this.
  //
  // A site running two tag managers is the normal case, not the exception, and
  // it is where the expensive mistakes live: the same conversion counted twice
  // because Tealium and a Google tag both send it, or two containers reporting
  // different consent for the same user. Neither shows up as an error anywhere.
  //
  // Identified by the URL of the script on the stack. Every script a container
  // loads inherits its owner, transitively, so a vendor library loaded by GTM is
  // still attributed to GTM three hops later.
  //
  // `short` and `colour` are what the inline fired-by label on the collapsed
  // console line uses. Tealium takes the collect cyan it already owns in the
  // legend and GTM stays in its grey family, so a hit fired by a container reads
  // in the SAME colour wherever that container appears — which is the whole
  // point of showing it inline: a META pixel labelled in GTM grey is visible
  // while scrolling, without expanding anything.
  //
  // These are TEXT colours, so they run a shade lighter than the filled pills
  // would: #5f6368 is fine inside a coloured box and mud as bare glyphs on a
  // dark console.
  // ───────────────────────────────────────────────────────────────────────────
  var CONTAINERS = [
    { id: 'tealium', name: 'Tealium', short: 'Tealium', colour: '#26c6da',
      test: /(^|\.)tiqcdn\.com\/|\/utag(\.js|\.sync\.js|\/)/i },
    // gtm.js is a GTM container; gtag/js and gtag/destination are the Google tag.
    // Both are Google-managed and neither is Tealium, which is the distinction
    // that matters here, so they share one id.
    { id: 'gtm', name: 'Google Tag Manager / gtag', short: 'GTM', colour: '#9aa0a6',
      test: /(^|\.)googletagmanager\.com\/(gtm\.js|gtag\/|a(\?|$))|\/gtag\/js/i },
    { id: 'adobe', name: 'Adobe Launch / DTM', short: 'Adobe', colour: '#fa0f00',
      test: /(^|\.)assets\.adobedtm\.com\/|\/(launch|satelliteLib)-[A-Za-z0-9]+(\.min)?\.js/i },
    { id: 'commandersact', name: 'Commanders Act', short: 'CmdrsAct', colour: '#9575cd',
      test: /(^|\.)tagcommander\.com\/|\/tc_[A-Za-z0-9_]+\.js/i },
    { id: 'segment', name: 'Segment', short: 'Segment', colour: '#52bd94',
      test: /(^|\.)cdn\.segment\.(com|io)\/analytics/i }
  ];
  function containerById(id) {
    for (var i = 0; i < CONTAINERS.length; i++) if (CONTAINERS[i].id === id) return CONTAINERS[i];
    return null;
  }
  function containerOfUrl(u) {
    for (var i = 0; i < CONTAINERS.length; i++) if (CONTAINERS[i].test.test(u)) return CONTAINERS[i].id;
    return '';
  }
  // Kept as its own name because discovery's wording ('tealium:direct') and the
  // tests that pin it both read as Tealium-specific. It is just the Tealium
  // entry of CONTAINERS.
  var DISC_TEALIUM = CONTAINERS[0].test;
  // ───────────────────────────────────────────────────────────────────────────
  // Some vendors say who fired them, in the payload. That is independent of the
  // stack, so when the two agree the attribution is beyond doubt — and when they
  // DISAGREE that is worth surfacing rather than silently preferring one.
  //
  // Only parameters whose value names a tag manager are used. Google's 'gtm='
  // is deliberately absent: it is the gtag library version and is present
  // whenever gtag.js is loaded, including when Tealium is the thing that loaded
  // it, so it proves nothing about which container fired the hit. 'scrsrc' does.
  // ───────────────────────────────────────────────────────────────────────────
  var CONTAINER_DECLARED = [
    // Meta writes its integration agent here: tmtealium, plgtagmanager, …
    { param: 'a',       tealium: /tealium/i,      gtm: /gtagmanager|googletagmanager|^gtm/i },
    // Reddit names the reporting partner.
    { param: 'partner', tealium: /^tealium$/i,    gtm: /^google/i },
    // UET's tag-source marker, e.g. gtm002.
    { param: 'tm',      tealium: /tealium/i,      gtm: /^gtm/i },
    // Google's own: the host of the script that sent the hit.
    { param: 'scrsrc',  tealium: /tiqcdn/i,       gtm: /googletagmanager|googlesyndication/i }
  ];
  // Never a tracking hit whatever the query string says: a library with a
  // cache-busting ?v= is still a library.
  var DISC_ASSET = /\.(js|mjs|cjs|css|less|scss|woff2?|ttf|otf|eot|map|wasm|mp4|webm|ogv|ogg|mp3|wav|flac|pdf|zip|gz|ico|svg|txt|xml|webmanifest)(\?|#|$)/i;
  // Content images. A .gif with a query string is treated as pixel-shaped
  // because nothing serves resized content GIFs any more; the others need a
  // reason beyond their extension, which is what keeps image CDNs out of the
  // registry (/photo.jpg?w=400 is a resize, not a beacon).
  var DISC_IMAGE = /\.(png|jpe?g|webp|avif|bmp)(\?|#|$)/i;
  var DISC_GIF   = /\.gif(\?|#|$)/i;
  // Path words that mean 'this endpoint exists to be told things'. Deliberately
  // conservative: 'tag' and 'api' are omitted because they match half the web.
  var DISC_PATH_HINT = new RegExp('(^|[\\/._-])(' + [
    'pixel', 'pxl', 'track(ing)?', 'collect', 'beacon', 'events?', 'analytics',
    'telemetry', 'impressions?', 'conv(ersion)?', 'measure', 'idsync',
    'usersync', 'cksync', 'match(ing)?', 'hit', 'rum', 'metrics', 'activity',
    'audience', 'retarget(ing)?', 'tr', 'v\\d/t'
  ].join('|') + ')([\\/._-]|\\d|$)', 'i');
  // Parameter NAMES that carry an identity. One of these on a third-party
  // request is a strong tell even when the path says nothing.
  var DISC_ID_PARAM = /^(uid|cid|sid|vid|did|pid|tid|uuid|guid|aid|user_?id|client_?id|session_?id|visitor_?id|device_?id|_ga|_fbp|fbp|idfa|aaid|adid|gclid|msclkid|dclid|ttclid|li_fat_id|external_id)$/i;
  // Parameter NAMES that habitually carry the page or referrer URL. Handing the
  // server the address of the page you are on has exactly one purpose.
  var DISC_URL_PARAM = /^(dl|dr|du|url|u|page|page_?url|loc|location|href|ref|referr?er|r|d|src_?url|document_?location)$/i;
  var DISC_KEY       = '__tealium_cap_disc';
  var DISC_MAX       = 300;      // endpoints remembered, least-recently-seen evicted
  var DISC_MAX_PARAMS = 40;      // parameter names kept per endpoint
  var DISC_FLUSH_MS  = 400;      // registry writes are debounced, see discFlush()
  // Second-level public suffixes, so rentaroof.co.uk is one site and not two.
  var DISC_TWO_LEVEL = /\.(co|com|org|net|ac|gov|edu|sch|ltd|plc|me|in|or|ne)\.[a-z]{2,3}$/i;
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
  var PILLS_KEY   = '__tealium_cap_pills';
  var LABELS_KEY  = '__tealium_cap_labels';
  var GROUPS_KEY  = '__tealium_cap_groups';   // which Fields groups are folded shut
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
    { v: '5.5', keys: ['event', 'reddit_pixel_event_id_*', 'fb_event_id_*'] },
    // 5.6 catalogues six more vendor pixels. Every key below was previously
    // either absent or shown as uncatalogued, so an existing install has no
    // opinion on any of them and ticking them takes nothing away.
    { v: '5.6', keys: [
      'cp._fbc', 'cp._gcl_aw', 'cp._gcl_dc', 'cp._awin_awc', 'cp.awc',
      'cp._clck', 'cp._clsk',
      'fb_wire:id', 'fb_wire:ev', 'fb_wire:eid', 'fb_wire:cd[*', 'fb_wire:ud[*',
      'fb_wire:fbp', 'fb_wire:fbc',
      'awin_wire:tt', 'awin_wire:merchant', 'awin_wire:amount', 'awin_wire:cr',
      'awin_wire:ref', 'awin_wire:parts', 'awin_wire:ch', 'awin_wire:vc',
      'awin_wire:testmode', 'awin_wire:cks',
      'uet_wire:ti', 'uet_wire:evt', 'uet_wire:ea', 'uet_wire:ec', 'uet_wire:el',
      'uet_wire:gv', 'uet_wire:gc', 'uet_wire:asc',
      'clarity_wire:e',
      'gads_wire:label', 'gads_wire:value', 'gads_wire:currency_code',
      'gads_wire:oid', 'gads_wire:data', 'gads_wire:gcs', 'gads_wire:gcd',
      'gads_wire:npa', 'gads_wire:auid',
      'ga4_wire:en', 'ga4_wire:tid', 'ga4_wire:cid', 'ga4_wire:sid',
      'ga4_wire:cu', 'ga4_wire:gcs', 'ga4_wire:gcd', 'ga4_wire:npa',
      'ga4_wire:ep.*', 'ga4_wire:epn.*', 'ga4_wire:up.*', 'ga4_wire:pr*',
      'ua_wire:t', 'ua_wire:tid', 'ua_wire:ec', 'ua_wire:ea', 'ua_wire:el'
    ] },
    // 5.9 catalogues what live captures showed sitting in the Uncatalogued block.
    // Every key here was already visible there, so ticking it changes nothing
    // about what you see — only about whether it arrives with a name.
    { v: '5.9', keys: [
      'fb_wire:a', 'fb_wire:cdl', 'fb_wire:ler', 'fb_wire:plt', 'fb_wire:tz',
      'fb_wire:aems', 'fb_wire:iw', 'fb_wire:o', 'fb_wire:tm',
      'gads_wire:en', 'gads_wire:is_vtc', 'gads_wire:pscdl', 'gads_wire:hn',
      'gads_wire:bg', 'gads_wire:cid', 'gads_wire:ipr', 'gads_wire:rmt_tld',
      'gads_wire:guid', 'gads_wire:async', 'gads_wire:fmt', 'gads_wire:rfmt',
      'gads_wire:ept', 'gads_wire:rcb', 'gads_wire:_tu', 'gads_wire:tcfd',
      'ga4_wire:tfd', 'ga4_wire:gaf', 'ga4_wire:rcb', 'ga4_wire:_tu', 'ga4_wire:tcfd',
      'uet_wire:tcf', 'uet_wire:lg', 'uet_wire:rn', 'uet_wire:bo', 'uet_wire:tm',
      'uet_wire:cdb', 'uet_wire:src', 'uet_wire:vids', 'uet_wire:pi',
      'uet_wire:sc', 'uet_wire:sv',
      'rdt_wire:category', 'rdt_wire:name',
      'tci.event_id'
    ] },
    // 6.0 adds the Google tag's current endpoints and GTM's diagnostics ping.
    // Nothing here was ever captured before — these endpoints were not matched at
    // all — so there is no visibility to preserve and the ticks are chosen for
    // usefulness rather than for continuity.
    { v: '6.0', keys: [
      'gads_wire:tid', 'gads_wire:dl', 'gads_wire:dr', 'gads_wire:dt',
      'gads_wire:scrsrc', 'gads_wire:tfd', 'gads_wire:ep.*', 'gads_wire:rnd',
      'gads_wire:apvc', 'gads_wire:ae', 'gads_wire:navt', 'gads_wire:tft',
      'gads_wire:tids', 'gads_wire:gcu', 'gads_wire:gcp', 'gads_wire:gap.fsrc',
      'gtm_wire:id', 'gtm_wire:e', 'gtm_wire:gtm', 'gtm_wire:cv', 'gtm_wire:rv',
      'gtm_wire:tc', 'gtm_wire:t', 'gtm_wire:pid', 'gtm_wire:es', 'gtm_wire:eid',
      'gtm_wire:tr', 'gtm_wire:ti', 'gtm_wire:ut', 'gtm_wire:v',
      'gads_wire:url', 'gads_wire:ref', 'gads_wire:tiba', 'gads_wire:dma',
      'gads_wire:dma_cps', 'gads_wire:gclaw', 'gads_wire:gad_source',
      'gads_wire:ct_cookie_present',
      'ga4_wire:dl', 'ga4_wire:dr', 'ga4_wire:dt', 'ga4_wire:dma', 'ga4_wire:dma_cps',
      'fb_wire:dl', 'fb_wire:rl',
      'uet_wire:p', 'uet_wire:r', 'uet_wire:tl'
    ] }
  ];
  // 6.3 stops hiding most of every vendor payload. Derived from the catalogue so
  // it cannot fall behind it again; re-ticks anything a previous version left
  // catalogued but invisible.
  MIGRATIONS.push({ v: '6.3', keys: wireDefaults() });
  // 7.5 promotes two endpoints the discovery survey turned up on live traffic:
  // PromptWatch's ingest, and GTM's /td ping alongside the /a one already
  // matched. Neither was ever captured, so nothing an install can have an
  // opinion about is being changed — listed key by key rather than re-deriving
  // wireDefaults(), which would also re-tick vendor parameters someone has since
  // deliberately turned off.
  MIGRATIONS.push({ v: '7.5', keys: [
    'pw_wire:project_id', 'pw_wire:action', 'pw_wire:version',
    'pw_wire:payload.href', 'pw_wire:payload.referrer',
    'pw_wire:payload.locale', 'pw_wire:payload.timezone',
    'gtm_wire:seq', 'gtm_wire:exp', 'gtm_wire:dl', 'gtm_wire:tdp',
    'gtm_wire:frm', 'gtm_wire:rtg', 'gtm_wire:slo', 'gtm_wire:hlo',
    'gtm_wire:lst', 'gtm_wire:bt', 'gtm_wire:ct', 'gtm_wire:jsp', 'gtm_wire:pcid'
  ] });
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
  // 'disc' is absent from an existing install's saved object, and undefined is
  // not false, so discovery arrives switched on without a migration.
  function sources() {
    var s = ls(SOURCES_KEY, null);
    if (!s || typeof s !== 'object') { s = { udo: true, net: true, disc: true }; lsSet(SOURCES_KEY, s); }
    return s;
  }
  function setSource(k, on) { var s = sources(); s[k] = !!on; lsSet(SOURCES_KEY, s); }
  // ───────────────────────────────────────────────────────────────────────────
  // PILL MUTING — the legend chips are switches, one per row type.
  //
  // Same contract as the Sources switches above, because two controls that look
  // alike must behave alike: muting PAUSES capture as well as hiding. A muted
  // vendor stops eating the row budget, and rows captured while it was on come
  // back when you unmute it. Stored as the muted list rather than the enabled
  // one, so a vendor added in a later version arrives switched on.
  // ───────────────────────────────────────────────────────────────────────────
  // Explanations ride in a third column, on by default: knowing what a
  // parameter MEANS is most of the value of reading one, and a console cannot
  // show it any other way — %c takes a restricted CSS subset with no HTML, no
  // title attribute and no pseudo elements, so there is nowhere to hang a
  // tooltip. Every label is written to fit COL_LABEL so the column never
  // truncates in practice; __capLabels(false) drops it for a compact two-column
  // view, and __capExplain() prints the same text as a lookup table.
  function labelsInline() { return ls(LABELS_KEY, true) !== false; }
  function setLabelsInline(on) { lsSet(LABELS_KEY, !!on); }
  function mutedPills() {
    var a = ls(PILLS_KEY, []);
    return Array.isArray(a) ? a : [];
  }
  function pillOn(key) { return !key || mutedPills().indexOf(key) < 0; }
  // Fields groups fold. The default is what the group is FOR: the unscoped
  // groups are the UDO attributes you tick by hand and they open; the scoped
  // wire groups are a vendor's whole payload — 52 parameters for GA4 alone,
  // ticked by subtraction and rarely touched — and they start folded, or the
  // picker opens on a thousand-pixel scroll of things nobody was looking for.
  function foldedGroups() {
    var m = ls(GROUPS_KEY, null);
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  }
  function groupFolded(g) {
    var v = foldedGroups()[g.name];
    return v == null ? !!g.scope : !!v;
  }
  function setGroupFolded(g, folded) {
    var m = foldedGroups();
    m[g.name] = !!folded;
    lsSet(GROUPS_KEY, m);
  }
  function setPillMuted(key, muted) {
    var a = mutedPills(), i = a.indexOf(key);
    if (muted && i < 0) a.push(key);
    if (!muted && i >= 0) a.splice(i, 1);
    lsSet(PILLS_KEY, a);
  }
  // The switch a row answers to. Vendors are keyed by endpoint id so the key is
  // the same one VENDOR_PILL uses; utag calls collapse to view/link because that
  // is what the legend offers, and a custom utag event is an interaction.
  function pillKey(row) {
    if (!row) return '';
    if (kindOf(row) === 'net') {
      if (row._type === 'visitor') return 'visitor';
      if (row._type === 'pixel') return (row._net && row._net.endpoint) || 'pixel';
      return 'beacon';
    }
    return row._type === 'view' ? 'view' : 'link';
  }
  // Rows captured by v4.x carry no _kind, and every one of them is a utag event.
  function kindOf(r) { return r && r._kind === 'net' ? 'net' : 'udo'; }
  function sourceOn(kind) {
    if (kind === 'disc') return sources().disc !== false;
    return sources()[kind === 'net' ? 'net' : 'udo'] !== false;
  }
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
  // Where the explanations live now that they are not on every row: a reference
  // you consult once, rather than a column you read past forty times a hit.
  // Returns the groups matching a name/id fragment, or every scoped group.
  function explainGroups(which) {
    var all = groups().filter(function (g) { return !!g.scope; });
    if (!which) return all;
    var q = String(which).toLowerCase();
    var hit = all.filter(function (g) {
      return (g.id && g.id.toLowerCase().indexOf(q) >= 0) ||
             g.name.toLowerCase().indexOf(q) >= 0 ||
             (g.scope.endpoint || []).some(function (e) { return e.toLowerCase().indexOf(q) >= 0; });
    });
    return hit;
  }
  // A migration is recorded as done ONLY once its keys are verifiably in the
  // stored list. lsSet swallows write failures — a full quota is entirely
  // possible here, since the capture store is allowed to reach MAX_BYTES — and
  // the previous version marked the release done regardless. That turned one
  // failed write into a permanent state: the ticks never applied, the version
  // was recorded, and it was never retried. The symptom was a vendor row
  // printing a single parameter out of thirty with no indication why.
  function runMigrations() {
    try {
      var done = ls(MIGRATED_KEY, []);
      var changed = false;
      MIGRATIONS.forEach(function (m) {
        if (done.indexOf(m.v) >= 0) return;
        setEnabledMany(m.keys, true);
        var now = {};
        (ls(FIELDS_KEY, []) || []).forEach(function (k) { now[k] = true; });
        var stuck = m.keys.every(function (k) { return now[k]; });
        if (!stuck) {
          console.log('%c[CAP] could not save field defaults for ' + m.v +
            '%c  storage may be full — run __capClear() then reload',
            'background:#e53935;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold',
            'color:#999');
          return;                       // not done: retried on the next load
        }
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
  function setEnabled(k, on) { setEnabledMany([k], on); }
  // One read and one write for the whole list. Doing it per key meant a
  // migration ticking 229 keys performed 229 parse/stringify/write cycles
  // against localStorage — slow, and 229 separate chances to hit the quota.
  function setEnabledMany(keys, on) {
    var arr = ls(FIELDS_KEY, DEFAULT_ON.slice());
    var idx = {};
    arr.forEach(function (k) { idx[k] = true; });
    keys.forEach(function (k) {
      if (on && !idx[k]) { arr.push(k); idx[k] = true; }
      else if (!on && idx[k]) { delete idx[k]; }
    });
    if (!on) arr = arr.filter(function (k) { return idx[k]; });
    lsSet(FIELDS_KEY, arr);
    return arr;
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
    var extra = {}, n = 0, empty = [];
    Object.keys(d).forEach(function (k) {
      if (isBlocked(k)) return;
      var v = d[k];
      // A parameter sent with no value still went over the wire and still counts
      // towards the total, so it cannot simply vanish — that is what made a row
      // read "30 parameters" while showing 17. It carries nothing worth a line of
      // its own, so the NAMES are kept and reported together.
      if (v === undefined || v === null || v === '') { empty.push(k); return; }
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
    if (empty.length) {
      row._empty_n = empty.length;
      row._empty = empty.slice(0, 40);
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
  // Column widths for the payload table. VALUE is a ceiling, not a fixed size:
  // a group whose values are all short stays narrow, and only a group with a
  // genuinely long value pays for it. 58 clears every real value I have seen on
  // the wire — the longest, Google's uafvl client-hint list, is 58 characters —
  // so in practice nothing is cut. Anything longer is clipped for display ONLY;
  // exports always carry the full value.
  var COL_VALUE = 58;
  var COL_LABEL = 48;
  // Pad to width, or cut with an ellipsis when too long.
  function fit(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : pad(s, n);
  }
  // Same, without the padding — for a final column, where trailing spaces would
  // just be invisible noise in a copied line.
  function clip(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  // ── Pill styling ───────────────────────────────────────────────────────────
  function hexRgb(h) {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // Text colour is derived, never configured, so a brand colour can be dropped
  // into VENDOR_PILL without also having to work out whether it needs white or
  // black text. WCAG relative luminance; the threshold is tuned by eye for pill
  // sizes rather than for body text.
  function textOn(hex) {
    var c = hexRgb(hex).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) > 0.42 ? '#111' : '#fff';
  }
  // Mixed toward white rather than a fixed light grey, so the ring always reads
  // as the same hue as the pill it surrounds.
  function lighten(hex, f) {
    var c = hexRgb(hex).map(function (v) { return Math.round(v + (255 - v) * f); });
    return 'rgb(' + c.join(',') + ')';
  }
  function pillCss(colour, ring) {
    return 'background:' + colour + ';color:' + textOn(colour) +
           ';padding:1px 6px;border-radius:3px;font-weight:bold' +
           (ring ? ';border:2px solid ' + lighten(colour, 0.55) + ';letter-spacing:.4px' : '');
  }
  // A vendor pill carries the vendor's brand colour and its name; Tealium's own
  // traffic keeps cyan (collect) and indigo (visitor lookup); utag calls get
  // green plus a ring — see VENDOR_PILL for why.
  function pillFor(row) {
    var key = pillKey(row);
    if (row._kind === 'net') {
      if (row._type === 'visitor') return { colour: PILL_VISITOR, tag: 'VISITOR', ring: false, key: key };
      if (row._type === 'pixel') {
        var v = VENDOR_PILL[row._net && row._net.endpoint];
        return { colour: (v && v.colour) || PILL_VENDOR_FALLBACK,
                 tag: (v && v.tag) || 'PIXEL', ring: false, key: key };
      }
      return { colour: PILL_BEACON, tag: 'BEACON', ring: false, key: key };
    }
    return {
      colour: row._via === 'recovered' ? PILL_RECOVERED
            : row._type === 'view' ? PILL_VIEW : PILL_LINK,
      tag: row._type.toUpperCase(),
      ring: true,
      key: key
    };
  }
  // ── The inline fired-by chip ───────────────────────────────────────────────
  // Attribution used to live inside the collapsed group, which meant the one
  // question worth asking of a wall of rows — WHO fired this — could only be
  // answered one expand at a time. It rides the headline instead, immediately
  // after the vendor pill so the two colours sit side by side: on a healthy
  // Tealium site every chip is the same cyan, and the GTM-grey one halfway down
  // is the double-count you were looking for.
  //
  // Returns null when there is nothing worth a chip, so unattributed rows (every
  // PerformanceObserver replay) stay quiet rather than printing a wall of
  // identical greys that would drown the signal.
  // Two filled pills side by side read as two labels of equal weight, and the
  // row only has one identity — the vendor. So the container is coloured TEXT,
  // bold, carrying the same hue its pill would have. Same signal, a quarter of
  // the ink, and the vendor pill stays the loudest thing on the line.
  //
  // Colours are picked for text on a console background rather than for a filled
  // chip: GTM's own #5f6368 and a slate #546e7a are legible inside a coloured box
  // and nearly invisible as bare glyphs on dark.
  var CHIP_PAGE     = '#90a4ae';  // fired by the page's own code, no container
  var CHIP_CONFLICT = '#ff5252';  // stack and payload name different containers
  function firedByChip(nn) {
    if (!nn || !nn.fired_by) return null;
    if (nn.fired_by_conflict) {
      var stack = containerShort(nn.fired_by_id) || nn.fired_by;
      var said  = containerShort(nn.fired_by_declared);
      return { text: '⚠ ' + stack + (said ? ' ≠ ' + said : ''), colour: CHIP_CONFLICT };
    }
    if (nn.fired_by_id) {
      var c = containerById(nn.fired_by_id);
      return { text: (c && c.short) || nn.fired_by,
               colour: (c && c.colour) || CHIP_PAGE,
               // No stack, so the container is whatever the payload named. Real
               // evidence, but weaker than a live stack, and the chip should not
               // claim more than it knows.
               faint: nn.fired_by_how === 'unknown' };
    }
    if (nn.fired_by_how === 'page') return { text: 'page', colour: CHIP_PAGE };
    return null;
  }
  function containerShort(id) {
    var c = containerById(id);
    return c ? c.short : '';
  }
  function chipCss(colour, faint) {
    return 'color:' + colour + ';font-weight:bold' + (faint ? ';opacity:.7' : '');
  }
  // The legend, and the switch list — one array so a vendor added to
  // VENDOR_PILL becomes a working switch without being registered anywhere else.
  function legendPills() {
    var out = [
      { key: 'view',    tag: 'VIEW',    colour: PILL_VIEW,    ring: true,  note: 'utag.view calls' },
      { key: 'link',    tag: 'LINK',    colour: PILL_LINK,    ring: true,  note: 'utag.link / track calls' },
      { key: 'beacon',  tag: 'BEACON',  colour: PILL_BEACON,  ring: false, note: 'Tealium collect beacons' },
      { key: 'visitor', tag: 'VISITOR', colour: PILL_VISITOR, ring: false, note: 'Tealium visitor-service lookups' }
    ];
    Object.keys(VENDOR_PILL).forEach(function (ep) {
      var v = VENDOR_PILL[ep];
      out.push({ key: ep, tag: v.tag, colour: v.colour, ring: false, note: ep + ' pixels' });
    });
    return out;
  }
  function print(row) {
    var on = enabledSet();
    var isOn = displayMatcher(row);
    var pill = pillFor(row);
    var colour = pill.colour;
    var label = row._kind === 'net'
      ? (row._net.endpoint + (row._net.event ? '  ' + row._net.event : '') +
         (row._net.batch ? '  [' + row._net.batch.index + '/' + row._net.batch.of + ']' : ''))
      : ((on['interaction_id'] && row.data.interaction_id) ||
         (on['page_category'] && row.data.page_category) || row._type);
    // The headline is assembled rather than templated because the fired-by chip
    // is optional, and console.log's %c substitutions are positional: a format
    // string with a placeholder and no argument prints the literal '%c'.
    var fmt = '%c' + pill.tag + '%c', args = [pillCss(colour, pill.ring), ''];
    var chip = row._kind === 'net' ? firedByChip(row._net) : null;
    if (chip) {
      fmt += '  %c' + chip.text + '%c';
      args.push(chipCss(chip.colour, chip.faint), '');
    }
    fmt += '  %c' + label + '  %c' + row._path;
    args.push('font-weight:bold', 'color:#999;font-weight:normal');
    console.groupCollapsed.apply(console, [fmt].concat(args));
    if (row._kind === 'net' && row._net) {
      var nn = row._net, nl = [];
      var nline = function (k, v) {
        if (v === '' || v == null) return;
        nl.push('  ' + pad(k, 11) + '  ' + v);
      };
      nline('request', String(nn.method || 'GET').toUpperCase() + ' ' + nn.host + nn.req_path);
      // Directly under 'request', because on a site running two tag managers
      // this is the first thing you want to know about a hit.
      if (nn.fired_by) {
        nline('fired by', nn.fired_by +
          (nn.fired_by_how === 'tealium:via' || nn.fired_by_how === 'gtm:via'
            ? '  ·  via ' + nn.fired_by_script : '') +
          (nn.fired_by_conflict ? '  ·  ⚠ ' + nn.fired_by_conflict
                                : nn.fired_by_basis ? '  ·  ' + nn.fired_by_basis : ''));
      }
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
      // Three columns: NAME, VALUE, then the explanation.
      //
      // The name is never shortened — it is the string you paste into Tealium or
      // search the Network tab for, so the column simply widens to fit the
      // longest one present. The explanation is the only part that may be cut,
      // because losing the tail of "Consent Mode signal — G1 plus the …" costs
      // nothing, while losing a value or a key costs the thing you came for.
      //
      // Value before explanation is deliberate. Previously the label came first
      // and the column was as wide as the longest label in the group, so one
      // wordy entry pushed every value far enough right to wrap — the values,
      // which are the actual payload, were the part that got hurt.
      var vals = present.map(function (k) { return String(fmtValue(row.data[k])); });
      var keyW = Math.max.apply(null, present.map(function (k) { return k.length; }));
      var valW = Math.min(COL_VALUE, Math.max.apply(null, vals.map(function (v) { return v.length; })));
      var anyLabel = labelsInline() && present.some(function (k) { return !!labelFor(g, k); });
      console.log(
        '%c' + g.name + '\n%c' + present.map(function (k, i) {
          var line = '  ' + pad(k, keyW) + '  ' + (anyLabel ? fit(vals[i], valW) : vals[i]);
          if (anyLabel) line += '  ' + clip(labelFor(g, k), COL_LABEL);
          return line.replace(/\s+$/, '');
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
    // Captured, catalogued, but not ticked — the one state that used to be
    // invisible. Uncatalogued values announce themselves in the block below;
    // unticked ones simply vanished, so a row could print one parameter out of
    // thirty and still look complete. If the row is holding data back, it says so.
    var heldN = 0;
    (function () {
      var held = Object.keys(row.data).filter(function (k) { return !isOn(k); });
      heldN = held.length;
      if (!held.length) return;
      console.log('%c' + held.length + ' more captured, not ticked%c\n  ' +
        held.slice(0, 14).join(', ') + (held.length > 14 ? ', …' : '') +
        '\n  Search for them in Fields, or use its "restore defaults" link.',
        'color:#8d6e63;font-weight:bold', 'color:#777;font-family:monospace');
    })();
    if (row._empty_n) {
      console.log('%c' + row._empty_n + ' sent empty%c\n  ' + row._empty.join(', ') +
        (row._empty_n > row._empty.length ? ', …' : ''),
        'color:#616161;font-weight:bold', 'color:#666;font-family:monospace');
    }
    if (row._extra) {
      var isRaw = !Array.isArray(row._extra);
      console.log(
        '%cUncatalogued (' + row._uncat + ')\n%c' + (isRaw
          ? (function () {
              var ks = Object.keys(row._extra);
              var w = Math.max.apply(null, ks.map(function (k) { return k.length; }));
              return ks.map(function (k) {
                return '  ' + pad(k, w) + '  ' + fmtValue(row._extra[k]);
              }).join('\n');
            })()
          : '  ' + row._extra.join(', ') + '  …names only, payload too large'),
        'color:#ffa726;font-weight:bold',
        'color:inherit;font-family:monospace'
      );
    }
    // The footer reconciles the row: total, then where each parameter went.
    // Without the breakdown a reader has to assume the difference between the
    // total and the visible lines is a bug — which is exactly how the empty ones
    // were found. "on the wire" is dropped when an envelope was unwrapped, since
    // the expanded count is by definition not what travelled.
    var shownN = Object.keys(shown).length;
    var parts = [shownN + ' shown'];
    if (row._empty_n) parts.push(row._empty_n + ' empty');
    if (heldN) parts.push(heldN + ' not ticked');
    if (row._uncat) parts.push(row._uncat + ' uncatalogued');
    console.log(
      '%c' + row._time + '  ·  via ' + row._via + '  ·  ' + row._fields +
      (row._kind === 'net'
        ? (row._net && row._net.wire_params ? ' parameters' : ' parameters on the wire')
        : ' fields in payload') +
      '  ·  ' + parts.join('  ·  '),
      'color:#999;font-style:italic'
    );
    console.groupEnd();
  }
  // The single choke point for the source switches: a paused source is not
  // stored and not printed, so pausing beacons really does stop them consuming
  // the 500-row budget rather than just hiding them.
  function push(row) {
    if (!sourceOn(kindOf(row))) return false;
    if (!pillOn(pillKey(row))) return false;      // muted: not recorded, see mutedPills()
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
  // ───────────────────────────────────────────────────────────────────────────
  // PROVENANCE — which script made this request.
  //
  // The stack is read by throwing and catching, which is the only portable way
  // to get one. Frames from this userscript are not http(s) URLs (the managers
  // use extension: and blob: schemes), so the URL regex skips them for free.
  //
  // An async hop does NOT lose the attribution: the frame still names the file
  // the callback was defined in, and it is the SCRIPT that identifies a vendor,
  // not the moment it chose to fire.
  // ───────────────────────────────────────────────────────────────────────────
  // Chrome writes '    at fn (URL:line:col)', Safari and Firefox write
  // 'fn@URL:line:col'. Grabbing the whole URL-ish token and stripping the
  // trailing :line:col handles all three — and, unlike matching up to the first
  // ':digits', it survives a URL that carries a port.
  var stackScriptRe = /https?:\/\/[^\s()'"]+/g;
  function stackScripts() {
    var s = '';
    try { throw new Error(); } catch (e) { s = (e && e.stack) || ''; }
    if (!s) return [];
    var out = [], m;
    stackScriptRe.lastIndex = 0;
    while ((m = stackScriptRe.exec(s))) {
      var u = m[0].replace(/:\d+(?::\d+)?$/, '');
      if (u && out.indexOf(u) < 0) out.push(u);
      if (out.length > 24) break;          // deep stacks tell us nothing extra
    }
    return out;
  }
  // Script URL -> the id of the container that loaded it, inherited down the
  // load chain. Held in memory only: it describes THIS page, and a stale entry
  // from an earlier one would attribute a request to a script that is no longer
  // even loaded.
  var scriptOwner = {};
  function noteScript(src) {
    try {
      var abs = absUrl(src);
      if (!abs || abs.indexOf('http') !== 0) return;
      var own = containerOfUrl(abs);
      if (own) { scriptOwner[abs] = own; return; }
      var frames = stackScripts();
      for (var i = 0; i < frames.length; i++) {
        var c = containerOfUrl(frames[i]) || scriptOwner[frames[i]];
        if (c) { scriptOwner[abs] = c; return; }   // transitive: piggybacked libraries
      }
    } catch (e) {}
  }
  function shortScript(u) {
    try {
      var p = new URL(u, location.href);
      var f = p.pathname.split('/').filter(Boolean).pop() || p.pathname;
      return p.hostname + '/' + f;
    } catch (e) { return String(u || '').slice(0, 80); }
  }
  // '<container>:direct' — that container's own code is on the stack, e.g.
  //                        'tealium:direct', 'gtm:direct'.
  // '<container>:via'    — a script that container loaded is on the stack. This
  //                        is the piggyback case and the one worth hunting.
  // 'page'               — the site's own code, no container involved.
  // 'unknown'            — no usable stack, which is every PerformanceObserver
  //                        replay: those are observed after the fact, not wrapped.
  // ONE pass, nearest frame first, and the nearest match wins whichever kind it
  // is. Scanning for a container's own code across the whole stack before
  // considering the libraries it loaded would be wrong: utag.js sits at the
  // bottom of the stack for anything fired during its initialisation, so a
  // Taboola pixel with [tfa.js, utag.js] on the stack would be reported as
  // Tealium firing it directly. The immediate caller made the request.
  function attributionFor() {
    var frames = stackScripts(), i;
    for (i = 0; i < frames.length; i++) {
      var own = containerOfUrl(frames[i]);
      if (own) return { origin: own + ':direct', container: own, script: frames[i] };
      own = scriptOwner[frames[i]];
      if (own) return { origin: own + ':via', container: own, script: frames[i] };
    }
    // Inside a utag call the stack may be entirely inline page code, but we know
    // where we are: the wrapper set activeUdo before calling through.
    if (activeUdo) return { origin: 'tealium:direct', container: 'tealium', script: '' };
    if (frames.length) return { origin: 'page', container: '', script: frames[0] };
    return { origin: 'unknown', container: '', script: '' };
  }
  // What the PAYLOAD says fired it, independent of the stack. Returns '' when
  // the hit carries no such marker, which is most of them.
  function declaredContainer(d) {
    if (!d) return '';
    for (var i = 0; i < CONTAINER_DECLARED.length; i++) {
      var rule = CONTAINER_DECLARED[i];
      var v = d[rule.param];
      if (Array.isArray(v)) v = v[0];
      if (v === undefined || v === null || v === '') continue;
      v = String(v);
      if (rule.tealium && rule.tealium.test(v)) return 'tealium';
      if (rule.gtm && rule.gtm.test(v)) return 'gtm';
    }
    // A Tealium collect beacon names its own account; nothing else does.
    if (d.tealium_account || d['ut.account']) return 'tealium';
    return '';
  }
  // The two sources combined. 'confirmed' means the stack and the payload agree,
  // which is as certain as this gets. 'conflict' means they do not — reported
  // rather than resolved, because silently preferring one would hide exactly the
  // situation worth knowing about.
  function firedBy(d, endpoint) {
    var att = attributionFor();
    var declared = declaredContainer(d);
    // The GTM diagnostics ping is GTM talking about itself.
    if (!att.container && endpoint === 'gtm') att = { origin: 'gtm:direct', container: 'gtm', script: '' };
    var id = att.container || declared;
    var out = {
      container: id,
      name: id ? (containerById(id) || {}).name || id : (att.origin === 'page' ? 'page code' : 'unknown'),
      how: att.origin,
      script: att.script ? shortScript(att.script) : '',
      declared: declared
    };
    if (id && declared && att.container && declared !== att.container) {
      out.conflict = 'stack says ' + att.container + ', payload says ' + declared;
      out.basis = 'stack and payload DISAGREE';
    } else if (declared && att.container && att.container === declared) {
      out.confirmed = true;
      out.basis = 'stack and payload agree';
    } else if (att.container) {
      out.basis = 'from the call stack';
    } else if (declared) {
      // No usable stack — every PerformanceObserver replay, and any request the
      // wrappers saw without frames. The vendor naming its own source is still
      // good evidence, but it is weaker, and the row should not imply otherwise.
      out.basis = 'named in the payload';
    }
    return out;
  }
  // ───────────────────────────────────────────────────────────────────────────
  // DISCOVERY REGISTRY
  // ───────────────────────────────────────────────────────────────────────────
  function baseDomain(h) {
    h = String(h || '').toLowerCase().replace(/\.$/, '');
    var p = h.split('.');
    if (p.length <= 2) return h;
    return p.slice(DISC_TWO_LEVEL.test(h) ? -3 : -2).join('.');
  }
  function isThirdParty(h) {
    if (!h) return false;
    var mine = baseDomain(location.hostname);
    return !!mine && baseDomain(h) !== mine;
  }
  // /log/1234/trc and /log/5678/trc are one endpoint, not two. Anything that
  // looks like an id is collapsed so the registry lists ENDPOINTS, not hits.
  function pathTemplate(p) {
    return String(p || '/').split('/').map(function (seg) {
      if (!seg) return seg;
      if (/^\d+$/.test(seg)) return '*';
      if (/^[0-9a-f]{8,}$/i.test(seg)) return '*';
      if (/\d{4,}/.test(seg)) return '*';
      if (seg.length > 24) return '*';
      return seg;
    }).join('/');
  }
  // Why this request looks like tracking. Empty means it does not, and nothing
  // is recorded. Returning the REASONS rather than a boolean is deliberate: the
  // registry shows them, so a false positive is diagnosable instead of magic.
  function trackingWhy(abs, path, q, method, body, transport, origin) {
    var why = [];
    if (transport === 'beacon') why.push('sendBeacon');
    if (origin.indexOf('tealium') === 0) why.push('fired by Tealium');
    if ((method || 'GET').toUpperCase() === 'POST' && body) why.push('POST body');
    if (DISC_PATH_HINT.test(path)) why.push('tracking path');
    if (DISC_GIF.test(abs)) why.push('pixel-shaped');
    var names = Object.keys(q || {});
    for (var i = 0; i < names.length; i++) {
      var k = names[i];
      if (DISC_ID_PARAM.test(k)) { why.push('identity parameter'); break; }
    }
    for (var j = 0; j < names.length; j++) {
      var v = q[names[j]];
      v = Array.isArray(v) ? v[0] : v;
      if (typeof v === 'string' && v.length > 12 && /^https?:/i.test(v)) {
        why.push('page URL in query'); break;
      }
      if (DISC_URL_PARAM.test(names[j]) && typeof v === 'string' && v.indexOf(location.hostname) >= 0) {
        why.push('page URL in query'); break;
      }
    }
    return why;
  }
  var discMap = null, discDirty = false, discTimer = null;
  function discAll() {
    if (!discMap) { var m = ls(DISC_KEY, {}); discMap = (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}; }
    return discMap;
  }
  // Debounced: an unknown endpoint hit in a tight loop must not cost a JSON
  // round-trip through localStorage per request.
  function discFlush() {
    if (!discDirty) return;
    discDirty = false;
    try {
      var m = discAll(), keys = Object.keys(m);
      if (keys.length > DISC_MAX) {
        keys.sort(function (a, b) { return (m[a].last_ms || 0) - (m[b].last_ms || 0); })
            .slice(0, keys.length - DISC_MAX)
            .forEach(function (k) { delete m[k]; });
      }
      lsSet(DISC_KEY, m);
    } catch (e) {}
  }
  function discSchedule() {
    discDirty = true;
    if (discTimer) return;
    discTimer = setTimeout(function () { discTimer = null; discFlush(); }, DISC_FLUSH_MS);
  }
  function discConsider(abs, method, body, transport) {
    var host = '', path = abs;
    try { var U = new URL(abs, location.href); host = U.hostname; path = U.pathname; } catch (e) { return; }
    if (!host || !isThirdParty(host)) return;
    if (NET_IGNORE.test(host)) return;
    if (DISC_ASSET.test(abs)) return;
    var q = {};
    try { q = parseQuery((new URL(abs, location.href)).search); } catch (e) {}
    // A POST endpoint carries its parameters in the BODY, so reading only the
    // query string reports it as having none — which is what a live capture of
    // ingest.promptwatch.com/event showed: seven hits, params []. Useless for
    // working out what a vendor is collecting. Body names are merged in here;
    // values are deliberately not, because an unknown endpoint's body is exactly
    // where personal data would be and the registry is not a capture store.
    try {
      (paramsFromBody(body) || []).forEach(function (b) {
        if (b) Object.keys(b).forEach(function (k) { if (!hasOwn(q, k)) q[k] = ''; });
      });
    } catch (e) {}
    var att = attributionFor();
    var why = trackingWhy(abs, path, q, method, body, transport, att.origin);
    // A content image needs a reason beyond being an image; without one it is a
    // photo, not a beacon.
    if (!why.length) return;
    if (DISC_IMAGE.test(abs) && why.length === 1 && why[0] === 'pixel-shaped') return;
    // Deduped only once it is known to be a real candidate. netSeen is a 200-slot
    // window shared with the beacon path, so running every asset request through
    // it would let a burst of images evict a beacon's entry inside the 3s window
    // and log that beacon twice — discovery must not corrupt the capture it sits
    // next to.
    if (netDupe(abs)) return;
    var tmpl = pathTemplate(path);
    var key = host + '|' + tmpl;
    var m = discAll(), e = m[key], now = new Date();
    var first = !e;
    if (first) {
      e = m[key] = {
        host: host, path: tmpl, count: 0,
        first_seen: now.toISOString().slice(11, 23), last_seen: '',
        origin: att.origin, script: att.script ? shortScript(att.script) : '',
        transports: {}, methods: {}, params: [], why: [], pages: [], sample: ''
      };
    }
    e.count++;
    e.last_seen = now.toISOString().slice(11, 23);
    e.last_ms = now.getTime();
    e.transports[transport] = (e.transports[transport] || 0) + 1;
    var mm = (method || 'GET').toUpperCase();
    e.methods[mm] = (e.methods[mm] || 0) + 1;
    if (!e.sample) e.sample = String(abs).slice(0, 500);
    // An endpoint first seen from a vendor library but later fired directly by
    // utag (or the other way round) is worth knowing about, so attribution is
    // upgraded rather than frozen at whatever the first sighting happened to be.
    if (att.origin.indexOf('tealium') === 0 && e.origin.indexOf('tealium') !== 0) {
      e.origin = att.origin;
      e.script = att.script ? shortScript(att.script) : '';
    }
    why.forEach(function (w) { if (e.why.indexOf(w) < 0) e.why.push(w); });
    if (e.pages.indexOf(location.pathname) < 0 && e.pages.length < 5) e.pages.push(location.pathname);
    Object.keys(q).forEach(function (k) {
      if (e.params.length < DISC_MAX_PARAMS && e.params.indexOf(k) < 0) e.params.push(k);
    });
    discSchedule();
    if (first) {
      console.log('%c[CAP] new endpoint%c  ' + host + tmpl + '%c\n' +
        '        ' + (e.origin === 'tealium:direct' ? 'fired by Tealium directly'
                    : e.origin === 'tealium:via'    ? 'fired by ' + e.script + ' (Tealium-loaded)'
                    : e.origin === 'page'           ? 'fired by page code — ' + e.script
                    : 'origin unknown (seen after the fact)') +
        '  ·  ' + why.join(', '),
        'background:#8d6e63;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold',
        'color:#ddd;font-weight:bold', 'color:#999');
    }
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
  // The headline for a vendor pixel. Every vendor names its event parameter
  // differently, so the endpoint declares which one to read. Google Ads is the
  // exception: its conversion id sits in the path (/pagead/conversion/AW-123/…),
  // which is the only identifying thing a remarketing hit has.
  function vendorEvent(info, d) {
    var keys = info.endpoint.eventKey || ['event'];
    for (var i = 0; i < keys.length; i++) {
      var v = d[keys[i]];
      if (v !== undefined && v !== null && v !== '') return asText(v);
    }
    var m = /\/pagead\/(?:1p-)?(?:viewthrough)?(?:conversion|user-list)\/([^\/?]+)/i.exec(info.path || '');
    return m ? m[1] : '';
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
        event: d.tealium_event || (info.endpoint.kind === 'vendor' ? vendorEvent(info, d) : ''),
        bytes_out: info.bytes_out || 0
      },
      data: {}
    };
    // Which tag manager fired this. Computed here, while the stack that made the
    // request is still live — a row cannot be re-attributed later.
    var fb = firedBy(d, info.endpoint.id);
    row._net.fired_by = fb.name;
    row._net.fired_by_id = fb.container;
    if (fb.script) row._net.fired_by_script = fb.script;
    if (fb.how) row._net.fired_by_how = fb.how;
    if (fb.confirmed) row._net.fired_by_confirmed = true;
    if (fb.basis) row._net.fired_by_basis = fb.basis;
    if (fb.conflict) row._net.fired_by_conflict = fb.conflict;
    // Only on a conflict: the inline chip names BOTH sides, and the stack's
    // container alone would not say what it disagrees with.
    if (fb.conflict && fb.declared) row._net.fired_by_declared = fb.declared;
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
      // Not a known endpoint: hand it to discovery, which decides whether it
      // looks like a tracking hit and remembers it as a survey line if so.
      if (!ep) {
        if (sourceOn('disc')) {
          try { discConsider(abs, method, body, transport); } catch (e) {}
        }
        return false;
      }
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
    // script.src — not a request we log, but the record of WHO loaded WHAT,
    // which is what lets a later pixel be attributed to the library that fired
    // it rather than to nobody. Same prototype-setter trick as the image hook.
    // Scripts inserted with setAttribute('src') bypass this, exactly as images
    // do; those requests still get discovered, just with origin 'page'.
    try {
      var sdsc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      if (sdsc && sdsc.set && !sdsc.set.__cap) {
        var nss = function (v) {
          try { noteScript(v); } catch (e) {}
          return sdsc.set.call(this, v);
        };
        nss.__cap = true;
        Object.defineProperty(HTMLScriptElement.prototype, 'src', {
          get: sdsc.get, set: nss, configurable: true, enumerable: sdsc.enumerable
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
    return load().filter(function (r) {
      return sourceOn(kindOf(r)) && pillOn(pillKey(r));
    }).map(function (r) {
      var on = displayMatcher(r);
      var o = { _time: r._time, _kind: kindOf(r), _type: r._type, _via: r._via,
                _host: r._host, _path: r._path, _fields: r._fields, data: {} };
      if (r._extra) { o._uncat = r._uncat; o._extra = r._extra; }
      if (r._empty_n) { o._empty_n = r._empty_n; o._empty = r._empty; }
      if (r._net) { o._net = r._net; }
      if (r._dom) { o._dom = r._dom; }
      if (r._afterClick) { o._afterClick = r._afterClick; }
      Object.keys(r.data).forEach(function (k) { if (on(k)) o.data[k] = r.data[k]; });
      return o;
    });
  }
  // Counts what the badge is actually showing, so muting a vendor makes the
  // number drop rather than promising rows the panel will not display.
  function countBy(kind) {
    return load().filter(function (r) {
      return kindOf(r) === kind && pillOn(pillKey(r));
    }).length;
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
  var badgeEl = null, panelEl = null, hostEl = null, toastEl = null, fieldsEl = null, discEl = null;
  var legendEl = null;
  // Reassigned when the panel is built; a no-op before that so a toggle fired
  // from the console helpers cannot throw.
  var renderLegend = function () {};
  var renderLabelToggle = function () {};
  // Keeps the ticked count on the Fields button in step with the picker below it.
  var renderFieldsButton = function () {};
  // Badge reads "utag · beacons", and drops the half you have paused.
  function refreshBadge() {
    if (!badgeEl) return;
    var s = sources(), u = countBy('udo'), n = countBy('net'), parts = [];
    if (s.udo !== false) parts.push(String(u));
    if (s.net !== false) parts.push(String(n));
    badgeEl.textContent = parts.length ? parts.join(' · ') : '—';
    badgeEl.title = u + ' utag events and ' + n + ' beacons in the store';
  }
  // Redraws the Fields picker only if it is open. The picker is built lazily,
  // so this must tolerate being called before the panel exists.
  function refreshFields() {
    if (fieldsEl && fieldsEl.style.display !== 'none') renderFields();
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
  // A scoped group belongs to a vendor, and that vendor has a switch in the
  // legend. Muting it stops those rows being captured at all, so their
  // parameters are dead weight in the picker — 50-odd checkboxes for a vendor
  // that cannot produce a row. Unscoped groups apply to every row and are never
  // hidden: 'Reddit' holds utag-side attributes that still arrive on a Tealium
  // beacon after the Reddit PIXEL has been muted, so tying it to the pill would
  // hide fields that are genuinely still in play.
  function groupMuted(g) {
    if (!g.scope || !g.scope.endpoint || !g.scope.endpoint.length) return false;
    return g.scope.endpoint.every(function (ep) { return !pillOn(ep); });
  }
  // ── The Fields picker ──────────────────────────────────────────────────────
  // Two halves, deliberately: a shell built ONCE, and a list rebuilt on every
  // keystroke. The old picker rebuilt everything, which is why it could never
  // have a search box — the input would be destroyed mid-word, taking the caret
  // and the focus with it. Splitting them is what makes filtering possible, and
  // filtering is what a list of 300-odd checkboxes actually needs.
  var fieldsUI = null;
  var fieldQuery = '';
  // Ticked / total across every group the vendor chips have not muted. Muted
  // groups are excluded because they are not on screen either — a total that
  // counted invisible fields would never match what the user can see.
  function fieldStats() {
    var s = enabledSet(), out = { on: 0, total: 0 };
    groups().forEach(function (g) {
      if (groupMuted(g)) return;
      g.keys.forEach(function (k) { out.total++; if (s[qid(g, k)]) out.on++; });
    });
    return out;
  }
  // The search box doubles as the custom-key entry, so there is one input where
  // there used to be a filter-shaped hole at the top and an Add box at the
  // bottom of a very long scroll. Typing a key that already exists finds it;
  // typing one that does not offers to add it. Same gesture either way.
  function addTypedKey() {
    var k = fieldQuery.trim();
    if (!k) return;
    // If the typed key already exists in a catalogue group, tick it there —
    // under that group's qualified id, so a scoped key ends up in the right one.
    var host = null;
    CATALOGUE.forEach(function (g) { if (!host && g.keys.indexOf(k) >= 0) host = g; });
    if (host) {
      setEnabled(qid(host, k), true);
      toast('Ticked ' + k);
    } else {
      var c = customKeys();
      if (c.indexOf(k) < 0) { c.push(k); lsSet(CUSTOM_KEY, c); }
      setEnabled(k, true);
      toast('Added ' + k);
    }
    fieldQuery = '';
    if (fieldsUI) fieldsUI.q.value = '';
    renderFieldList();
  }
  function buildFieldsUI() {
    fieldsEl.textContent = '';
    var bar = el('div');
    bar.className = 'cap-fbar';
    var q = document.createElement('input');
    q.type = 'search';
    q.className = 'cap-fq';
    q.placeholder = 'Search fields, or add a UDO key…';
    q.value = fieldQuery;
    // 'search' fires when the browser's own × clears the box; 'input' alone
    // would leave the list filtered by a query no longer on screen.
    ['input', 'search'].forEach(function (ev) {
      q.addEventListener(ev, function () { fieldQuery = q.value; renderFieldList(); });
    });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addTypedKey(); }
    });
    bar.appendChild(q);
    var sum = el('div');
    sum.className = 'cap-fsum';
    var count = el('span', 'min-width:0');
    // Right-hand slot: restore-defaults normally, and the add affordance while a
    // search is running, because a half-typed key is never the moment to offer a
    // button that unticks everything you just searched for.
    var act = el('span', null);
    act.className = 'cap-link';
    sum.appendChild(count);
    sum.appendChild(act);
    bar.appendChild(sum);
    var list = el('div');
    var foot = el('div');
    fieldsEl.appendChild(bar);
    fieldsEl.appendChild(list);
    fieldsEl.appendChild(foot);
    fieldsUI = { q: q, count: count, act: act, list: list, foot: foot };
  }
  function renderFieldList() {
    var ui = fieldsUI, on = enabledSet();
    var raw = fieldQuery.trim(), q = raw.toLowerCase();
    ui.list.textContent = '';
    ui.foot.textContent = '';
    var hidden = [], matched = 0, exact = false;
    groups().filter(function (g) {
      if (!groupMuted(g)) return true;
      hidden.push(g.name.replace(/ \(on the wire\)$/, ''));
      return false;
    }).forEach(function (g) {
      var keys = g.keys.filter(function (k) {
        if (k === raw) exact = true;
        if (!q) return true;
        return k.toLowerCase().indexOf(q) >= 0 ||
               String(labelFor(g, k) || '').toLowerCase().indexOf(q) >= 0;
      });
      if (!keys.length) return;
      matched += keys.length;
      // A search is a request to SEE what matched, so it overrides the fold.
      var folded = !q && groupFolded(g);
      var head = el('div');
      head.className = 'cap-fh';
      var chev = el('span', null, folded ? '▶' : '▼');
      chev.className = 'cap-fh-chev';
      var name = el('span', null, g.name);
      name.className = 'cap-fh-name';
      var cnt = el('span');
      cnt.className = 'cap-count';
      head.appendChild(chev);
      head.appendChild(name);
      head.appendChild(cnt);
      // Painted from the snapshot taken at the top of the render — enabledSet()
      // parses localStorage on every call, and asking it once per group turned a
      // keystroke into fifty parses. Only a live toggle needs to re-read.
      function setCount(s) {
        var n = keys.filter(function (k) { return !!s[qid(g, k)]; }).length;
        cnt.textContent = n + '/' + keys.length;
        cnt.className = 'cap-count' + (n ? ' on' : '');
      }
      function syncCount() { setCount(enabledSet()); syncSummary(); }
      // Two buttons, not one label that means both. 'all / none' was a single
      // toggle: clicking the word 'all' when everything was already ticked
      // unticked the group, which is the opposite of what it says.
      var bulk = el('div');
      bulk.className = 'cap-bulk';
      [['all', true], ['none', false]].forEach(function (b) {
        var btn = el('button', null, b[0]);
        btn.title = (b[1] ? 'Show ' : 'Hide ') +
          (q ? 'the ' + keys.length + ' matching' : 'all ' + keys.length) + ' fields in ' + g.name;
        btn.addEventListener('click', function (e) {
          e.stopPropagation();   // the header itself folds; this button must not
          setEnabledMany(keys.map(function (k) { return qid(g, k); }), b[1]);
          renderFieldList();
        });
        bulk.appendChild(btn);
      });
      head.appendChild(bulk);
      head.addEventListener('click', function () {
        if (q) return;   // nothing to remember: the fold is off while filtering
        setGroupFolded(g, !folded);
        renderFieldList();
      });
      if (q) head.style.cursor = 'default';
      ui.list.appendChild(head);
      setCount(on);
      if (folded) return;
      if (g.scope) {
        var scope = el('div', null, 'Only recognised on ' + g.scope.endpoint.join(', ') + ' rows.');
        scope.className = 'cap-scope';
        ui.list.appendChild(scope);
      }
      keys.forEach(function (k) {
        var id = qid(g, k), isOn = !!on[id];
        var row = el('label');
        row.className = 'cap-f' + (isOn ? ' on' : '');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isOn;
        cb.addEventListener('change', function () {
          setEnabled(id, cb.checked);
          // Repainting one row instead of the list keeps the scroll position,
          // which matters when the box you just ticked is 200 rows down.
          row.className = 'cap-f' + (cb.checked ? ' on' : '');
          syncCount();
        });
        row.appendChild(cb);
        // Label first where there is one, with the raw key alongside in dim
        // monospace — you still need the literal name to search Tealium. Both on
        // ONE line, wrapping only when they do not fit: stacked, a catalogued
        // group was twice as tall as it needed to be.
        var txt = el('span');
        txt.className = 'cap-ftxt';
        var lab = labelFor(g, k);
        if (lab) txt.appendChild(el('span', null, lab));
        var raws = el('span', lab ? null : 'font-size:11px', k);
        raws.className = 'cap-k';
        txt.appendChild(raws);
        row.appendChild(txt);
        ui.list.appendChild(row);
      });
    });
    if (!matched) {
      var empty = el('div', null, q
        ? 'No field matches “' + raw + '”.'
        : 'Nothing to show — every group is muted in the chips above.');
      empty.className = 'cap-empty';
      ui.list.appendChild(empty);
    }
    var note = el('div', null,
      'All catalogued keys are always captured — these boxes filter the console ' +
      'and the exports, including past captures.');
    note.className = 'cap-note';
    ui.foot.appendChild(note);
    // Never let a group vanish silently: a picker that quietly drops Meta reads
    // as a bug, not as a consequence of muting META two panels up.
    if (hidden.length) {
      ui.foot.appendChild(el('div', 'font-size:10px;color:#8d6e63;margin-top:3px',
        hidden.length + ' group' + (hidden.length === 1 ? '' : 's') + ' hidden — ' +
        hidden.join(', ') + ' muted in the chips above.'));
    }
    syncSummary();
    function syncSummary() {
      var s = fieldStats();
      renderFieldsButton();
      ui.count.textContent = q
        ? matched + ' match' + (matched === 1 ? '' : 'es') + ' · ' + s.on + ' of ' + s.total + ' ticked'
        : s.on + ' of ' + s.total + ' fields ticked';
      // Offer the add only for something that is not already a known key —
      // otherwise the search has already found it and Enter would be a no-op.
      if (raw && !exact) {
        ui.act.textContent = '+ add “' + raw + '”';
        ui.act.title = 'Capture and show this UDO key, catalogued or not.';
        ui.act.onclick = addTypedKey;
      } else {
        ui.act.textContent = 'restore defaults';
        ui.act.title = 'Tick the fields this tool ships with and untick everything else.';
        ui.act.onclick = function () {
          lsSet(FIELDS_KEY, DEFAULT_ON.slice());
          renderFieldList();
          toast('Fields restored to defaults');
        };
      }
    }
  }
  function renderFields() {
    if (!fieldsUI) buildFieldsUI();
    renderFieldList();
  }
  // Newest first, because the thing you just triggered is the thing you are
  // looking for. Tealium-fired endpoints sort above the rest within that.
  function discSorted() {
    discFlush();
    var m = discAll();
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) {
      var at = a.origin.indexOf('tealium') === 0, bt = b.origin.indexOf('tealium') === 0;
      if (at !== bt) return at ? -1 : 1;
      return (b.last_ms || 0) - (a.last_ms || 0);
    });
  }
  function renderDiscovered() {
    discEl.textContent = '';
    var list = discSorted();
    if (!list.length) {
      discEl.appendChild(el('div', 'font-size:11px;color:#888;padding:6px 0',
        'Nothing yet. Every third-party request that does not match a known ' +
        'endpoint is checked here; browse the site and anything tracking-shaped ' +
        'will appear.'));
      return;
    }
    discEl.appendChild(el('div', 'font-size:10px;color:#777;margin:2px 0 6px',
      list.length + ' endpoint' + (list.length === 1 ? '' : 's') + ' not in the catalogue. ' +
      'These are surveyed, not captured — promote one to NET_ENDPOINTS to get full rows.'));
    list.forEach(function (d) {
      var box = el('div', 'border-top:1px solid #333;padding:5px 0');
      var tone = d.origin.indexOf('tealium') === 0 ? '#ffb74d' : d.origin === 'page' ? '#90a4ae' : '#777';
      var head = el('div', 'display:flex;gap:6px;align-items:baseline;justify-content:space-between');
      head.appendChild(el('span', 'font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#eee;' +
        'word-break:break-all;min-width:0', d.host + d.path));
      head.appendChild(el('span', 'font-size:10px;color:#888;flex:none', '×' + d.count));
      box.appendChild(head);
      box.appendChild(el('div', 'font-size:10px;color:' + tone + ';margin-top:2px',
        (d.origin === 'tealium:direct' ? 'fired by Tealium directly'
       : d.origin === 'tealium:via'    ? 'fired by ' + d.script + '  (Tealium-loaded)'
       : d.origin === 'page'           ? 'fired by page code — ' + d.script
       : 'origin unknown — seen after the fact')));
      box.appendChild(el('div', 'font-size:10px;color:#777;margin-top:1px',
        d.why.join(', ') + '  ·  ' + Object.keys(d.transports).join('/') +
        '  ·  ' + d.first_seen.slice(0, 8) + '→' + d.last_seen.slice(0, 8)));
      if (d.params && d.params.length) {
        box.appendChild(el('div', 'font-family:ui-monospace,Menlo,monospace;font-size:10px;' +
          'color:#8a8a8a;margin-top:2px;word-break:break-all', d.params.join(' ')));
      }
      discEl.appendChild(box);
    });
    var row = el('div', 'display:flex;gap:4px;margin:8px 0 2px');
    var bc = el('button', 'flex:1;background:#3a3a3a;border:0;color:#eee;border-radius:5px;' +
      'padding:5px 6px;font:700 11px inherit;cursor:pointer', 'Copy JSON');
    bc.addEventListener('click', function () {
      copy(JSON.stringify(discSorted(), null, 2), function (ok) {
        toast(ok ? 'Copied ' + list.length + ' endpoints' : 'Copy failed', ok);
      });
    });
    var bx = el('button', 'flex:none;background:#4a2222;border:0;color:#eee;border-radius:5px;' +
      'padding:5px 8px;font:700 11px inherit;cursor:pointer', 'Clear');
    bx.addEventListener('click', function () {
      discMap = {}; discDirty = true; discFlush();
      renderDiscovered(); refreshBadge(); toast('Discovery cleared');
    });
    row.appendChild(bc); row.appendChild(bx);
    discEl.appendChild(row);
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
      hostEl = badgeEl = panelEl = toastEl = fieldsEl = discEl = legendEl = null;
      // Its refs point into the torn-down tree; leaving it set would make the
      // rebuilt picker render into detached nodes and silently show nothing.
      fieldsUI = null;
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
    // Everything else in this panel is styled inline, which is fine for one-off
    // nodes. The Fields picker is not one-off: it is hundreds of rows rebuilt on
    // every keystroke, and it wants :hover and position:sticky, neither of which
    // an inline style can express. A stylesheet in the shadow root cannot leak
    // into the page and the page cannot reach it, so the isolation inline styles
    // were bought for is not given up.
    var css = document.createElement('style');
    css.textContent = [
      // top:-10px, not 0: the panel has 10px of padding, and sticking to the
      // padding edge left a 10px band above the bar where the rows scrolling
      // underneath stayed visible as a sliver of cut-off text.
      '.cap-fbar{position:sticky;top:-10px;background:#1e1e1e;padding:10px 0 6px;z-index:2;',
      '  box-shadow:0 6px 6px -6px rgba(0,0,0,.6)}',
      '.cap-fq{width:100%;box-sizing:border-box;background:#252525;border:1px solid #3a3a3a;',
      '  color:#eee;border-radius:6px;padding:6px 8px;font:11px ui-monospace,Menlo,monospace}',
      '.cap-fq:focus{outline:0;border-color:#4f8fbf;background:#2a2a2a}',
      '.cap-fq::placeholder{color:#6e6e6e;font-family:-apple-system,Segoe UI,Roboto,sans-serif}',
      '.cap-fsum{display:flex;align-items:baseline;justify-content:space-between;gap:6px;',
      '  margin:5px 1px 0;font-size:10px;color:#7d7d7d}',
      '.cap-link{color:#8ecdf5;cursor:pointer;font-weight:600;flex:none}',
      '.cap-link:hover{text-decoration:underline}',
      '.cap-fh{display:flex;align-items:center;gap:6px;margin:9px 0 1px;cursor:pointer;user-select:none}',
      '.cap-fh:hover .cap-fh-name{color:#b6e0fb}',
      '.cap-fh-chev{color:#666;font-size:9px;flex:none;width:7px}',
      '.cap-fh-name{flex:1;min-width:0;font:700 11px inherit;color:#8ecdf5;text-transform:uppercase;',
      '  letter-spacing:.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cap-count{flex:none;font:600 10px ui-monospace,Menlo,monospace;color:#8f8f8f;',
      '  background:#2b2b2b;border-radius:999px;padding:1px 6px}',
      '.cap-count.on{color:#0f2231;background:#8ecdf5}',
      '.cap-bulk{flex:none;display:flex;gap:1px}',
      '.cap-bulk button{background:#2b2b2b;border:0;color:#9a9a9a;font:600 10px inherit;',
      '  padding:2px 6px;cursor:pointer}',
      '.cap-bulk button:first-child{border-radius:4px 0 0 4px}',
      '.cap-bulk button:last-child{border-radius:0 4px 4px 0}',
      '.cap-bulk button:hover{background:#3b3b3b;color:#f0f0f0}',
      '.cap-scope{font-size:10px;color:#6f6f6f;margin:0 0 2px 13px}',
      '.cap-f{display:flex;align-items:center;gap:7px;padding:3px 5px;margin:0 -5px;',
      '  border-radius:5px;cursor:pointer;font-size:11px;color:#b9b9b9}',
      '.cap-f:hover{background:#282828}',
      '.cap-f.on{color:#f0f0f0}',
      '.cap-f input{flex:none;margin:0;width:13px;height:13px;cursor:pointer;accent-color:#4f8fbf}',
      '.cap-ftxt{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px;min-width:0}',
      '.cap-k{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#7c7c7c;word-break:break-all}',
      '.cap-f.on .cap-k{color:#9d9d9d}',
      '.cap-note{font-size:10px;color:#777;margin-top:5px}',
      '.cap-empty{font-size:11px;color:#8a8a8a;padding:10px 2px;text-align:center}'
    ].join('\n');
    root.appendChild(css);
    var wrap = el('div', 'font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif');
    var pill = el('div', 'display:flex;align-items:center;gap:8px;background:#1e1e1e;color:#eee;' +
      'font-weight:700;font-size:12px;padding:8px 10px;border-radius:999px;' +
      'box-shadow:0 3px 12px rgba(0,0,0,.35);cursor:grab;user-select:none');
    // 'CAP' was short for capture — an internal abbreviation that had leaked into
    // the one part of this script a non-author ever sees. TAGS says what the tool
    // watches without needing to be explained, and it is still short enough to
    // stay out of the way. One constant, so it is one edit to change again.
    pill.appendChild(el('span', 'width:8px;height:8px;border-radius:50%;background:#66bb6a'));
    pill.appendChild(el('span', null, PILL_NAME));
    badgeEl = el('span', 'background:#333;border-radius:999px;padding:2px 7px', '0');
    pill.appendChild(badgeEl);
    pill.title = 'Tag capture — utag events, Tealium beacons and vendor pixels.\n' +
                 'Click to open, drag to move.';
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
    // ── FILTERS ─────────────────────────────────────────────────────────────
    // One filter surface, not two. The old panel had Sources checkboxes (utag /
    // beacons) sitting above the same chips that already switch VIEW, LINK,
    // BEACON and VISITOR individually — two controls for one job, and the
    // coarse one silently overrode the fine one. The chips win: they cover
    // everything the checkboxes did and they carry counts. __capSources() still
    // works for anyone scripting against it.
    //
    // Chips deliberately carry no hit count. One was tried and removed: the
    // panel only re-rendered while it was open, so the number was frozen at page
    // load until something fired with the panel already up — a count that is
    // wrong most of the time is worse than none. The badge on the pill is the
    // live total, and __capNet() breaks it down.
    var srcWrap = el('div', 'margin:2px 0 8px');
    function chipRow(title, pills) {
      var wrapEl = el('div', 'margin:0 0 7px');
      var head = el('div', 'display:flex;align-items:baseline;justify-content:space-between;margin:0 0 3px');
      head.appendChild(el('span', 'font-weight:700;color:#8ecdf5;font-size:10px;' +
        'text-transform:uppercase;letter-spacing:.4px', title));
      // Two buttons rather than one 'all · none' that toggled on whatever the
      // chips happened to be: clicking the word 'all' could mute the row, which
      // is the opposite of what it says. Same pair, same styling, as the Fields
      // groups below — one gesture to learn for both.
      var bulk = el('div');
      bulk.className = 'cap-bulk';
      [['all', false], ['none', true]].forEach(function (b) {
        var btn = el('button', null, b[0]);
        btn.title = (b[1] ? 'Mute every ' : 'Capture every ') + title.toLowerCase() + ' row type';
        btn.addEventListener('click', function () {
          pills.forEach(function (p) { setPillMuted(p.key, b[1]); });
          renderLegend(); refreshBadge(); refreshFields();
          toast((b[1] ? 'Muted ' : 'Capturing ') + title.toLowerCase());
        });
        bulk.appendChild(btn);
      });
      head.appendChild(bulk);
      wrapEl.appendChild(head);
      var row = el('div', 'display:flex;flex-wrap:wrap;gap:3px');
      wrapEl.appendChild(row);
      return { el: wrapEl, row: row };
    }
    var tealiumRow = chipRow('Tealium', legendPills().slice(0, 4));
    var vendorRow  = chipRow('Vendors', legendPills().slice(4));
    legendEl = el('div', null);
    legendEl.appendChild(tealiumRow.el);
    legendEl.appendChild(vendorRow.el);
    srcWrap.appendChild(legendEl);
    var legendNote = el('div', 'font-size:10px;color:#777;margin:-2px 0 0');
    srcWrap.appendChild(legendNote);
    renderLegend = function () {
      tealiumRow.row.textContent = '';
      vendorRow.row.textContent = '';
      var muted = 0;
      legendPills().forEach(function (p, i) {
        var on = pillOn(p.key);
        if (!on) muted++;
        // Muted is the same chip drained of colour, never a different shape, so
        // the row stays scannable and a colour never changes meaning.
        var chip = el('button',
          'background:' + (on ? p.colour : '#2a2a2a') + ';color:' + (on ? textOn(p.colour) : '#6d6d6d') +
          ';font:700 9px inherit;padding:2px 5px;border-radius:3px;flex:none;cursor:pointer;' +
          'display:inline-flex;align-items:center;gap:4px;' +
          'border:' + (p.ring && on ? '1px solid ' + lighten(p.colour, 0.55)
                     : on ? '1px solid transparent' : '1px solid #3a3a3a') +
          (on ? '' : ';text-decoration:line-through'), '');
        chip.appendChild(el('span', null, p.tag));
        chip.title = (on ? 'Capturing ' : 'Muted — ') + p.note +
                     (on ? '. Click to mute.' : '. Click to capture again.');
        chip.addEventListener('click', function () {
          setPillMuted(p.key, on);
          renderLegend(); refreshBadge(); refreshFields();
          toast((on ? 'Muted ' : 'Capturing ') + p.tag);
        });
        (i < 4 ? tealiumRow.row : vendorRow.row).appendChild(chip);
      });
      legendNote.textContent = muted
        ? muted + ' muted — paused and hidden. Rows already captured come back when you unmute.'
        : 'Click a chip to pause and hide that row type.';
    };
    renderLegend();
    // ── OPTIONS ─────────────────────────────────────────────────────────────
    function optionRow(label, get, set, hint) {
      var lab = el('label', 'display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;font-size:11px;color:#ddd');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = get();
      cb.style.cssText = 'margin:0;cursor:pointer;flex:none';
      cb.addEventListener('change', function () { set(cb.checked); });
      lab.appendChild(cb);
      lab.appendChild(el('span', null, label));
      if (hint) lab.title = hint;
      return { el: lab, cb: cb };
    }
    var discOpt = optionRow('Discover unknown vendors', function () { return sourceOn('disc'); },
      function (v) {
        setSource('disc', v);
        toast(v ? 'Discovering unknown vendors' : 'Discovery paused');
      }, 'Surveys any third-party tracking endpoint not in the catalogue');
    var labOpt = optionRow('Explain fields inline', labelsInline,
      function (v) {
        setLabelsInline(v);
        toast(v ? 'Explaining fields inline' : 'Explanations off — use __capExplain()');
      }, 'Adds the meaning of each parameter as a third column');
    renderLabelToggle = function () { labOpt.cb.checked = labelsInline(); };
    srcWrap.appendChild(el('div', 'border-top:1px solid #313131;margin:7px 0 4px'));
    srcWrap.appendChild(discOpt.el);
    srcWrap.appendChild(labOpt.el);
    panelEl.appendChild(srcWrap);
    // ── ACTIONS ─────────────────────────────────────────────────────────────
    // Four exports as one compact row rather than four full-width bars: they are
    // the least-used controls in the panel and they were pushing Fields, the
    // most-used one, below the fold.
    function smBtn(label, css) {
      return el('button', 'flex:1;min-width:0;padding:6px 4px;border:0;border-radius:6px;' +
        'background:' + (css || '#2f2f2f') + ';color:#eee;font:700 11px inherit;cursor:pointer', label);
    }
    var bFields = mkBtn('⚙  Fields…');
    var bDisc   = mkBtn('🛰  Discovered…');
    // The button carries the count for the same reason Discovered does: how many
    // fields are ticked decides what the console shows, and having to open the
    // picker to find out is how you end up debugging a filter you forgot you set.
    function fieldsLabel() {
      var open = fieldsEl.style.display !== 'none';
      return '⚙  Fields (' + fieldStats().on + ')' + (open ? ' ▾' : '…');
    }
    renderFieldsButton = function () { bFields.textContent = fieldsLabel(); };
    var actions = el('div', 'display:flex;gap:4px;margin:4px 0 0');
    var bCopy  = smBtn('Copy');
    var bJSON  = smBtn('JSON');
    var bCSV   = smBtn('CSV');
    var bClear = smBtn('Clear', '#4a2222');
    bCopy.title  = 'Copy the visible captures as JSON';
    bJSON.title  = 'Download the visible captures as JSON';
    bCSV.title   = 'Download the visible captures as CSV';
    bClear.title = 'Delete every stored capture';
    [bCopy, bJSON, bCSV, bClear].forEach(function (b) { actions.appendChild(b); });
    toastEl = el('div', 'margin-top:6px;font-size:11px;opacity:0;transition:opacity .2s;min-height:14px');
    // No top padding: the sticky search bar supplies its own, and a gap here
    // would be a strip the bar cannot cover when the list scrolls under it.
    fieldsEl = el('div', 'display:none;border-top:1px solid #333;margin-top:8px');
    discEl = el('div', 'display:none;border-top:1px solid #333;margin-top:8px;padding-top:4px');
    // ── ORDER ───────────────────────────────────────────────────────────────
    // Each disclosure sits DIRECTLY above the thing it opens. They used to be
    // two buttons stacked at the top with both bodies far below, past the export
    // row, so opening Fields expanded a region nowhere near the button that did
    // it — and with Discovered open too, whichever you clicked, the other one's
    // content is what appeared under your cursor.
    //
    // Fields goes last because it is the tall one: a picker that pushes four
    // hundred rows into the middle of the panel buries every control under it,
    // whereas at the bottom it simply extends downwards and the panel scrolls.
    panelEl.appendChild(bDisc);
    panelEl.appendChild(discEl);
    panelEl.appendChild(actions);
    panelEl.appendChild(toastEl);
    panelEl.appendChild(bFields);
    panelEl.appendChild(fieldsEl);
    function discLabel() {
      var n = Object.keys(discAll()).length;
      return '🛰  Discovered' + (n ? ' (' + n + ')' : '') + (discEl.style.display === 'none' ? '…' : ' ▾');
    }
    // ONE open at a time. Both are tall, and two open at once is a panel you can
    // only navigate by scrolling past whichever you were not looking at.
    function setDisclosures(which) {
      fieldsEl.style.display = which === 'fields' ? 'block' : 'none';
      discEl.style.display   = which === 'disc'   ? 'block' : 'none';
      bFields.textContent = fieldsLabel();
      bDisc.textContent = discLabel();
    }
    // Scrolls the button to the top of the panel so its body is the thing in
    // view. Measured from rects rather than offsetTop: offsetParent is the host,
    // which sits outside the shadow root, so offsetTop is not answerable here.
    function reveal(btn) {
      try {
        panelEl.scrollTop += btn.getBoundingClientRect().top -
                             panelEl.getBoundingClientRect().top - 4;
      } catch (e) {}
    }
    bFields.textContent = fieldsLabel();
    bFields.addEventListener('click', function () {
      var open = fieldsEl.style.display === 'none';
      setDisclosures(open ? 'fields' : null);
      if (open) {
        renderFields();
        reveal(bFields);
        // Straight into the search box: the picker exists to answer "where is
        // <key>", and typing is a faster answer than scrolling for it.
        try { fieldsUI.q.focus(); } catch (e) {}
      }
    });
    bDisc.textContent = discLabel();
    bDisc.addEventListener('click', function () {
      var open = discEl.style.display === 'none';
      if (open) renderDiscovered();
      setDisclosures(open ? 'disc' : null);
      if (open) reveal(bDisc);
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
      setDisclosures(null);
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
        time: r._time, endpoint: n.endpoint, fired_by: n.fired_by || '',
        method: n.method, transport: n.transport,
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
  // __capSources()                  -> current state
  // __capSources(true, false)       -> utag on, beacons off
  // __capSources(true, true, false) -> discovery off
  window.__capSources = function (udo, net, disc) {
    if (arguments.length) {
      setSource('udo', !!udo);
      setSource('net', arguments.length > 1 ? !!net : sources().net !== false);
      setSource('disc', arguments.length > 2 ? !!disc : sources().disc !== false);
      refreshBadge();
    }
    var s = sources();
    console.log('%c[CAP] sources%c  utag ' + (s.udo !== false ? 'on' : 'OFF') +
      '  ·  beacons ' + (s.net !== false ? 'on' : 'OFF') +
      '  ·  discovery ' + (s.disc !== false ? 'on' : 'OFF'),
      'background:#66bb6a;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold', 'color:#999');
    return s;
  };
  // The survey of everything that is NOT in the catalogue. One line per
  // endpoint, not per hit — see the DISCOVERY block for why.
  window.__capDiscovered = function () {
    var list = discSorted();
    if (!list.length) {
      console.log('%c[CAP] nothing discovered yet%c  browse the site with discovery on',
        'color:#8d6e63;font-weight:bold', 'color:#999');
      return list;
    }
    console.table(list.map(function (d) {
      return {
        endpoint: d.host + d.path, hits: d.count,
        fired_by: d.origin === 'tealium:via' ? 'Tealium → ' + d.script
                : d.origin === 'tealium:direct' ? 'Tealium (direct)'
                : d.origin === 'page' ? 'page — ' + d.script : 'unknown',
        why: d.why.join(', '),
        transport: Object.keys(d.transports).join('/'),
        params: (d.params || []).slice(0, 12).join(' '),
        first: d.first_seen, last: d.last_seen
      };
    }));
    console.log('%c[CAP] %c' + list.length + ' undocumented endpoint' + (list.length === 1 ? '' : 's') +
      '. Sample URLs are on the returned objects; promote anything real to NET_ENDPOINTS.',
      'background:#8d6e63;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold', 'color:#999');
    return list;
  };
  // __capExplain()        -> every vendor's parameter reference
  // __capExplain('ga4')   -> just GA4 (matches group id, name or endpoint)
  // The console cannot show a tooltip on logged text, so this is the substitute:
  // look a parameter up once here instead of carrying its explanation on every
  // row of every hit.
  window.__capExplain = function (which) {
    var gs = explainGroups(which);
    if (!gs.length) {
      console.log('%c[CAP] no vendor group matches "' + which + '"%c  try: ' +
        groups().filter(function (g) { return !!g.scope; })
          .map(function (g) { return g.id; }).join(', '),
        'color:#e53935;font-weight:bold', 'color:#999');
      return [];
    }
    var out = [];
    gs.forEach(function (g) {
      console.log('%c' + g.name, 'color:#8ecdf5;font-weight:bold');
      var rows = g.keys.map(function (k) {
        var r = { parameter: k, means: labelFor(g, k) || '—' };
        out.push({ group: g.id, parameter: k, means: r.means });
        return r;
      });
      console.table(rows);
    });
    console.log('%c[CAP] %c' + out.length + ' parameters across ' + gs.length + ' group' +
      (gs.length === 1 ? '' : 's') + '.  __capLabels(true) puts these back on every row.',
      'background:#8d6e63;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold', 'color:#999');
    return out;
  };
  // __capLabels()      -> current state
  // __capLabels(true)  -> explanations back as a third column on every row
  window.__capLabels = function (on) {
    if (arguments.length) {
      setLabelsInline(!!on);
      if (typeof renderLabelToggle === 'function') renderLabelToggle();
    }
    var v = labelsInline();
    console.log('%c[CAP] inline explanations ' + (v ? 'ON' : 'off') + '%c  ' +
      (v ? 'a third column on every row' : 'use __capExplain() for the reference'),
      'background:#8d6e63;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold', 'color:#999');
    return v;
  };
  // __capMute()                 -> what is muted right now
  // __capMute('fb/tr')          -> mute Meta
  // __capMute('fb/tr', false)   -> capture Meta again
  // __capMute(null)             -> unmute everything
  // Keys are the legend chips: view, link, beacon, visitor, and the vendor
  // endpoint ids (fb/tr, rp.gif, ga4, ga/ua, gads, uet, clarity, awin, gtm).
  window.__capMute = function (key, muted) {
    if (arguments.length && key === null) {
      lsSet(PILLS_KEY, []);
      renderLegend(); refreshBadge(); refreshFields();
      console.log('%c[CAP] all row types capturing', 'color:#66bb6a;font-weight:bold');
      return [];
    }
    if (arguments.length) {
      var known = legendPills().map(function (p) { return p.key; });
      if (known.indexOf(key) < 0) {
        console.log('%c[CAP] unknown row type "' + key + '"%c  try one of: ' + known.join(', '),
          'color:#e53935;font-weight:bold', 'color:#999');
        return mutedPills();
      }
      setPillMuted(key, arguments.length > 1 ? !!muted : true);
      renderLegend(); refreshBadge(); refreshFields();
    }
    var m = mutedPills();
    console.log('%c[CAP] muted%c  ' + (m.length ? m.join(', ') : 'nothing — capturing everything'),
      'background:#8d6e63;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold', 'color:#999');
    return m;
  };
  // Which container fired what, and — the point of it — which vendors are being
  // fired by MORE THAN ONE. That is the double-counting case, and nothing else
  // in the stack reports it.
  window.__capContainers = function () {
    var rows = visibleRows().filter(function (r) { return r._kind === 'net'; });
    var byVendor = {}, byContainer = {};
    rows.forEach(function (r) {
      var n = r._net || {};
      var who = n.fired_by || 'unknown';
      var what = n.endpoint + (n.vendor ? '  (' + n.vendor + ')' : '');
      byContainer[who] = (byContainer[who] || 0) + 1;
      (byVendor[what] = byVendor[what] || {})[who] = (byVendor[what][who] || 0) + 1;
    });
    console.log('%c[CAP] hits by container%c',
      'background:#8d6e63;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold', 'color:#999');
    console.table(Object.keys(byContainer).sort(function (a, b) { return byContainer[b] - byContainer[a]; })
      .map(function (k) { return { container: k, hits: byContainer[k] }; }));
    var shared = Object.keys(byVendor).filter(function (v) { return Object.keys(byVendor[v]).length > 1; });
    console.table(Object.keys(byVendor).sort().map(function (v) {
      var o = { endpoint: v };
      Object.keys(byVendor[v]).forEach(function (c) { o[c] = byVendor[v][c]; });
      return o;
    }));
    if (shared.length) {
      console.log('%c⚠ fired by more than one container: ' + shared.join(', ') +
        '\n  Same vendor, two tag managers — check for duplicate conversions and for ' +
        'the two disagreeing about consent.', 'color:#e53935;font-weight:bold');
    }
    var conflicts = rows.filter(function (r) { return (r._net || {}).fired_by_conflict; });
    if (conflicts.length) {
      console.log('%c⚠ ' + conflicts.length + ' hit(s) where the stack and the payload disagree about who fired them',
        'color:#e53935;font-weight:bold');
    }
    return { byContainer: byContainer, byVendor: byVendor, shared: shared };
  };
  window.__capDiscoveredClear = function () {
    discMap = {}; discDirty = true; discFlush();
    if (discEl && discEl.style.display !== 'none') renderDiscovered();
    console.log('%c[CAP] discovery cleared', 'color:#8d6e63');
  };
  // Force the pill back: tears down whatever is there, forgets the stored drag
  // position, and rebuilds at the default corner. First thing to try if the pill
  // is missing — captures are unaffected either way, they are in localStorage.
  window.__capPanel = function () {
    try { if (hostEl && hostEl.parentNode) hostEl.parentNode.removeChild(hostEl); } catch (e) {}
    hostEl = badgeEl = panelEl = toastEl = fieldsEl = discEl = legendEl = null;
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
    '%c[CAP] armed%c  utag + beacons + discovery · panel bottom-right · __capDump() · __capNet() · ' +
    '__capDiscovered() · __capContainers() · __capExplain() · __capMute() · __capCSV()',
    'background:#66bb6a;color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold',
    'color:#999'
  );
})();
// Note on 'ut.event': in captured payloads it reads "view" even on link events,
// because it reflects the last page view rather than the current track type.
// Use the _type column instead.