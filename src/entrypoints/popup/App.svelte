<script lang="ts">
  import type {
    AuthStatus,
    BackgroundResponse,
    DetectedAts,
    EnabledOriginEntry,
    FillBatchResult,
    FillPortOutgoing,
    FillProgress,
    PopupToBackground,
    ProfileSummary,
    TabOriginInfo,
  } from '~/bridge/types'
  import type { OriginMode } from '~/field/types'
  import { browser } from 'wxt/browser'
  import Logo from '~/ui/Logo.svelte'
  import { MAX_PROFILE_SCORE } from '~/resolver/profileScore'
  import {
    PROFILE_SCORE_COMPLETE_AT,
    PROFILE_SCORE_EMPTY_BELOW,
  } from '~/config'
  import { onDestroy } from 'svelte'

  const REGISTER_RETRY_DELAY_MS = 500
  const WAITING_TIMEOUT_MS = 5 * 60 * 1000

  let status = $state<AuthStatus>({ authenticated: false })
  let summary = $state<ProfileSummary | null>(null)
  let detectedAts = $state<DetectedAts>('generic')
  let tabOriginInfo = $state<TabOriginInfo | null>(null)
  let enabledList = $state<EnabledOriginEntry[]>([])
  let settingsOpen = $state(false)
  let manageOpen = $state(false)
  let confirmRevoke = $state<EnabledOriginEntry | null>(null)
  let busy = $state(false)
  let errorMsg = $state<string | null>(null)
  let lastFillResult = $state<FillBatchResult | null>(null)
  let waitingForConnect = $state(false)
  let waitingTimer: ReturnType<typeof setTimeout> | null = null
  let progress = $state<FillProgress | null>(null)
  let activeTabId: number | null = $state(null)
  let activePort: Browser.runtime.Port | null = null
  let pendingEnableChoice = $state<{ pattern: string; origin: string } | null>(
    null,
  )

  const send = async (msg: PopupToBackground): Promise<BackgroundResponse> => {
    try {
      const res = (await browser.runtime.sendMessage(
        msg,
      )) as BackgroundResponse
      return res ?? { ok: false, error: 'No response from background' }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  const refreshOriginState = async () => {
    if (typeof activeTabId !== 'number') return
    const [tabRes, listRes] = await Promise.all([
      send({ kind: 'tab.listOrigins', tabId: activeTabId }),
      send({ kind: 'origin.list' }),
    ])
    if (tabRes.ok) tabOriginInfo = tabRes.data as TabOriginInfo | null
    if (listRes.ok) enabledList = listRes.data as EnabledOriginEntry[]
  }

  const refreshStatus = async () => {
    const s = await send({ kind: 'auth.status' })
    if (s.ok) status = s.data as AuthStatus
    if (status.authenticated) {
      clearWaitingTimer()
      waitingForConnect = false
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      })
      const tabId = tabs[0]?.id
      activeTabId = typeof tabId === 'number' ? tabId : null

      const summaryPromise = send({ kind: 'profile.summary' })
      let atsPromise: Promise<BackgroundResponse> | null = null
      let originsPromise: Promise<void> | null = null
      if (typeof tabId === 'number') {
        atsPromise = send({ kind: 'tab.detectAts', tabId })
        originsPromise = refreshOriginState()
      }

      const summaryRes = await summaryPromise
      if (summaryRes.ok) summary = summaryRes.data as ProfileSummary
      else if (summaryRes.error === 'network-error') {
        errorMsg = 'Could not reach TalentProfile. Check your connection.'
      }

      if (atsPromise) {
        const a = await atsPromise
        let resolvedAts: DetectedAts = 'generic'
        if (a.ok && a.data !== null && a.data !== undefined) {
          resolvedAts = a.data as DetectedAts
        }
        if (resolvedAts === 'generic') {
          await new Promise((r) => setTimeout(r, REGISTER_RETRY_DELAY_MS))
          const retry = await send({
            kind: 'tab.detectAts',
            tabId: activeTabId!,
          })
          if (retry.ok && retry.data !== null && retry.data !== undefined) {
            resolvedAts = retry.data as DetectedAts
          }
        }
        detectedAts = resolvedAts
      }
      if (originsPromise) await originsPromise
    } else {
      summary = null
      detectedAts = 'generic'
      tabOriginInfo = null
      enabledList = []
      if (status.reason === 'network-error') {
        errorMsg = 'Could not reach TalentProfile. Check your connection.'
      }
    }
  }

  const clearWaitingTimer = () => {
    if (waitingTimer !== null) {
      clearTimeout(waitingTimer)
      waitingTimer = null
    }
  }

  const handleAuthChanged = (message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      'kind' in message &&
      (message as { kind: string }).kind === 'auth.changed'
    ) {
      void refreshStatus()
    }
  }

  $effect(() => {
    refreshStatus()
  })

  browser.runtime.onMessage.addListener(handleAuthChanged)
  onDestroy(() => {
    browser.runtime.onMessage.removeListener(handleAuthChanged)
    clearWaitingTimer()
    if (activePort) {
      try {
        activePort.disconnect()
      } catch {}
      activePort = null
    }
  })

  const handleSignIn = async () => {
    busy = true
    errorMsg = null
    try {
      const res = await send({ kind: 'auth.openConnectPage' })
      if (res.ok) {
        waitingForConnect = true
        clearWaitingTimer()
        waitingTimer = setTimeout(() => {
          if (waitingForConnect) {
            waitingForConnect = false
            errorMsg = 'Sign-in took too long. Try again.'
            void send({ kind: 'auth.cancelConnect' })
          }
        }, WAITING_TIMEOUT_MS)
      } else {
        errorMsg = res.error
      }
    } finally {
      busy = false
    }
  }

  const handleCancelWaiting = () => {
    waitingForConnect = false
    clearWaitingTimer()
    void send({ kind: 'auth.cancelConnect' })
  }

  const handleLogout = async () => {
    await send({ kind: 'auth.logout' })
    errorMsg = null
    lastFillResult = null
    settingsOpen = false
    manageOpen = false
    await refreshStatus()
  }

  const handleFillAll = async () => {
    if (busy) return
    busy = true
    errorMsg = null
    lastFillResult = null
    progress = null

    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    })
    const tabId = tabs[0]?.id
    if (typeof tabId !== 'number') {
      busy = false
      errorMsg = 'No active tab'
      return
    }

    const port = browser.runtime.connect({ name: 'fill-progress' })
    activePort = port

    let partialProgress: FillProgress | null = null

    port.onMessage.addListener((msg: FillPortOutgoing) => {
      if (msg.kind === 'fill.frame.started') {
        progress = {
          counts: { filled: 0, skipped: 0, failed: 0 },
          total: msg.total,
        }
        partialProgress = progress
      } else if (msg.kind === 'fill.progress') {
        progress = { counts: msg.counts, total: msg.total }
        partialProgress = progress
      } else if (msg.kind === 'fill.done') {
        lastFillResult = msg.result
        progress = null
        busy = false
        try {
          port.disconnect()
        } catch {}
        activePort = null
      } else if (msg.kind === 'fill.error') {
        errorMsg = msg.error
        if (partialProgress) {
          lastFillResult = {
            counts: partialProgress.counts,
            framesTimedOut: 0,
            total: partialProgress.total,
          }
        }
        progress = null
        busy = false
        try {
          port.disconnect()
        } catch {}
        activePort = null
      }
    })

    port.onDisconnect.addListener(() => {
      if (busy) {
        busy = false
        if (!lastFillResult && !errorMsg) {
          errorMsg = 'Connection lost'
          if (partialProgress) {
            lastFillResult = {
              counts: partialProgress.counts,
              framesTimedOut: 0,
              total: partialProgress.total,
            }
          }
        }
        progress = null
        activePort = null
      }
    })

    port.postMessage({ kind: 'fill.start', tabId })
  }

  const handleRefreshProfile = async () => {
    busy = true
    errorMsg = null
    try {
      const p = await send({ kind: 'profile.refresh' })
      if (p.ok) summary = p.data as ProfileSummary
      else if (p.error === 'network-error') {
        errorMsg = 'Could not reach TalentProfile. Check your connection.'
      } else {
        errorMsg = p.error
      }
    } finally {
      busy = false
    }
  }

  const requestEnableOrigin = (pattern: string, origin: string) => {
    pendingEnableChoice = { pattern, origin }
  }

  const cancelEnableChoice = () => {
    pendingEnableChoice = null
  }

  const confirmEnableMode = async (mode: OriginMode) => {
    if (!pendingEnableChoice) return
    const { pattern } = pendingEnableChoice
    pendingEnableChoice = null
    if (busy) return
    busy = true
    errorMsg = null
    try {
      let granted = false
      try {
        granted = await browser.permissions.request({ origins: [pattern] })
      } catch (e) {
        errorMsg = (e as Error).message
        return
      }
      if (!granted) {
        errorMsg = 'Permission denied'
        return
      }
      const res = await send({ kind: 'origin.enable', pattern, mode })
      if (!res.ok) errorMsg = res.error ?? 'Could not enable'
      await refreshOriginState()
    } finally {
      busy = false
    }
  }

  const handleSetMode = async (
    entry: EnabledOriginEntry,
    mode: OriginMode,
  ) => {
    if (busy) return
    busy = true
    errorMsg = null
    try {
      const res = await send({
        kind: 'origin.setMode',
        pattern: entry.pattern,
        mode,
      })
      if (!res.ok) errorMsg = res.error ?? 'Could not update'
      await refreshOriginState()
    } finally {
      busy = false
    }
  }

  const handleDisableOrigin = async (entry: EnabledOriginEntry) => {
    confirmRevoke = entry
  }

  const confirmDisable = async () => {
    if (!confirmRevoke) return
    const entry = confirmRevoke
    confirmRevoke = null
    busy = true
    errorMsg = null
    try {
      const res = await send({
        kind: 'origin.disable',
        pattern: entry.pattern,
      })
      if (!res.ok) errorMsg = res.error ?? 'Could not disable'
      await refreshOriginState()
    } finally {
      busy = false
    }
  }

  const cancelDisable = () => {
    confirmRevoke = null
  }

  const openLink = (url: string) => {
    void browser.tabs.create({ url })
    window.close()
  }

  const openShortcuts = () => {
    const isFirefox = navigator.userAgent.toLowerCase().includes('firefox')
    if (isFirefox) {
      void browser.tabs.create({ url: 'about:addons' })
    } else {
      void browser.tabs.create({ url: 'chrome://extensions/shortcuts' })
    }
    window.close()
  }

  const toggleSettings = () => {
    settingsOpen = !settingsOpen
    if (!settingsOpen) manageOpen = false
  }

  const atsLabel = $derived.by(() => {
    if (detectedAts === 'workday') return 'Workday'
    if (detectedAts === 'greenhouseClassic') return 'Greenhouse (Classic)'
    if (detectedAts === 'greenhouseReact') return 'Greenhouse (React)'
    return null
  })

  const iframeOrigins = $derived(tabOriginInfo?.iframeOrigins ?? [])
  const enabledIframes = $derived(iframeOrigins.filter((f) => f.enabled))
  const hasEnabledIframe = $derived(enabledIframes.length > 0)

  const topMode = $derived<OriginMode | null>(tabOriginInfo?.topMode ?? null)
  const topIsApplication = $derived(
    detectedAts !== 'generic' || topMode === 'application',
  )
  const topIsNotesOnly = $derived(
    detectedAts === 'generic' && topMode === 'notesOnly',
  )
  const topIsAuto = $derived(detectedAts === 'generic' && topMode === 'auto')
  const canFillPage = $derived(topIsApplication || hasEnabledIframe)

  const siteLabel = $derived.by(() => {
    if (atsLabel) return `${atsLabel} detected`
    if (topIsApplication) {
      return `Autofill enabled on ${tabOriginInfo?.topOrigin ?? 'this site'}`
    }
    if (topIsNotesOnly) {
      return `Picker enabled on ${tabOriginInfo?.topOrigin ?? 'this site'}`
    }
    if (topIsAuto) {
      return `Auto mode on ${tabOriginInfo?.topOrigin ?? 'this site'}`
    }
    if (hasEnabledIframe) {
      if (enabledIframes.length === 1) {
        return `Enabled on embedded form (${enabledIframes[0].origin})`
      }
      return `Enabled on ${enabledIframes.length} embedded forms`
    }
    return null
  })

  const profileCompleteness = $derived.by(() => {
    if (!summary) return null
    const pct = Math.round((summary.profileScore / MAX_PROFILE_SCORE) * 100)
    if (summary.profileScore < PROFILE_SCORE_EMPTY_BELOW)
      return { level: 'empty', pct }
    if (summary.profileScore < PROFILE_SCORE_COMPLETE_AT)
      return { level: 'partial', pct }
    return { level: 'complete', pct }
  })

  const missingItems = $derived.by(() => {
    if (!summary?.scoreItems) return []
    const items: string[] = []
    if (!summary.scoreItems.profileName) items.push('Name')
    if (!summary.scoreItems.location) items.push('Location')
    if (!summary.scoreItems.totalExperience) items.push('Years of experience')
    if (summary.scoreItems.description === 'missing') items.push('Summary')
    if (!summary.scoreItems.skills) items.push('Skills (6+)')
    if (!summary.scoreItems.experience) items.push('Work experience')
    if (!summary.scoreItems.education) items.push('Education')
    if (!summary.scoreItems.languages) items.push('Languages')
    return items
  })

  const fillDisabled = $derived(
    busy || !canFillPage || profileCompleteness?.level === 'empty',
  )

  const progressPct = $derived.by(() => {
    if (!progress || progress.total === 0) return 0
    const done =
      progress.counts.filled + progress.counts.skipped + progress.counts.failed
    return Math.min(100, Math.round((done / progress.total) * 100))
  })

  const progressDone = $derived.by(() => {
    if (!progress) return 0
    return (
      progress.counts.filled + progress.counts.skipped + progress.counts.failed
    )
  })

  const fillButtonLabel = $derived.by(() => {
    if (busy && progress && progress.total > 0) {
      return `Filling ${progressDone}/${progress.total}…`
    }
    if (busy) return 'Filling…'
    return 'Fill visible fields'
  })

  const isMinimalMode = $derived(status.authenticated && !canFillPage)
  const showEnablePrompt = $derived(
    !atsLabel && tabOriginInfo !== null && tabOriginInfo.topEnabled === false,
  )
  const showModeControls = $derived(
    detectedAts === 'generic' && tabOriginInfo?.topEnabled === true,
  )

  const modeLabel = (mode: OriginMode | null): string => {
    if (mode === 'application') return 'Autofill + Picker'
    if (mode === 'notesOnly') return 'Picker only'
    if (mode === 'auto') return 'Auto (detect)'
    return 'Unknown'
  }
