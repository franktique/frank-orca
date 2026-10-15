/** Lets the toolbar act on the Monaco instance that owns the selection, without prop drilling. */
export type SqlEditorHandle = {
  /** Runs the selection, or the whole editor text when nothing is selected. */
  run: () => void
}

const handles = new Map<string, SqlEditorHandle>()

export function registerSqlEditor(tabId: string, handle: SqlEditorHandle): () => void {
  handles.set(tabId, handle)
  return () => {
    if (handles.get(tabId) === handle) {
      handles.delete(tabId)
    }
  }
}

export function runSqlEditor(tabId: string): void {
  handles.get(tabId)?.run()
}
