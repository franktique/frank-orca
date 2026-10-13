// Legacy-global and runtime-globals half of the pm.* guest shim, concatenated inside the
// sandbox IIFE by pm-api-shim.ts.
// Keep it free of backticks and `${` so it can live in a String.raw literal.
export const PM_GUEST_GLOBALS_SHIM_SOURCE = String.raw`
  // ---- legacy globals ---------------------------------------------------
  global.tests = new Proxy({}, {
    set: function (target, name, value) {
      target[name] = value;
      output.tests.push({ name: String(name), passed: !!value, error: value ? undefined : 'expected ' + String(name) + ' to be truthy' });
      return true;
    }
  });
  if (input.response) {
    global.responseBody = input.response.bodyTooLarge ? '' : (input.response.body === null ? '' : input.response.body);
    global.responseCode = { code: input.response.code, name: input.response.status, detail: input.response.status };
    global.responseTime = input.response.responseTimeMs;
  }
  global.postman = {
    setEnvironmentVariable: function (key, value) { environment.set(key, value); },
    getEnvironmentVariable: function (key) { var v = environment.get(key); return v === undefined ? null : v; },
    clearEnvironmentVariable: function (key) { environment.unset(key); },
    setGlobalVariable: unsupported('postman.setGlobalVariable'),
    getGlobalVariable: unsupported('postman.getGlobalVariable'),
    setNextRequest: unsupported('postman.setNextRequest'),
    getResponseHeader: function (name) { return responseApi ? responseApi.headers.get(name) : undefined; }
  };

  // ---- pure helpers -----------------------------------------------------
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  global.btoa = function (input) {
    var str = String(input), out = '';
    for (var i = 0; i < str.length; i += 3) {
      var a = str.charCodeAt(i), b = str.charCodeAt(i + 1), c = str.charCodeAt(i + 2);
      var n = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);
      out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + (isNaN(b) ? '=' : B64.charAt((n >> 6) & 63)) + (isNaN(c) ? '=' : B64.charAt(n & 63));
    }
    return out;
  };
  global.atob = function (input) {
    var str = String(input).replace(/=+$/, ''), out = '', bits = 0, acc = 0;
    for (var i = 0; i < str.length; i++) {
      var idx = B64.indexOf(str.charAt(i));
      if (idx < 0) throw new Error('Invalid base64 string');
      acc = (acc << 6) | idx;
      bits += 6;
      if (bits >= 8) { bits -= 8; out += String.fromCharCode((acc >> bits) & 255); }
    }
    return out;
  };
  global.crypto = {
    randomUUID: function () {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });
    }
  };
  global.setTimeout = function () { return 0; };
  global.clearTimeout = function () {};
  global.require = function (name) {
    if (name === 'chai') return chai;
    throw new NotSupportedError("require('" + name + "') is not supported in Orca");
  };
`
