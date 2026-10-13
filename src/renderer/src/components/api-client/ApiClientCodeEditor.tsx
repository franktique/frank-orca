import Editor from '@monaco-editor/react'
import '@/lib/monaco-setup'
import { useAppStore } from '@/store'

type ApiClientCodeEditorProps = {
  value: string
  language: string
  onChange?: (value: string) => void
  readOnly?: boolean
  /** Accessible name; Monaco renders a textarea without a visible label. */
  label: string
}

/** One Monaco surface for bodies, scripts and responses. Models are not shared between instances. */
export default function ApiClientCodeEditor({
  value,
  language,
  onChange,
  readOnly = false,
  label
}: ApiClientCodeEditorProps): React.JSX.Element {
  const isDark = useAppStore(
    (state) =>
      state.settings?.theme === 'dark' ||
      (state.settings?.theme === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
  )
  return (
    <div
      className="h-full min-h-0 overflow-hidden rounded-md border border-border"
      aria-label={label}
    >
      <Editor
        value={value}
        language={language}
        theme={isDark ? 'vs-dark' : 'vs'}
        onChange={(next) => onChange?.(next ?? '')}
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          fontSize: 12,
          automaticLayout: true,
          renderLineHighlight: 'none',
          tabSize: 2
        }}
      />
    </div>
  )
}
