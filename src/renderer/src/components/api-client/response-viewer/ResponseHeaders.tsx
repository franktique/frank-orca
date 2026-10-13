import { translate } from '@/i18n/i18n'

export default function ResponseHeaders({
  headers
}: {
  headers: readonly [string, string][]
}): React.JSX.Element {
  if (headers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate('apiClient.response.noHeaders', 'No headers.')}
      </p>
    )
  }
  return (
    <table className="w-full table-fixed border-collapse text-left text-xs">
      <thead>
        <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
          <th className="w-1/3 px-2 py-1 font-semibold" scope="col">
            {translate('apiClient.table.key', 'Key')}
          </th>
          <th className="px-2 py-1 font-semibold" scope="col">
            {translate('apiClient.table.value', 'Value')}
          </th>
        </tr>
      </thead>
      <tbody>
        {headers.map(([name, value], index) => (
          <tr
            key={`${name}:${value}:${headers.slice(0, index).filter(([n]) => n === name).length}`}
            className="border-b border-border"
          >
            <td className="break-words px-2 py-1 font-mono">{name}</td>
            <td className="break-all px-2 py-1 font-mono">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
