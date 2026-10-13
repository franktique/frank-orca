import { useRef } from 'react'

let nextRowId = 0

/**
 * Ids that follow rows through edits and deletes, so typing in a row keeps its input mounted.
 * Rows have no identity of their own (a header name may repeat), and an index key would remount
 * every row below a deleted one.
 */
export function useStableRowIds(count: number): {
  ids: string[]
  removeAt: (index: number) => void
} {
  const ids = useRef<string[]>([])
  while (ids.current.length < count) {
    ids.current.push(`row-${nextRowId++}`)
  }
  if (ids.current.length > count) {
    ids.current.length = count
  }
  return {
    ids: ids.current,
    removeAt: (index) => {
      ids.current.splice(index, 1)
    }
  }
}
