import { z } from 'zod'
import { variants } from '../../../shared/api-client/secret-masking'

/** Canvases inside these count as uninspectable when no `resultSelector` hint is set. */
export const DEFAULT_RESULT_REGION_SELECTOR =
  'table, [role="grid"], [role="table"], [id*="result" i], [class*="result" i]'

export const redactionReportSchema = z.object({
  covered: z.number().int().nonnegative(),
  residual: z.number().int().nonnegative(),
  uninspectable: z.number().int().nonnegative()
})

export type RedactionReport = z.infer<typeof redactionReportSchema>

const restoreReportSchema = z.object({ removed: z.number().int().nonnegative() })

// Why: overlays are tracked in one registry on the top window so restore needs no DOM sweep.
const OVERLAY_REGISTRY = '__orcaRedactionOverlays'

// Why a string: it runs inside the console page via evaluate(), not in this process.
const REDACTION_SCRIPT_SOURCE = String.raw`(function (rawNeedles, resultSelector) {
  var ATTR = 'data-orca-redaction-overlay';
  var MIN_SUBSTRING = 4;
  var SKIPPED_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, TITLE: 1, SELECT: 1 };
  var registry = window.__REGISTRY__ || (window.__REGISTRY__ = []);
  registry.splice(0).forEach(function (el) { el.remove(); });
  var needles = rawNeedles.slice().sort(function (a, b) { return b.length - a.length; });
  var state = { covered: 0, residual: 0, uninspectable: 0 };
  var overlayRects = new Map();

  function needlesIn(text) {
    return needles.filter(function (n) {
      return n.length < MIN_SUBSTRING ? text.trim() === n : text.indexOf(n) >= 0;
    });
  }
  function matchCount(text) { return spansOf(text).length; }
  function spansOf(text) {
    var out = [];
    needles.forEach(function (n) {
      if (n.length < MIN_SUBSTRING) {
        if (text.trim() === n) { out.push([text.indexOf(n), text.indexOf(n) + n.length]); }
        return;
      }
      var from = 0;
      var at;
      while ((at = text.indexOf(n, from)) >= 0) {
        var end = at + n.length;
        var inside = out.some(function (s) { return at >= s[0] && end <= s[1]; });
        if (!inside) { out.push([at, end]); }
        from = end;
      }
    });
    return out;
  }
  function isVisible(el) {
    for (var e = el; e; e = e.parentElement) {
      var style = e.ownerDocument.defaultView.getComputedStyle(e);
      if (style.display === 'none' || style.visibility === 'hidden') { return false; }
    }
    return true;
  }
  function usable(rect) { return rect.width > 0 && rect.height > 0; }
  function rectsOfRange(range) { return Array.prototype.slice.call(range.getClientRects()).filter(usable); }
  function addOverlay(doc, rect) {
    var box = doc.createElement('div');
    box.setAttribute(ATTR, '');
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;' +
      'background:#202020;backdrop-filter:blur(12px);' +
      'left:' + (rect.left - 1) + 'px;top:' + (rect.top - 1) + 'px;' +
      'width:' + (rect.width + 2) + 'px;height:' + (rect.height + 2) + 'px;';
    doc.documentElement.appendChild(box);
    registry.push(box);
    var list = overlayRects.get(doc) || [];
    list.push(rect);
    overlayRects.set(doc, list);
  }
  function isCovered(doc, rect) {
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    return (overlayRects.get(doc) || []).some(function (o) {
      return x >= o.left && x <= o.right && y >= o.top && y <= o.bottom;
    });
  }
  function handle(mode, doc, rects, count) {
    if (rects.length === 0) { return; }
    if (mode === 'cover') {
      rects.forEach(function (rect) { addOverlay(doc, rect); });
      state.covered += count;
    } else if (rects.some(function (rect) { return !isCovered(doc, rect); })) {
      state.residual += count;
    }
  }
  function inResultRegion(el) {
    try { return resultSelector ? !!el.closest(resultSelector) : false; } catch (e) { return false; }
  }

  function visit(mode, root, doc) {
    var walker = doc.createTreeWalker(root, 1 | 4);
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) {
        var parent = node.parentElement;
        if (!parent || SKIPPED_TAGS[parent.tagName] || parent.hasAttribute(ATTR) || !isVisible(parent)) { continue; }
        spansOf(node.data).forEach(function (span) {
          var range = doc.createRange();
          range.setStart(node, span[0]);
          range.setEnd(node, span[1]);
          handle(mode, doc, rectsOfRange(range), 1);
        });
        continue;
      }
      var el = node;
      if (el.hasAttribute(ATTR)) { continue; }
      var tag = el.tagName;
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && el.type !== 'hidden' && typeof el.value === 'string') {
        var count = matchCount(el.value);
        if (count > 0 && isVisible(el)) {
          var box = el.getBoundingClientRect();
          handle(mode, doc, usable(box) ? [box] : [], count);
        }
      }
      if (el.shadowRoot) { visit(mode, el.shadowRoot, doc); }
      if (tag === 'IFRAME' || tag === 'FRAME') {
        var inner = null;
        try { inner = el.contentDocument; } catch (e) { inner = null; }
        if (inner && inner.body) { visit(mode, inner.body, inner); }
        else if (mode === 'cover' && isVisible(el)) { state.uninspectable += 1; }
      }
      if (tag === 'CANVAS' && mode === 'cover' && isVisible(el)) {
        var region = resultSelector ? inResultRegion(el) : false;
        if (region) { state.uninspectable += 1; }
      }
      if (!SKIPPED_TAGS[tag] && tag !== 'INPUT' && el.children.length > 0 && isVisible(el)) {
        var whole = el.textContent || '';
        if (whole.length > 50000) { continue; }
        var hits = needlesIn(whole);
        if (hits.length === 0) { continue; }
        var childTexts = Array.prototype.map.call(el.childNodes, function (c) { return c.textContent || ''; });
        var split = hits.filter(function (n) {
          return !childTexts.some(function (t) { return needlesIn(t).indexOf(n) >= 0; });
        });
        if (split.length > 0) {
          var span = doc.createRange();
          span.selectNodeContents(el);
          handle(mode, doc, rectsOfRange(span), split.length);
        }
      }
    }
  }

  function scanAll(mode) { visit(mode, document.body || document.documentElement, document); }
  scanAll('cover');
  scanAll('verify');
  return state;
})`.replaceAll('__REGISTRY__', OVERLAY_REGISTRY)

