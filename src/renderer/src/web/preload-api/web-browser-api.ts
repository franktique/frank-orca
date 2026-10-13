import type { PreloadApi } from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'
import { noopUnsubscribe } from './web-storage'

export function createBrowserApi(): NonNullable<Partial<PreloadApi>['browser']> {
  return {
    registerGuest: () => Promise.resolve(false),
    isGuestRegistered: () => Promise.resolve(false),
    repairGuestRegistration: () => Promise.resolve(false),
    unregisterGuest: () => Promise.resolve(),
    openDevTools: () => Promise.resolve(false),
    setViewportOverride: () => Promise.resolve(false),
    reportViewportScrollState: () => {},
    setAnnotationViewportBridge: () => Promise.resolve(false),
    // A web client never hosts pages, so it has no lease to publish over.
    publishClientPageMetadata: () => Promise.resolve({ status: 'refused' as const }),
    onGuestLoadFailed: () => noopUnsubscribe,
    onCertificateFailureChanged: () => noopUnsubscribe,
    proceedCertificate: () => Promise.resolve({ ok: false, reason: 'missing' }),
    onPermissionDenied: () => noopUnsubscribe,
    onPopup: () => noopUnsubscribe,
    onDownloadRequested: () => noopUnsubscribe,
    onDownloadProgress: () => noopUnsubscribe,
    onDownloadFinished: () => noopUnsubscribe,
    onContextMenuRequested: () => noopUnsubscribe,
    onContextMenuDismissed: () => noopUnsubscribe,
    onNavigationUpdate: () => noopUnsubscribe,
    onActivateView: () => noopUnsubscribe,
    onPaneFocus: () => noopUnsubscribe,
    onOpenLinkInOrcaTab: () => noopUnsubscribe,
    cancelDownload: () => Promise.resolve(false),
    setGrabMode: () =>
      Promise.resolve({
        ok: false,
        error: translate(
          'auto.web.web.preload.api.31bea294d5',
          'Grab mode is unavailable in the web client.'
        )
      }),
    awaitGrabSelection: () =>
      Promise.resolve({
        ok: false,
        error: translate(
          'auto.web.web.preload.api.31bea294d5',
          'Grab mode is unavailable in the web client.'
        )
      }),
    cancelGrab: () => Promise.resolve(false),
    captureSelectionScreenshot: () =>
      Promise.resolve({
        ok: false,
        error: translate(
          'auto.web.web.preload.api.8dfcb7a351',
          'Selection screenshots are unavailable in the web client.'
        )
      }),
    extractHoverPayload: () =>
      Promise.resolve({
        ok: false,
        error: translate(
          'auto.web.web.preload.api.275a776357',
          'Hover extraction is unavailable in the web client.'
        )
      }),
    onGrabModeToggle: () => noopUnsubscribe,
    onGrabActionShortcut: () => noopUnsubscribe,
    sessionListProfiles: () => Promise.resolve([]),
    // Web clients render remote workspaces through the server; no local SSH routing exists.
    prepareSshWorkspacePartition: () =>
      Promise.reject(new Error('browser_local_route_unavailable')),
    sessionCreateProfile: () => Promise.resolve(null),
    sessionDeleteProfile: () => Promise.resolve(false),
    sessionImportCookies: () =>
      Promise.resolve({
        ok: false,
        summary: null,
        error: translate(
          'auto.web.web.preload.api.67ec964791',
          'Cookie import is unavailable in the web client.'
        )
      }),
    sessionResolvePartition: () => Promise.resolve(null),
    sessionDetectBrowsers: () => Promise.resolve([]),
    sessionDetectBrowsersForClientHost: () => Promise.resolve(null),
    sessionImportFromBrowserForClientHost: () => Promise.resolve(null),
    sessionClientRouteImportSources: () => Promise.resolve({}),
    sessionImportFromBrowser: () =>
      Promise.resolve({
        ok: false,
        summary: null,
        error: translate(
          'auto.web.web.preload.api.67ec964791',
          'Cookie import is unavailable in the web client.'
        )
      }),
    sessionClearDefaultCookies: () => Promise.resolve(false),
    notifyActiveTabChanged: () => Promise.resolve(false)
  } as unknown as NonNullable<Partial<PreloadApi>['browser']>
}

export function createApiClientApi(): NonNullable<Partial<PreloadApi>['apiClient']> {
  const unavailable = (): Promise<{ ok: false; code: 'not-local'; message: string }> =>
    Promise.resolve({
      ok: false,
      code: 'not-local',
      message: translate('apiClient.web.unavailable', 'The API Client is unavailable on web.')
    })
  return {
    getSnapshot: unavailable,
    setActiveEnvironment: unavailable,
    pickImportFile: () => Promise.resolve(null),
    importFile: unavailable,
    pickExportFile: () => Promise.resolve(null),
    exportFile: unavailable,
    treeOp: unavailable,
    saveRequest: unavailable,
    send: unavailable,
    envOp: unavailable,
    saveEnvironment: unavailable,
    getLatestRun: unavailable,
    startRun: unavailable,
    stopRun: unavailable,
    clearRun: unavailable,
    onRunProgress: () => noopUnsubscribe,
    onRunFinished: () => noopUnsubscribe,
    onShow: () => noopUnsubscribe,
    replyShow: () => undefined,
    cancel: unavailable,
    getLatestResult: unavailable,
    getConsole: unavailable,
    clearConsole: unavailable,
    onExecutionFinished: () => noopUnsubscribe,
    onConsoleAppended: () => noopUnsubscribe,
    onChanged: () => noopUnsubscribe
  }
}

export function createEmulatorApi(): NonNullable<Partial<PreloadApi>['emulator']> {
  return {
    onPaneFocus: () => noopUnsubscribe,
    onAutoAttach: () => noopUnsubscribe,
    startFrameStream: () => Promise.reject(new Error('Mobile emulator is unavailable on web.')),
    stopFrameStream: () => Promise.resolve(),
    onFrameStreamFrame: () => noopUnsubscribe,
    onFrameStreamError: () => noopUnsubscribe
  } as unknown as NonNullable<Partial<PreloadApi>['emulator']>
}