</script>

<div class="wrap">
  {#if status.authenticated}
    <header class="brand">
      <Logo size={28} />
      <span class="wordmark">Talent<strong>Profile</strong></span>
      <button
        type="button"
        class="settings-btn"
        aria-label="Settings"
        aria-expanded={settingsOpen}
        onclick={toggleSettings}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
      </button>
    </header>
  {/if}

  <div class="content">
    {#if !status.authenticated && waitingForConnect}
      <section class="signin">
        <div class="signin-brand">
          <Logo size={28} />
          <span class="wordmark">Waiting for connection…</span>
        </div>
        <p class="meta">
          Sign in on the page that just opened. This popup will update
          automatically once you&apos;re connected.
        </p>
        <div class="spinner-row">
          <div class="spinner"></div>
        </div>
        {#if errorMsg}<p class="err">{errorMsg}</p>{/if}
        <button type="button" class="secondary" onclick={handleCancelWaiting}>
          Cancel
        </button>
      </section>
    {:else if !status.authenticated}
      <section class="signin">
        <div class="signin-brand">
          <Logo size={28} />
          <span class="wordmark">Sign in to Talent<strong>Profile</strong></span
          >
        </div>
        <p class="meta">
          Sign in on talentprofile.net to connect this extension.
        </p>
        {#if status.reason === 'refresh-failed'}
          <p class="hint">Your session ended. Please sign in again.</p>
        {/if}
        {#if status.reason === 'network-error'}
          <p class="hint">Could not verify your session. Check your connection.</p>
        {/if}
        {#if errorMsg}<p class="err">{errorMsg}</p>{/if}
        <button
          type="button"
          class="primary"
          onclick={handleSignIn}
          disabled={busy}
        >
          {busy ? 'Opening…' : 'Sign in'}
        </button>
        <p class="aside">
          No account?
          <button
            type="button"
            class="link inline"
            onclick={() => openLink('https://app.talentprofile.net/sign-up')}
          >
            Sign up
          </button>
        </p>
      </section>
    {:else if isMinimalMode}
      <section class="minimal">
        <div class="site-row">
          {#if topIsNotesOnly}
            <div class="enabled-line">
              <span class="badge badge-ok"
                >Picker enabled on {tabOriginInfo?.topOrigin}</span
              >
              <button
                type="button"
                class="link inline"
                onclick={() =>
                  tabOriginInfo &&
                  handleDisableOrigin({
                    mode: 'notesOnly',
                    origin: tabOriginInfo.topOrigin,
                    pattern: tabOriginInfo.topPattern,
                  })}>Disable</button
              >
            </div>
            <div class="mode-controls-row">
              <span class="mode-label">Mode:</span>
              <button
                type="button"
                class="mode-pill mode-pill-active"
                disabled={busy}
                onclick={() =>
                  tabOriginInfo &&
                  handleSetMode(
                    {
                      mode: 'notesOnly',
                      origin: tabOriginInfo.topOrigin,
                      pattern: tabOriginInfo.topPattern,
                    },
                    'notesOnly',
                  )}>Picker only</button
              >
              <button
                type="button"
                class="mode-pill"
                disabled={busy}
                onclick={() =>
                  tabOriginInfo &&
                  handleSetMode(
                    {
                      mode: 'notesOnly',
                      origin: tabOriginInfo.topOrigin,
                      pattern: tabOriginInfo.topPattern,
                    },
                    'application',
                  )}>Autofill</button
              >
            </div>
          {:else if showEnablePrompt}
            <div class="enable-block">
              <p class="enable-text">
                Not enabled on {tabOriginInfo?.topOrigin}
              </p>
              <button
                type="button"
                class="primary primary-sm"
                disabled={busy}
                onclick={() =>
                  tabOriginInfo &&
                  requestEnableOrigin(
                    tabOriginInfo.topPattern,
                    tabOriginInfo.topOrigin,
                  )}>Enable here</button
              >
            </div>
          {:else}
            <span class="badge badge-warn">No supported page</span>
          {/if}
        </div>

        {#if iframeOrigins.length > 0}
          <div class="iframe-block">
            <p class="iframe-label">Embedded forms on this page:</p>
            {#each iframeOrigins as f (f.pattern)}
              <div class="iframe-row">
                <span class="iframe-origin">{f.origin}</span>
                {#if f.enabled}
                  <span class="badge-small badge-ok-small">enabled</span>
                  <button
                    type="button"
                    class="link inline"
                    onclick={() =>
                      handleDisableOrigin({
                        mode: f.mode ?? 'notesOnly',
                        origin: f.origin,
                        pattern: f.pattern,
                      })}>Disable</button
                  >
                {:else}
                  <button
                    type="button"
                    class="secondary secondary-sm"
                    disabled={busy}
                    onclick={() => requestEnableOrigin(f.pattern, f.origin)}
                    >Enable</button
                  >
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if errorMsg}<p class="err">{errorMsg}</p>{/if}
      </section>
    {:else}
      <section class="profile">
        {#if summary}
          <p class="name">{summary.profileName ?? '(no name)'}</p>
          <p class="meta">{summary.email ?? ''}</p>
          {#if summary.jobTitle}
            <p class="meta">{summary.jobTitle}</p>
          {/if}

          {#if profileCompleteness}
            <div class="completeness completeness-{profileCompleteness.level}">
              <div class="completeness-header">
                <span class="completeness-label">
                  {#if profileCompleteness.level === 'empty'}
                    Profile incomplete
                  {:else if profileCompleteness.level === 'partial'}
                    Profile partially complete
                  {:else}
                    Profile complete
                  {/if}
                </span>
                <span class="completeness-pct">{profileCompleteness.pct}%</span>
              </div>
              <div class="progress">
                <div
                  class="progress-bar"
                  style="width: {profileCompleteness.pct}%"
                ></div>
              </div>
              {#if profileCompleteness.level !== 'complete' && missingItems.length > 0}
                <p class="missing">Missing: {missingItems.join(', ')}</p>
                <button
                  type="button"
                  class="link inline"
                  onclick={() => openLink('https://app.talentprofile.net/')}
                >
                  Complete profile →
                </button>
              {/if}
            </div>
          {/if}

          {#if siteLabel}
            <div class="site-row">
              <span class="badge badge-ok">{siteLabel}</span>
            </div>
          {/if}

          {#if showModeControls && tabOriginInfo}
            <div class="mode-controls-row">
              <span class="mode-label">Mode:</span>
              <button
                type="button"
                class="mode-pill"
                class:mode-pill-active={topMode === 'application'}
                disabled={busy}
                onclick={() =>
                  handleSetMode(
                    {
                      mode: topMode ?? 'application',
                      origin: tabOriginInfo!.topOrigin,
                      pattern: tabOriginInfo!.topPattern,
                    },
                    'application',
                  )}>Autofill</button
              >
              <button
                type="button"
                class="mode-pill"
                class:mode-pill-active={topMode === 'notesOnly'}
                disabled={busy}
                onclick={() =>
                  handleSetMode(
                    {
                      mode: topMode ?? 'application',
                      origin: tabOriginInfo!.topOrigin,
                      pattern: tabOriginInfo!.topPattern,
                    },
                    'notesOnly',
                  )}>Picker only</button
              >
              <button
                type="button"
                class="mode-pill"
                class:mode-pill-active={topMode === 'auto'}
                disabled={busy}
                onclick={() =>
                  handleSetMode(
                    {
                      mode: topMode ?? 'application',
                      origin: tabOriginInfo!.topOrigin,
                      pattern: tabOriginInfo!.topPattern,
                    },
                    'auto',
                  )}>Auto</button
              >
            </div>
          {/if}

          {#if hasEnabledIframe && iframeOrigins.length > enabledIframes.length}
            <div class="iframe-block iframe-block-compact">
              <p class="iframe-label">Other embedded forms:</p>
              {#each iframeOrigins.filter((f) => !f.enabled) as f (f.pattern)}
                <div class="iframe-row">
                  <span class="iframe-origin">{f.origin}</span>
                  <button
                    type="button"
                    class="secondary secondary-sm"
                    disabled={busy}
                    onclick={() => requestEnableOrigin(f.pattern, f.origin)}
                    >Enable</button
                  >
                </div>
              {/each}
            </div>
          {/if}
        {:else}
          <p class="meta">Loading profile…</p>
        {/if}
      </section>

      <div class="actions">
        <button
          type="button"
          class="primary"
          onclick={handleFillAll}
          disabled={fillDisabled}
        >
          {fillButtonLabel}
        </button>

        {#if progress && progress.total > 0}
          <div class="fill-progress">
            <div class="fill-progress-header">
              <span class="fill-progress-label">
                Filling {progressDone} of {progress.total}
              </span>
              <span class="fill-progress-pct">{progressPct}%</span>
            </div>
            <div class="fill-progress-track">
              <div
                class="fill-progress-bar"
                style="width: {progressPct}%"
              ></div>
            </div>
          </div>
        {/if}

        {#if profileCompleteness?.level === 'empty'}
          <p class="warn">
            Your profile is too empty to fill forms. Complete your profile
            first.
          </p>
        {/if}

        {#if lastFillResult}
          <div class="result">
            <p class="info">
              Filled <strong>{lastFillResult.counts.filled}</strong>, skipped
              <strong>{lastFillResult.counts.skipped}</strong>, failed
              <strong>{lastFillResult.counts.failed}</strong>
            </p>
          </div>
        {/if}

        {#if errorMsg}<p class="err">{errorMsg}</p>{/if}
      </div>
    {/if}
  </div>

  {#if settingsOpen && status.authenticated}
    <div class="settings-panel">
      <div class="settings-section">
        <button
          type="button"
          class="settings-row"
          onclick={() => (manageOpen = !manageOpen)}
        >
          <span>Manage enabled sites</span>
          <span class="settings-count">
            {enabledList.length}
            <span class="chevron" data-open={manageOpen}>›</span>
          </span>
        </button>
        {#if manageOpen}
          <div class="manage-list">
            {#if enabledList.length === 0}
              <p class="manage-empty">No sites enabled yet.</p>
            {:else}
              {#each enabledList as entry (entry.pattern)}
                <div class="manage-row">
                  <div class="manage-origin-block">
                    <span class="manage-origin">{entry.origin}</span>
                    <span class="manage-mode-badge">{modeLabel(entry.mode)}</span>
                  </div>
                  <button
                    type="button"
                    class="manage-remove"
                    aria-label="Disable {entry.origin}"
                    onclick={() => handleDisableOrigin(entry)}>✕</button
                  >
                </div>
              {/each}
            {/if}
          </div>
        {/if}
      </div>

      <button
        type="button"
        class="settings-row"
        onclick={openShortcuts}
      >
        <span>Keyboard shortcuts</span>
      </button>

      <button
        type="button"
        class="settings-row"
        onclick={() => openLink('https://app.talentprofile.net/')}
        disabled={busy}
      >
        <span>Open dashboard</span>
      </button>

      <button
        type="button"
        class="settings-row"
        onclick={handleRefreshProfile}
        disabled={busy}
      >
        <span>Refresh profile</span>
      </button>

      <button
        type="button"
        class="settings-row settings-row-danger"
        onclick={handleLogout}
      >
        <span>Sign out</span>
      </button>
    </div>
  {/if}

  {#if pendingEnableChoice}
    <div class="modal-overlay">
      <button
        type="button"
        class="modal-backdrop-btn"
        aria-label="Close dialog"
        onclick={cancelEnableChoice}
      ></button>
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Choose mode"
        tabindex={-1}
      >
        <p class="modal-title">Enable on {pendingEnableChoice.origin}</p>
        <p class="modal-body">
          Choose how TalentProfile should work here. You can change this later.
        </p>
        <div class="mode-choices">
          <button
            type="button"
            class="mode-choice"
            onclick={() => confirmEnableMode('application')}
          >
            <span class="mode-choice-title">Autofill + Picker</span>
            <span class="mode-choice-desc"
              >Show a Fill button and pick from profile fields.</span
            >
          </button>
          <button
            type="button"
            class="mode-choice"
            onclick={() => confirmEnableMode('notesOnly')}
          >
            <span class="mode-choice-title">Picker only</span>
            <span class="mode-choice-desc"
              >Show the inline picker for notes and snippets. Best for chat and
              docs.</span
            >
          </button>
          <button
            type="button"
            class="mode-choice"
            onclick={() => confirmEnableMode('auto')}
          >
            <span class="mode-choice-title">Auto (detect)</span>
            <span class="mode-choice-desc"
              >Use page hints to choose between autofill and picker
              automatically.</span
            >
          </button>
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary" onclick={cancelEnableChoice}
            >Cancel</button
          >
        </div>
      </div>
    </div>
  {/if}

  {#if confirmRevoke}
    <div class="modal-overlay">
      <button
        type="button"
        class="modal-backdrop-btn"
        aria-label="Close dialog"
        onclick={cancelDisable}
      ></button>
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm disable"
        tabindex={-1}
      >
        <p class="modal-title">Disable TalentProfile on {confirmRevoke.origin}?</p>
        <p class="modal-body">
          The extension will stop running on this site. You can re-enable it
          later.
        </p>
        <div class="modal-actions">
          <button type="button" class="secondary" onclick={cancelDisable}
            >Cancel</button
          >
          <button type="button" class="primary" onclick={confirmDisable}
            >Disable</button
          >
        </div>
      </div>
    </div>
  {/if}

  <footer class="footer">
    <button
      type="button"
      class="footer-link"
      onclick={() => openLink('https://talentprofile.net/privacy')}
      >Privacy</button
    >
    <span class="dot">·</span>
    <button
      type="button"
      class="footer-link"
      onclick={() => openLink('https://talentprofile.net/terms')}>Terms</button
    >
    <span class="dot">·</span>
    <button
      type="button"
      class="footer-link"
      onclick={() => openLink('https://talentprofile.net/contact')}
      >Contact</button
    >
  </footer>
</div>

<style>
  :global(html, body) {
    margin: 0;
    background: #ffffff;
    color: #0f172a;
    font:
      14px/1.4 -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      Roboto,
      Helvetica,
      Arial,
      sans-serif;
  }
  .wrap {
    min-width: 340px;
    width: 340px;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid #e2e8f0;
  }
  .wordmark {
    font-size: 15px;
    color: #0f172a;
    letter-spacing: -0.01em;
    flex: 1;
  }
  .wordmark strong {
    font-weight: 700;
  }
  .settings-btn {
    background: transparent;
    border: none;
    color: #64748b;
    padding: 4px;
    cursor: pointer;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      background 120ms ease,
      color 120ms ease;
  }
  .settings-btn:hover {
    background: #f1f5f9;
    color: #0f172a;
  }
  .settings-btn[aria-expanded='true'] {
    background: #e2e8f0;
    color: #0f172a;
  }
  .content {
    padding: 16px;
  }
  .signin-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .signin-brand .wordmark {
    font-size: 16px;
    font-weight: 600;
  }
  .signin {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .minimal {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .spinner-row {
    display: flex;
    justify-content: center;
    padding: 8px 0;
  }
  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid #e2e8f0;
    border-top-color: #175cfa;
    border-radius: 50%;
    animation: spin 800ms linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  button {
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    transition:
      background 120ms ease,
      color 120ms ease,
      opacity 120ms ease;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .primary {
    padding: 9px 14px;
    background: #175cfa;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .primary:hover:not(:disabled) {
    background: #0f4ad6;
  }
  .primary-sm {
    padding: 6px 10px;
    font-size: 12px;
  }
  .secondary {
    padding: 8px 14px;
    background: #ffffff;
    color: #0f172a;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-weight: 500;
  }
  .secondary:hover:not(:disabled) {
    border-color: #94a3b8;
    background: #f8fafc;
  }
  .secondary-sm {
    padding: 4px 10px;
    font-size: 12px;
  }
  .link {
    background: transparent;
    color: #475569;
    border: none;
    padding: 4px;
    font-weight: 500;
  }
  .link:hover:not(:disabled) {
    color: #0f172a;
  }
  .link.inline {
    padding: 0;
    color: #175cfa;
    font-weight: 600;
  }
  .link.inline:hover:not(:disabled) {
    color: #0f4ad6;
    text-decoration: underline;
  }
  .err {
    color: #b91c1c;
    background: #fef2f2;
    border: 1px solid #fecaca;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 12px;
    margin: 0;
  }
  .hint {
    color: #b45309;
    background: #fffbeb;
    border: 1px solid #fde68a;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 12px;
    margin: 0;
  }
  .warn {
    color: #b45309;
    font-size: 12px;
    margin: 0;
  }
  .aside {
    font-size: 12px;
    color: #64748b;
    margin: 0;
    text-align: center;
  }
  .profile {
    padding: 0 0 14px;
    border-bottom: 1px solid #e2e8f0;
    margin-bottom: 14px;
  }
  .name {
    font-weight: 600;
    font-size: 14px;
    margin: 0 0 2px;
    letter-spacing: -0.01em;
  }
  .meta {
    font-size: 12px;
    color: #64748b;
    margin: 0;
  }
  .completeness {
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .completeness-empty {
    background: #fef2f2;
    border: 1px solid #fecaca;
  }
  .completeness-partial {
    background: #fffbeb;
    border: 1px solid #fde68a;
  }
  .completeness-complete {
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
  }
  .completeness-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .completeness-label {
    font-size: 12px;
    font-weight: 600;
  }
  .completeness-empty .completeness-label {
    color: #b91c1c;
  }
  .completeness-partial .completeness-label {
    color: #b45309;
  }
  .completeness-complete .completeness-label {
    color: #047857;
  }
  .completeness-pct {
    font-size: 12px;
    font-weight: 600;
  }
  .progress {
    height: 4px;
    background: #ffffff;
    border-radius: 2px;
    overflow: hidden;
  }
  .progress-bar {
    height: 100%;
    background: #175cfa;
    transition: width 240ms ease;
  }
  .completeness-empty .progress-bar {
    background: #b91c1c;
  }
  .completeness-partial .progress-bar {
    background: #d97706;
  }
  .completeness-complete .progress-bar {
    background: #047857;
  }
  .missing {
    font-size: 11px;
    color: #475569;
    margin: 2px 0 0;
    line-height: 1.4;
  }
  .site-row {
    margin-top: 12px;
  }
  .minimal .site-row {
    margin-top: 0;
  }
  .badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 999px;
    letter-spacing: 0.01em;
  }
  .badge-ok {
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #a7f3d0;
  }
  .badge-warn {
    background: #fffbeb;
    color: #b45309;
    border: 1px solid #fde68a;
  }
  .enabled-line {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .enable-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: #f8fafc;
  }
  .enable-text {
    font-size: 12px;
    color: #475569;
    margin: 0;
  }
  .iframe-block {
    padding: 8px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .iframe-block-compact {
    margin-top: 12px;
  }
  .iframe-label {
    font-size: 11px;
    font-weight: 600;
    color: #475569;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .iframe-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .iframe-origin {
    font-size: 12px;
    color: #0f172a;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge-small {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 999px;
    font-weight: 600;
  }
  .badge-ok-small {
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #a7f3d0;
  }
  .mode-controls-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .mode-label {
    font-size: 11px;
    color: #64748b;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .mode-pill {
    padding: 4px 10px;
    font-size: 11px;
    background: #ffffff;
    color: #475569;
    border: 1px solid #e2e8f0;
    border-radius: 999px;
    font-weight: 500;
  }
  .mode-pill:hover:not(:disabled) {
    border-color: #cbd5e1;
    background: #f8fafc;
  }
  .mode-pill-active {
    background: #175cfa;
    color: #ffffff;
    border-color: #175cfa;
  }
  .mode-pill-active:hover:not(:disabled) {
    background: #0f4ad6;
    border-color: #0f4ad6;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .result {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 12px;
  }
  .info {
    font-size: 12px;
    color: #475569;
    margin: 0;
  }
  .info strong {
    color: #0f172a;
    font-weight: 600;
  }
  .fill-progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
  }
  .fill-progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .fill-progress-label {
    font-size: 12px;
    font-weight: 500;
  }
  .fill-progress-pct {
    font-size: 12px;
    color: #475569;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .fill-progress-track {
    height: 6px;
    background: #e2e8f0;
    border-radius: 3px;
    overflow: hidden;
  }
  .fill-progress-bar {
    height: 100%;
    background: #175cfa;
    border-radius: 3px;
    transition: width 180ms ease-out;
  }
  .settings-panel {
    position: absolute;
    top: 60px;
    right: 12px;
    width: 240px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    padding: 4px;
    overflow: hidden;
    box-shadow: 0 6px 24px rgba(15, 23, 42, 0.12);
  }
  .settings-section {
    display: flex;
    flex-direction: column;
  }
  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: transparent;
    border: none;
    padding: 9px 12px;
    font-size: 13px;
    color: #0f172a;
    font-weight: 500;
    border-radius: 6px;
    text-align: left;
  }
  .settings-row:hover:not(:disabled) {
    background: #f1f5f9;
  }
  .settings-row-danger {
    color: #b91c1c;
  }
  .settings-row-danger:hover:not(:disabled) {
    background: #fef2f2;
  }
  .settings-count {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #64748b;
    font-weight: 500;
  }
  .chevron {
    display: inline-block;
    transition: transform 160ms ease;
    color: #94a3b8;
  }
  .chevron[data-open='true'] {
    transform: rotate(90deg);
  }
  .manage-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 8px 8px;
    max-height: 200px;
    overflow-y: auto;
  }
  .manage-empty {
    font-size: 12px;
    color: #94a3b8;
    margin: 0;
    padding: 6px 4px;
  }
  .manage-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px;
    border-radius: 4px;
  }
  .manage-row:hover {
    background: #f8fafc;
  }
  .manage-origin-block {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .manage-origin {
    font-size: 12px;
    color: #0f172a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .manage-mode-badge {
    font-size: 10px;
    color: #64748b;
    font-weight: 500;
  }
  .manage-remove {
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 14px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .manage-remove:hover {
    color: #b91c1c;
    background: #fef2f2;
  }
  .modal-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal-backdrop-btn {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
    border: none;
    padding: 0;
    margin: 0;
    cursor: default;
  }
  .modal {
    position: relative;
    background: #ffffff;
    border-radius: 8px;
    padding: 16px;
    width: 300px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .modal-title {
    font-weight: 600;
    font-size: 14px;
    margin: 0;
  }
  .modal-body {
    font-size: 12px;
    color: #475569;
    margin: 0;
    line-height: 1.5;
  }
  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 4px;
  }
  .mode-choices {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }
  .mode-choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    text-align: left;
  }
  .mode-choice:hover {
    background: #f1f5f9;
    border-color: #cbd5e1;
  }
  .mode-choice-title {
    font-weight: 600;
    font-size: 13px;
    color: #0f172a;
  }
  .mode-choice-desc {
    font-size: 11px;
    color: #64748b;
    line-height: 1.4;
  }
  .footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 10px 16px;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
  }
  .footer-link {
    background: transparent;
    border: none;
    color: #64748b;
    font-size: 11px;
    padding: 4px 6px;
    cursor: pointer;
  }
  .footer-link:hover {
    color: #175cfa;
  }
  .dot {
    color: #cbd5e1;
    font-size: 11px;
  }
</style>