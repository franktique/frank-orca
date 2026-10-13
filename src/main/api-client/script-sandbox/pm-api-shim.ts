// Guest-side JavaScript evaluated inside QuickJS before a user script. It is a string, not a module:
// the sandbox has no module loader and no access to anything in this process.
// Keep it free of backticks and `${` so it can live in a String.raw literal.

import { PM_GUEST_GLOBALS_SHIM_SOURCE } from './pm-guest-globals-shim'
import { PM_RESPONSE_API_SHIM_SOURCE } from './pm-response-api-shim'

/** chai probes for EventTarget/Event at load time; QuickJS has neither. */
export const SANDBOX_POLYFILLS_SOURCE = String.raw`
globalThis.Event = class Event { constructor(type) { this.type = type } };
globalThis.EventTarget = class EventTarget {
  constructor() { this.listeners = {} }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn) }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter(function (f) { return f !== fn })
  }
  dispatchEvent(event) {
    (this.listeners[event.type] || []).forEach(function (fn) { fn(event) });
    return true
  }
};
`

export const PM_API_SHIM_SOURCE =
  String.raw`
(function (global) {
  'use strict';
  var input = JSON.parse(global.__orcaInput);
  delete global.__orcaInput;
  var chai = global.__orcaChai;

  function NotSupportedError(message) {
    this.name = 'NotSupportedError';
    this.message = message;
    this.stack = new Error(message).stack;
  }
  NotSupportedError.prototype = Object.create(Error.prototype);
  NotSupportedError.prototype.constructor = NotSupportedError;
  global.NotSupportedError = NotSupportedError;
  function unsupported(name) {
    return function () { throw new NotSupportedError(name + ' is not supported in Orca'); };
  }

  var output = {
    tests: [],
    logs: [],
    writes: {
      environment: { set: {}, unset: [] },
      collection: { set: {}, unset: [] },
      local: { set: {}, unset: [] }
    },
    request: null,
    error: null
  };

  function stringify(value) {
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }
  function toStored(value) {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') { try { return JSON.stringify(value); } catch (e) { return String(value); } }
    return String(value);
  }

  // ---- console ----------------------------------------------------------
  function logger(level) {
    return function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) parts.push(stringify(arguments[i]));
      output.logs.push({ level: level, text: parts.join(' ') });
    };
  }
  global.console = { log: logger('log'), info: logger('info'), warn: logger('warn'), error: logger('error'), debug: logger('log') };

  // ---- variable scopes --------------------------------------------------
  function toMap(entries) {
    var map = {};
    (entries || []).forEach(function (entry) {
      if (entry.enabled !== false && entry.value !== null) map[entry.key] = entry.value;
    });
    return map;
  }
  var scopeData = {
    local: toMap(input.variables.local),
    environment: toMap(input.variables.environment),
    folders: toMap(input.variables.folders),
    collection: toMap(input.variables.collection)
  };
  function has(map, key) { return Object.prototype.hasOwnProperty.call(map, key); }

  function makeScope(name) {
    var data = scopeData[name];
    var writes = output.writes[name];
    return {
      get: function (key) { return has(data, key) ? data[key] : undefined; },
      set: function (key, value) {
        var stored = toStored(value);
        data[key] = stored;
        writes.set[key] = stored;
        writes.unset = writes.unset.filter(function (k) { return k !== key; });
      },
      unset: function (key) {
        delete data[key];
        delete writes.set[key];
        if (writes.unset.indexOf(key) === -1) writes.unset.push(key);
      },
      has: function (key) { return has(data, key); },
      clear: function () { var self = this; Object.keys(data).forEach(function (k) { self.unset(k); }); },
      toObject: function () { var copy = {}; Object.keys(data).forEach(function (k) { copy[k] = data[k]; }); return copy; }
    };
  }
  var environment = makeScope('environment');
  var collectionVariables = makeScope('collection');
  var localScope = makeScope('local');

  function lookup(key) {
    if (has(scopeData.local, key)) return scopeData.local[key];
    if (has(scopeData.environment, key)) return scopeData.environment[key];
    if (has(scopeData.folders, key)) return scopeData.folders[key];
    if (has(scopeData.collection, key)) return scopeData.collection[key];
    return undefined;
  }
  function replaceIn(text) {
    return String(text).replace(/\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g, function (match, name) {
      var value = lookup(name);
      return value === undefined ? match : value;
    });
  }
  var variables = {
    get: lookup,
    set: localScope.set,
    unset: localScope.unset,
    has: function (key) { return lookup(key) !== undefined; },
    replaceIn: replaceIn,
    toObject: function () {
      var all = {};
      [scopeData.collection, scopeData.folders, scopeData.environment, scopeData.local].forEach(function (map) {
        Object.keys(map).forEach(function (k) { all[k] = map[k]; });
      });
      return all;
    }
  };

  // ---- request ----------------------------------------------------------
  var requestState = {
    method: input.request.method,
    url: input.request.url,
    headers: input.request.headers.map(function (pair) { return { key: pair[0], value: pair[1] }; }),
    body: { mode: input.request.body ? input.request.body.mode : 'none', raw: input.request.body && input.request.body.raw !== undefined ? input.request.body.raw : '' }
  };
  var requestMutated = false;
  function headerList(list, onChange) {
    function find(name) {
      var lower = String(name).toLowerCase();
      for (var i = 0; i < list.length; i++) if (list[i].key.toLowerCase() === lower) return list[i];
      return undefined;
    }
    return {
      get: function (name) { var h = find(name); return h ? h.value : undefined; },
      has: function (name) { return find(name) !== undefined; },
      add: function (header) {
        list.push({ key: String(header.key), value: String(header.value) });
        onChange();
      },
      upsert: function (header) {
        var existing = find(header.key);
        if (existing) existing.value = String(header.value); else list.push({ key: String(header.key), value: String(header.value) });
        onChange();
      },
      remove: function (name) {
        var lower = String(name).toLowerCase();
        for (var i = list.length - 1; i >= 0; i--) if (list[i].key.toLowerCase() === lower) list.splice(i, 1);
        onChange();
      },
      toObject: function () { var o = {}; list.forEach(function (h) { o[h.key] = h.value; }); return o; },
      each: function (fn) { list.slice().forEach(fn); },
      all: function () { return list.slice(); }
    };
  }
  function markMutated() { requestMutated = true; }
  var urlObject = {
    toString: function () { return requestState.url; },
    getHost: function () { var m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/.exec(requestState.url); return m ? m[1] : ''; },
    getPath: function () { var m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*([^?#]*)/.exec(requestState.url); return m ? m[1] : ''; },
    getQueryString: function () { var m = /\?([^#]*)/.exec(requestState.url); return m ? m[1] : ''; },
    addQueryParams: function (params) {
      var text = typeof params === 'string' ? params : params.map(function (p) { return encodeURIComponent(p.key) + '=' + encodeURIComponent(p.value); }).join('&');
      requestState.url += (requestState.url.indexOf('?') === -1 ? '?' : '&') + text;
      markMutated();
    },
    removeQueryParams: function (names) {
      var drop = [].concat(names);
      var parts = requestState.url.split('?');
      if (parts.length < 2) return;
      var kept = parts[1].split('&').filter(function (pair) { return drop.indexOf(decodeURIComponent(pair.split('=')[0])) === -1; });
      requestState.url = kept.length ? parts[0] + '?' + kept.join('&') : parts[0];
      markMutated();
    }
  };
  Object.defineProperty(urlObject, 'raw', { get: function () { return requestState.url; }, set: function (v) { requestState.url = String(v); markMutated(); } });
  var requestApi = {
    headers: headerList(requestState.headers, markMutated),
    body: {
      toString: function () { return requestState.body.raw; }
    },
    id: input.info.requestId,
    name: input.info.requestName
  };
  Object.defineProperty(requestApi.body, 'mode', { get: function () { return requestState.body.mode; } });
  Object.defineProperty(requestApi.body, 'raw', {
    get: function () { return requestState.body.raw; },
    set: function (v) { requestState.body.raw = String(v); requestState.body.mode = 'raw'; markMutated(); }
  });
  Object.defineProperty(requestApi, 'url', {
    get: function () { return urlObject; },
    set: function (v) { requestState.url = typeof v === 'string' ? v : String(v && v.raw !== undefined ? v.raw : v); markMutated(); }
  });
  Object.defineProperty(requestApi, 'method', {
    get: function () { return requestState.method; },
    set: function (v) { requestState.method = String(v).toUpperCase(); markMutated(); }
  });
` +
  PM_RESPONSE_API_SHIM_SOURCE +
  String.raw`

  // ---- pm.test and friends ---------------------------------------------
  function recordTest(name, fn) {
    var entry = { name: String(name), passed: true };
    output.tests.push(entry);
    function fail(error) {
      entry.passed = false;
      entry.error = error && error.message !== undefined ? String(error.message) : String(error);
    }
    try {
      var result = fn();
      if (result && typeof result.then === 'function') result.then(function () {}, fail);
    } catch (error) {
      fail(error);
    }
  }
  var test = function (name, fn) { recordTest(name, fn); };
  test.skip = function (name) { output.tests.push({ name: String(name), passed: true, error: 'skipped' }); };

  var pm = {
    test: test,
    expect: chai.expect,
    environment: environment,
    collectionVariables: collectionVariables,
    variables: variables,
    request: requestApi,
    response: responseApi,
    info: {
      requestName: input.info.requestName,
      requestId: input.info.requestId,
      iteration: input.info.iteration,
      iterationCount: input.info.iterationCount,
      eventName: input.info.eventName
    },
    sendRequest: unsupported('pm.sendRequest'),
    require: unsupported('pm.require'),
    globals: { get: unsupported('pm.globals'), set: unsupported('pm.globals'), unset: unsupported('pm.globals'), has: unsupported('pm.globals') },
    visualizer: { set: unsupported('pm.visualizer') },
    execution: { setNextRequest: unsupported('pm.execution.setNextRequest') }
  };
  Object.defineProperty(pm, 'cookies', { get: unsupported('pm.cookies') });
  global.pm = pm;
` +
  PM_GUEST_GLOBALS_SHIM_SOURCE +
  String.raw`

  global.__orcaFinish = function () {
    if (requestMutated) {
      output.request = {
        method: requestState.method,
        url: requestState.url,
        headers: requestState.headers.map(function (h) { return [h.key, h.value]; }),
        body: { mode: requestState.body.mode, raw: requestState.body.raw }
      };
    }
    return JSON.stringify(output);
  };
  global.__orcaSetError = function (name, message) { output.error = { name: name, message: message }; };
})(globalThis);
`
