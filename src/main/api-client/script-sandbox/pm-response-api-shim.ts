// Response half of the pm.* guest shim, concatenated inside the sandbox IIFE by pm-api-shim.ts.
// Keep it free of backticks and `${` so it can live in a String.raw literal.
export const PM_RESPONSE_API_SHIM_SOURCE = String.raw`
  // ---- response ---------------------------------------------------------
  var responseApi;
  var cachedJson;
  var jsonParsed = false;
  if (input.response) {
    var res = input.response;
    var textBody = function () {
      if (res.bodyTooLarge) throw new Error('The response body is too large for scripts (over 4 MB).');
      return res.body === null || res.body === undefined ? '' : res.body;
    };
    var headerPairs = res.headers.map(function (pair) { return { key: pair[0], value: pair[1] }; });
    var responseHeaders = headerList(headerPairs, function () {});
    var parseJson = function (path) {
      if (!jsonParsed) {
        try { cachedJson = JSON.parse(textBody()); } catch (e) { throw new Error('Response body is not valid JSON: ' + e.message); }
        jsonParsed = true;
      }
      return cachedJson;
    };
    var assertStatus = function (ok, message) { if (!ok) throw new chai.AssertionError(message); };
    var statusGetter = function (name, test) {
      Object.defineProperty(statusBe, name, { get: function () { assertStatus(test(res.code), 'expected response to be ' + name + ' but got ' + res.code); return true; } });
    };
    var statusBe = {};
    statusGetter('ok', function (c) { return c >= 200 && c < 300; });
    statusGetter('success', function (c) { return c >= 200 && c < 300; });
    statusGetter('info', function (c) { return c >= 100 && c < 200; });
    statusGetter('redirection', function (c) { return c >= 300 && c < 400; });
    statusGetter('clientError', function (c) { return c >= 400 && c < 500; });
    statusGetter('serverError', function (c) { return c >= 500 && c < 600; });
    statusGetter('error', function (c) { return c >= 400 && c < 600; });
    statusGetter('accepted', function (c) { return c === 202; });
    statusGetter('badRequest', function (c) { return c === 400; });
    statusGetter('unauthorized', function (c) { return c === 401; });
    statusGetter('forbidden', function (c) { return c === 403; });
    statusGetter('notFound', function (c) { return c === 404; });
    statusGetter('rateLimited', function (c) { return c === 429; });
    var lookupPath = function (target, path) {
      var segments = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(function (s) { return s.length > 0; });
      var current = target;
      for (var i = 0; i < segments.length; i++) {
        if (current === null || current === undefined) return undefined;
        current = current[segments[i]];
      }
      return current;
    };
    responseApi = {
      code: res.code,
      status: res.status,
      responseTime: res.responseTimeMs,
      responseSize: res.sizeBytes,
      headers: responseHeaders,
      text: textBody,
      json: parseJson,
      to: {
        be: statusBe,
        have: {
          status: function (expected) {
            var matches = typeof expected === 'number' ? res.code === expected : String(expected) === res.status;
            assertStatus(matches, 'expected response to have status ' + (typeof expected === 'number' ? 'code ' : 'reason ') + stringify(expected) + ' but got ' + res.code);
            return true;
          },
          header: function (name, value) {
            var actual = responseHeaders.get(name);
            assertStatus(actual !== undefined, 'expected response to have header ' + name);
            if (value !== undefined) assertStatus(actual === value, 'expected header ' + name + ' to be ' + value + ' but got ' + actual);
            return true;
          },
          body: function (expected) {
            var text = textBody();
            var matches = expected instanceof RegExp ? expected.test(text) : text === expected;
            assertStatus(matches, 'expected response body to match ' + stringify(expected));
            return true;
          },
          jsonBody: function (path, value) {
            var parsed = parseJson();
            if (path === undefined) return true;
            var actual = lookupPath(parsed, path);
            if (arguments.length < 2) { assertStatus(actual !== undefined, 'expected JSON body to have ' + path); return true; }
            chai.expect(actual).to.eql(value);
            return true;
          }
        }
      }
    };
  }
`
