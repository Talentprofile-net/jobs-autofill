<script lang="ts">
  import { ICON_LOGO } from './icons'
  import type { PickerApi } from './pickerApi'

  let { api }: { api: PickerApi } = $props()
  let busy = $state(false)

  const confirm = async () => {
    if (busy) return
    busy = true
    if (!(await api.confirmFill())) busy = false
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      api.dismiss()
    }
  }
</script>

<div class="popover" role="dialog" aria-label="Fill this form with TalentProfile" tabindex="-1" onkeydown={onKey}>
  <div class="header">
    <span class="header-logo">{@html ICON_LOGO}</span>
    <span class="title">Fill this form?</span>
  </div>
  <div class="signin">
    <p class="signin-text">Uses your TalentProfile, including your saved CV.</p>
    <div class="confirm-buttons">
      <button type="button" class="btn btn-primary" data-tp-confirm-fill="true" disabled={busy} onclick={confirm}>Fill form</button>
      <button type="button" class="btn btn-secondary" onclick={() => api.dismiss()}>Cancel</button>
    </div>
  </div>
</div>
