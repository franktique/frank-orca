import { useEffect, useRef } from 'react'
import type { OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type * as monacoNamespace from 'monaco-editor'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import ApiClientCodeEditor from '../../api-client/ApiClientCodeEditor'
import { registerSqlEditor } from './sql-editor-registry'

type MonacoEditor = editor.IStandaloneCodeEditor
type Monaco = typeof monacoNamespace

const MARKER_OWNER = 'orca-sql'

/** Monaco `pgsql` editor: runs the selection or everything, and marks the failing position. */
export default function SqlEditor({ tabId }: { tabId: string }): React.JSX.Element {
  const draftText = useAppStore((state) => state.sqlTabsById[tabId]?.draftText ?? '')
  const updateTab = useAppStore((state) => state.updateSqlTab)
  const run = useAppStore((state) => state.sqlRunByTab[tabId])
  const editorRef = useRef<MonacoEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)

  const runFromEditor = (): void => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) {
      return
    }
    const selection = editor.getSelection()
    const selected = selection && !selection.isEmpty() ? model.getValueInRange(selection) : null
    const baseOffset =
      selection && selected !== null ? model.getOffsetAt(selection.getStartPosition()) : 0
    void useAppStore.getState().runSqlTab(tabId, selected ?? model.getValue(), baseOffset)
  }

  const clearMarkers = (): void => {
    const model = editorRef.current?.getModel()
    if (model) {
      monacoRef.current?.editor.setModelMarkers(model, MARKER_OWNER, [])
    }
  }

  useEffect(() => registerSqlEditor(tabId, { run: runFromEditor }))

  // Place the database's error position on the line and column it names.
  useEffect(() => {
    const model = editorRef.current?.getModel()
    const monaco = monacoRef.current
    if (!model || !monaco) {
      return
    }
    if (run?.state === 'done' && run.result.kind === 'error' && run.result.error.position) {
      const start = model.getPositionAt(run.baseOffset + run.result.error.position - 1)
      const word = model.getWordAtPosition(start)
      monaco.editor.setModelMarkers(model, MARKER_OWNER, [
        {
          severity: monaco.MarkerSeverity.Error,
          message: run.result.error.message,
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: start.lineNumber,
          endColumn: word ? word.endColumn : start.column + 1
        }
      ])
    } else {
      clearMarkers()
    }
  }, [run])

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    editor.addAction({
      id: 'orca.sql.run',
      label: translate('sqlClient.editor.run', 'Run query'),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, monaco.KeyCode.F5],
      run: runFromEditor
    })
  }

  return (
    <ApiClientCodeEditor
      value={draftText}
      language="pgsql"
      label={translate('sqlClient.editor.label', 'SQL editor')}
      onMount={handleMount}
      onChange={(text) => {
        clearMarkers()
        updateTab(tabId, { draftText: text })
      }}
      options={{ lineNumbers: 'on', wordWrap: 'off' }}
    />
  )
}
