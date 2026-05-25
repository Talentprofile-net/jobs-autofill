<script lang="ts">
  import { ICON_SPARKLES } from './icons'

  type Props = {
    onOpen: () => void
  }
  let { onOpen }: Props = $props()
</script>

<button
  type="button"
  onmousedown={(e) => e.preventDefault()}
  onclick={onOpen}
  title="Insert from TalentProfile"
  aria-label="Insert from TalentProfile"
>
  {@html ICON_SPARKLES}
</button>