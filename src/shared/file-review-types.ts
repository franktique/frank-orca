/** `reviewed` auto-clears when the live diff signature drifts from the one recorded at mark
 *  time (see {@link FileReviewSignature}). `markedForDeletion` is a manual to-do note, not a
 *  review-completeness marker, so it ignores diff drift and persists until explicitly cleared. */
export type FileReviewState = 'reviewed' | 'markedForDeletion'

/** A file's diff shape, as read off the live entry (no review state attached). */
export type FileDiffSignature = {
  status: string
  added: number
  removed: number
}

/** Snapshot of a file's diff shape at the moment it was marked. A `reviewed` row is
 *  considered still-reviewed only while the live entry's signature matches this
 *  snapshot — any further edit changes `added`/`removed`/`status` and the row reads
 *  as unreviewed again without any explicit reconciliation step. `markedForDeletion`
 *  rows ignore this drift; see {@link FileReviewState}. */
export type FileReviewSignature = FileDiffSignature & {
  state: FileReviewState
}

export type FileReviewRecord = Record<string, FileReviewSignature>

/** What a row's checkbox actually renders: `'unreviewed'` has no stored record at all,
 *  the other two mirror {@link FileReviewState}. */
export type FileReviewDisplayState = 'unreviewed' | FileReviewState
