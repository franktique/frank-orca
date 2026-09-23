/** Snapshot of a file's diff shape at the moment it was marked reviewed. A row is
 *  considered still-reviewed only while the live entry's signature matches this
 *  snapshot — any further edit changes `added`/`removed`/`status` and the row reads
 *  as unreviewed again without any explicit reconciliation step. */
export type FileReviewSignature = {
  status: string
  added: number
  removed: number
}

export type FileReviewRecord = Record<string, FileReviewSignature>
