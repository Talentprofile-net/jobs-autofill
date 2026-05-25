<script lang="ts">
  import type { FillCounts } from '~/bridge/types'

  type Props = {
    onFillClick: () => Promise<FillCounts>
    onSignInClick: () => Promise<void>
    onOpenEditorClick: () => Promise<void>
    isAuthenticated: () => Promise<boolean>
    isProfileUsable: () => Promise<boolean>
  }

  let {
    onFillClick,
    onSignInClick,
    onOpenEditorClick,
    isAuthenticated,
    isProfileUsable,
  }: Props = $props()

  let busy = $state(false)
  let result = $state<FillCounts | null>(null)
  let lowScoreWarning = $state(false)
  let resultTimer: ReturnType<typeof setTimeout> | null = null

  const RESULT_VISIBLE_MS = 8000

  const clearResultTimer = () => {
    if (resultTimer !== null) {
      clearTimeout(resultTimer)
      resultTimer = null
    }
  }

  const handleClick = async () => {
    if (busy) return
    busy = true
    result = null
    lowScoreWarning = false
    clearResultTimer()
    try {
      const authed = await isAuthenticated()
      if (!authed) {
        await onSignInClick()
        return
      }
      const usable = await isProfileUsable()
      const counts = await onFillClick()
      result = counts
      lowScoreWarning = !usable
      resultTimer = setTimeout(() => {
        result = null
        lowScoreWarning = false
        resultTimer = null
      }, RESULT_VISIBLE_MS)
    } catch (e) {
      console.warn('[TP] form fill failed', e)
    } finally {
      busy = false
    }
  }

  const dismissTooltip = () => {
    clearResultTimer()
    result = null
    lowScoreWarning = false
  }

  const handleEditorClick = (e: MouseEvent) => {
    e.preventDefault()
    void onOpenEditorClick()
  }
</script>

<div class="row">
  <div class="wrap">
    <button
      type="button"
      class="primary"
      disabled={busy}
      onmousedown={(e) => e.preventDefault()}
      onclick={handleClick}
    >
      {#if busy}
        <span class="spinner"></span>
      {/if}
      <span>Fill with TalentProfile</span>
    </button>

    {#if result}
      <div class="tooltip" role="status">
        <div class="tooltip-arrow"></div>
        <button
          type="button"
          class="dismiss"
          aria-label="Dismiss"
          onmousedown={(e) => e.preventDefault()}
          onclick={dismissTooltip}>×</button
        >
        <div class="tooltip-body">
          <div class="counts">
            <span class="count count-filled">{result.filled} filled</span>
            <span class="count count-skipped">{result.skipped} skipped</span>
            {#if result.failed > 0}
              <span class="count count-failed">{result.failed} failed</span>
            {/if}
          </div>
          {#if lowScoreWarning}
            <div class="warning">
              Your profile is incomplete — fill is partial.
              <button
                type="button"
                class="link"
                onmousedown={(e) => e.preventDefault()}
                onclick={handleEditorClick}>Complete profile →</button
              >
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>
