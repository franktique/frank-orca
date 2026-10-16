// Shared consent-state shape, serializable across the main/renderer IPC
// boundary. Lives in `shared/` rather than main so the Privacy pane
// (renderer-side) can import the type without pulling in main-only code.
//
// The same discriminated union is what `src/main/telemetry/consent.ts`
// produces from `resolveConsent(settings)`. Keeping it here as the source
// of truth means the IPC getter in `src/main/ipc/telemetry.ts` returns
// this exact shape and the Privacy pane renders helper text by pattern-
// matching the `reason` without re-deriving the rules.

export type TelemetryConsentState =
  | { effective: 'enabled' }
  | {
      effective: 'disabled'
      reason: 'do_not_track' | 'orca_disabled' | 'ci' | 'user_opt_out'
    }
  | { effective: 'pending_banner' }

/** Persisted telemetry consent + identity stored on GlobalSettings. */
export type TelemetrySettings = {
  /** New users: true at install. Existing users: null until they resolve the first-launch banner. */
  optedIn: boolean | null
  /** Anonymous UUID v4. Generated on first run. Stable across launches; not surfaced in the UI. */
  installId: string
  /** Cohort marker: true for pre-existing profiles (gates the opt-in banner), false for fresh installs. */
  existedBeforeTelemetryRelease: boolean
}
