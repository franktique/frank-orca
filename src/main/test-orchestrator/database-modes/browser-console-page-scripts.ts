import { z } from 'zod'
import { DEFAULT_RESULT_REGION_SELECTOR } from './browser-console-redaction'

export const consoleProbeSchema = z.object({
  hash: z.string(),
  signIn: z.boolean(),
  errorText: z.string().nullable(),
  partial: z.boolean()
})

export type ConsoleProbe = z.infer<typeof consoleProbeSchema>

export const consoleResultSchema = z.object({
  found: z.boolean(),
  rows: z.array(z.array(z.string()))
})

const REGION_PLACEHOLDER = '__REGION__'

// Why strings: they run inside the console page via evaluate(), not in this process.
const PROBE_SOURCE = String.raw`(function (regionSelector) {
  function visible(el) {
    for (var e = el; e; e = e.parentElement) {
      var style = window.getComputedStyle(e);
      if (style.display === 'none' || style.visibility === 'hidden') { return false; }
    }
    return true;
  }
  var region = null;
  try { region = document.querySelector(regionSelector); } catch (e) { region = null; }
  var text = region ? (region.textContent || '') : '';
  var hash = 5381;
  for (var i = 0; i < text.length; i++) { hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0; }
  var signIn = Array.prototype.some.call(document.querySelectorAll('input[type="password"]'), visible);
  var errorText = null;
  var banners = document.querySelectorAll('[role="alert"], [class*="error" i], [id*="error" i]');
  for (var j = 0; j < banners.length; j++) {
    var banner = (banners[j].textContent || '').trim();
    if (banner && visible(banners[j])) { errorText = banner.slice(0, 300); break; }
  }
  var partial = Array.prototype.some.call(
    document.querySelectorAll('[aria-label*="pagination" i], [class*="pagination" i], [data-testid*="pagination" i], button, a'),
    function (el) {
      if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') { return false; }
      if (el.matches('button, a')) { return /^(next|siguiente|load more|ver más)/i.test((el.textContent || '').trim()); }
      return true;
    }
  );
  return { hash: String(region ? hash + ':' + text.length : 'none'), signIn: signIn, errorText: errorText, partial: partial };
})(${REGION_PLACEHOLDER})`

const READ_RESULT_SOURCE = String.raw`(function (regionSelector) {
  var MAX_ROWS = 5000;
  var scope = document;
  try { scope = document.querySelector(regionSelector) || document; } catch (e) { scope = document; }
  var grid = scope.querySelector('table, [role="grid"], [role="table"]');
  if (!grid) { return { found: false, rows: [] }; }
  var rowEls = Array.prototype.slice.call(grid.querySelectorAll('tr, [role="row"]'), 0, MAX_ROWS);
  var rows = rowEls.map(function (row) {
    var cells = row.querySelectorAll('th, td, [role="columnheader"], [role="gridcell"], [role="cell"], [role="rowheader"]');
    return Array.prototype.map.call(cells, function (cell) { return (cell.textContent || '').trim(); });
  }).filter(function (cells) { return cells.length > 0; });
  return { found: true, rows: rows };
})(${REGION_PLACEHOLDER})`

function withRegion(source: string, resultSelector: string | undefined): string {
  return source.replace(
    REGION_PLACEHOLDER,
    JSON.stringify(resultSelector ?? DEFAULT_RESULT_REGION_SELECTOR)
  )
}

export function buildConsoleProbeScript(resultSelector?: string): string {
  return withRegion(PROBE_SOURCE, resultSelector)
}

export function buildReadResultScript(resultSelector?: string): string {
  return withRegion(READ_RESULT_SOURCE, resultSelector)
}
