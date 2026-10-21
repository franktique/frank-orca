// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRedactionScript,
  parseRedactionReport,
  parseRestoreReport,
  RESTORE_REDACTION_SCRIPT
} from './browser-console-redaction'

// Why stubs: happy-dom has no layout, so every element and text range gets one fixed box.
const BOX = new DOMRect(10, 10, 100, 20)

function rectList(rect: DOMRect): DOMRectList {
  return Object.assign([rect], { item: (index: number) => (index === 0 ? rect : null) })
}

function runPageScript(script: string): unknown {
  return new Function(`return ${script}`)()
}

function redact(sensitiveValues: string[], resultSelector?: string) {
  return parseRedactionReport(
    runPageScript(buildRedactionScript({ sensitiveValues, resultSelector }))
  )
}

function overlayCount(): number {
  return document.querySelectorAll('[data-orca-redaction-overlay]').length
}

beforeEach(() => {
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(() => rectList(BOX))
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => BOX)
})

afterEach(() => {
  vi.restoreAllMocks()
  runPageScript(RESTORE_REDACTION_SCRIPT)
  document.body.innerHTML = ''
})

describe('browser console redaction script', () => {
  it('covers a token in the editor and in a result cell', () => {
    document.body.innerHTML =
      '<div id="results"><table><tr><td>tok-secret-123</td></tr></table></div>'
    const editor = document.createElement('textarea')
    editor.value = "select 'tok-secret-123'"
    document.body.appendChild(editor)

    expect(redact(['tok-secret-123'])).toEqual({ covered: 2, residual: 0, uninspectable: 0 })
    expect(overlayCount()).toBe(2)
  })

  it('covers percent-encoded and JSON-escaped spellings', () => {
    document.body.innerHTML = '<p>a%20b%22c</p><p>a b\\"c</p><p>a+b%22c</p><p>unrelated</p>'

    expect(redact(['a b"c'])).toEqual({ covered: 3, residual: 0, uninspectable: 0 })
  })

  it('covers a value split across inline elements', () => {
    document.body.innerHTML = '<p><span>tok-sec</span><span>ret-123</span></p>'

    expect(redact(['tok-secret-123']).covered).toBe(1)
  })

  it('masks a short value only when it is the whole field', () => {
    document.body.innerHTML = '<p>7</p><p>row 7 of 10</p>'

    expect(redact(['7'])).toEqual({ covered: 1, residual: 0, uninspectable: 0 })
  })

  it('reports a cross-origin frame as uninspectable', () => {
    document.body.innerHTML = '<p>tok-secret-123</p>'
    const frame = document.createElement('iframe')
    // Why: a cross-origin frame exposes no document to the parent page.
    Object.defineProperty(frame, 'contentDocument', { get: () => null })
    document.body.appendChild(frame)

    const report = redact(['tok-secret-123'])

    expect(report.uninspectable).toBe(1)
    expect(report.covered).toBe(1)
  })

  it('reports a canvas in the result region as uninspectable but ignores one elsewhere', () => {
    document.body.innerHTML =
      '<canvas id="minimap"></canvas><div id="results"><canvas></canvas></div>'

    expect(redact(['tok-secret-123']).uninspectable).toBe(1)
  })

  it('reports a match whose text it cannot cover as residual', () => {
    document.body.innerHTML = '<p>tok-secret-123</p>'
    // Rects shift between passes, so the overlay no longer sits on the text.
    let calls = 0
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(() =>
      rectList(calls++ === 0 ? BOX : new DOMRect(900, 10, 100, 20))
    )

    expect(redact(['tok-secret-123']).residual).toBe(1)
  })

  it('restore removes every overlay and leaves the DOM as before', () => {
    document.body.innerHTML = '<textarea id="editor"></textarea><p>tok-secret-123</p>'
    const before = document.documentElement.outerHTML

    redact(['tok-secret-123'])
    expect(document.documentElement.outerHTML).not.toBe(before)
    const restored = parseRestoreReport(runPageScript(RESTORE_REDACTION_SCRIPT))

    expect(restored.removed).toBeGreaterThan(0)
    expect(document.documentElement.outerHTML).toBe(before)
  })

  it('does not stack overlays when run twice', () => {
    document.body.innerHTML = '<p>tok-secret-123</p>'

    redact(['tok-secret-123'])
    redact(['tok-secret-123'])

    expect(overlayCount()).toBe(1)
  })
})