const RESTORE_SCRIPT_SOURCE = String.raw`(function () {
  var registry = window.__REGISTRY__ || [];
  var removed = registry.length;
  registry.splice(0).forEach(function (el) { el.remove(); });
  return { removed: removed };
})()`.replaceAll('__REGISTRY__', OVERLAY_REGISTRY)

/** Every spelling of each value (feature 001's `variants()`), de-duplicated and non-empty. */
export function expandSensitiveValues(values: readonly string[]): string[] {
  const expanded = new Set<string>()
  for (const value of values) {
    if (value) {
      variants(value)
        .filter((entry) => entry.length > 0)
        .forEach((entry) => expanded.add(entry))
    }
  }
  return [...expanded]
}

export function buildRedactionScript(options: {
  sensitiveValues: readonly string[]
  resultSelector?: string
}): string {
  const needles = JSON.stringify(expandSensitiveValues(options.sensitiveValues))
  const region = JSON.stringify(options.resultSelector ?? DEFAULT_RESULT_REGION_SELECTOR)
  return `${REDACTION_SCRIPT_SOURCE}(${needles}, ${region})`
}

export const RESTORE_REDACTION_SCRIPT = RESTORE_SCRIPT_SOURCE

/** `evaluate()` returns objects as JSON text and primitives as strings; accept either form. */
export function parseEvaluateValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function parseRedactionReport(value: unknown): RedactionReport {
  return redactionReportSchema.parse(parseEvaluateValue(value))
}

export function parseRestoreReport(value: unknown): { removed: number } {
  return restoreReportSchema.parse(parseEvaluateValue(value))
}

export function redactionBlocksScreenshot(
  report: RedactionReport
): 'residual' | 'uninspectable' | null {
  if (report.uninspectable > 0) {
    return 'uninspectable'
  }
  return report.residual > 0 ? 'residual' : null
}
