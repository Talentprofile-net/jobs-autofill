<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { DragGesture } from '@use-gesture/vanilla'
  import type { PickerContext } from './pickerController'
  import {
    buildMenuTree,
    type MenuGroup,
    type MenuLeaf,
    type MenuNode,
  } from './menuTree'
  import { insertIntoField } from './insertion'
  import {
    createNote,
    deleteNote,
    getAuthStatus,
    getProfile,
    requestClassifierSuggestion,
    requestSignIn,
    touchNote,
    updateNote,
  } from '~/bridge/mainBridge'
  import type { Profile, ProfileNote } from '~/api/types'
  import { fieldByUuid } from '~/field/registry'
  import {
    createSuggestionLoader,
    rowForField,
    suggestionRequestFor,
    type FieldSuggestion,
  } from './suggestion'
  import {
    ICON_ARROW_LEFT,
    ICON_LOGO,
    ICON_PENCIL,
    ICON_PLUS,
    ICON_SEARCH,
    ICON_TRASH,
  } from './icons'

  type Props = {
    ctx: PickerContext
    onClose: () => void
    mobile: boolean
  }

  let { ctx, onClose, mobile }: Props = $props()

  const NOTE_MAX_LENGTH = 4000

  const pathKeySegment = (): string => {
    const path = location.pathname
    const cleaned = path.replace(/\/+$/, '').replace(/^\//, '')
    if (!cleaned) return 'root'
    const segments = cleaned.split('/').slice(0, 3)
    return segments.join('/') || 'root'
  }

  const STORAGE_KEY = `tp.picker.path.${location.hostname}.${pathKeySegment()}`
  const SWIPE_REVEAL_PX = 96
  const TRUNCATION_TOAST_MS = 3200

  type Mode = 'browse' | 'compose'
  type ComposeTarget = { kind: 'new' } | { kind: 'edit'; noteId: string }
  type AuthState = 'checking' | 'unauthenticated' | 'authenticated'

  let authState = $state<AuthState>('checking')
  let profile = $state<Profile | null>(null)
  let tree = $state<MenuGroup | null>(null)
  let path = $state<string[]>([])
  let search = $state('')
  let searchVisible = $state(false)
  let activeIndex = $state(0)
  let mode = $state<Mode>('browse')
  let composeTarget = $state<ComposeTarget>({ kind: 'new' })
  let composeText = $state('')
  let composeError = $state<string | null>(null)
  let composing = $state(false)
  let flashNoteId = $state<string | null>(null)
  let loadError = $state<string | null>(null)
  let searchInput: HTMLInputElement | null = $state(null)
  let composeTextarea: HTMLTextAreaElement | null = $state(null)
  let listEl: HTMLDivElement | null = $state(null)
  let truncationToast = $state<string | null>(null)
  let truncationTimer: ReturnType<typeof setTimeout> | null = null
  let flashTimer: ReturnType<typeof setTimeout> | null = null

  let confirmDeleteId = $state<string | null>(null)
  let revealedSwipeId = $state<string | null>(null)
  let pendingDeleteError = $state<string | null>(null)
  let suggestion = $state<FieldSuggestion | null>(null)
  const suggestionRow = $derived(rowForField(suggestion, ctx.fieldUuid))
  const suggestionLoader = createSuggestionLoader(requestClassifierSuggestion, (next) => {
    suggestion = next
  })

  let listSwipeGesture: DragGesture | null = null
  let swipeStartX = 0
  let swipeCurrentRow: HTMLElement | null = null
  let swipeCurrentItemId: string | null = null

  const loadProfile = async () => {
    try {
      const p = await getProfile()
      if (!p) {
        loadError = 'Profile unavailable'
        return
      }
      profile = p
      tree = buildMenuTree(p, ctx.pickerMode)
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as string[]
          if (Array.isArray(parsed)) path = parsed
        } catch {}
      }
    } catch (e) {
      loadError = (e as Error).message
    }
  }

  const initialize = async () => {
    authState = 'checking'
    loadError = null
    try {
      const status = await getAuthStatus()
      if (!status.authenticated) {
        authState = 'unauthenticated'
        return
      }
      authState = 'authenticated'
      void loadSuggestion()
      await loadProfile()
    } catch (e) {
      loadError = (e as Error).message
      authState = 'authenticated'
    }
  }

  const loadSuggestion = () =>
    suggestionLoader.load(ctx.fieldUuid, () => suggestionRequestFor(ctx))

  const applySuggestion = async () => {
    const row = suggestionRow
    const field = fieldByUuid(ctx.fieldUuid)
    if (!row || !field) return
    await field.fillFromResolved(row.value, true)
    onClose()
  }

  onMount(() => {
    void initialize()

    return () => {
      suggestionLoader.close()
      if (truncationTimer) clearTimeout(truncationTimer)
      if (flashTimer) clearTimeout(flashTimer)
      listSwipeGesture?.destroy()
    }
  })

  const handleSignInClick = () => {
    requestSignIn()
    onClose()
  }

  const handleRetry = () => {
    void initialize()
  }

  const persistPath = (newPath: string[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newPath))
    } catch {}
  }

  const findGroupAt = (root: MenuGroup, keys: string[]): MenuGroup | null => {
    let node: MenuGroup = root
    for (const key of keys) {
      const next = node.children.find((c) => c.id === key)
      if (!next || next.kind !== 'group') return null
      node = next
    }
    return node
  }

  const currentGroup = $derived.by((): MenuGroup | null => {
    if (!tree) return null
    return findGroupAt(tree, path) ?? tree
  })

  $effect(() => {
    if (!tree) return
    const exists = findGroupAt(tree, path)
    if (!exists && path.length > 0) {
      path = []
      persistPath([])
    }
  })

  const flattenLeaves = (node: MenuNode, acc: MenuLeaf[] = []): MenuLeaf[] => {
    if (node.kind === 'leaf') {
      acc.push(node)
    } else {
      for (const child of node.children) flattenLeaves(child, acc)
    }
    return acc
  }

  const searchMatch = (text: string, query: string): boolean => {
    const t = text.toLowerCase()
    const q = query.toLowerCase().trim()
    if (!q) return true
    if (t.includes(q)) return true
    const initials = text
      .split(/\s+/)
      .map((w) => w[0]?.toLowerCase() ?? '')
      .join('')
    if (initials.includes(q)) return true
    return false
  }

  const visibleItems = $derived.by((): MenuNode[] => {
    if (!tree) return []
    if (search.trim()) {
      const all = flattenLeaves(tree)
      return all.filter(
        (leaf) =>
          searchMatch(leaf.label, search) || searchMatch(leaf.value, search),
      )
    }
    return currentGroup?.children ?? []
  })

  $effect(() => {
    if (activeIndex >= visibleItems.length) activeIndex = 0
  })

  const refreshTreeFromProfile = () => {
    if (profile) tree = buildMenuTree(profile, ctx.pickerMode)
  }

  const showTruncationToast = (maxLength: number) => {
    truncationToast = `Note truncated to ${maxLength} characters to fit field.`
    if (truncationTimer) clearTimeout(truncationTimer)
    truncationTimer = setTimeout(() => {
      truncationToast = null
      truncationTimer = null
    }, TRUNCATION_TOAST_MS)
  }

  const handleSelect = async (item: MenuNode) => {
    if (item.kind === 'group') {
      const newPath = [...path, item.id]
      path = newPath
      persistPath(newPath)
      search = ''
      searchVisible = false
      activeIndex = 0
      return
    }
    const result = insertIntoField(ctx.field, item.value)
    if (result.inserted && item.noteId) {
      void touchNote(item.noteId)
    }
    if (result.truncated && result.maxLength) {
      showTruncationToast(result.maxLength)
      return
    }
    onClose()
  }

  const handleBack = async () => {
    if (mode === 'compose') {
      mode = 'browse'
      composeError = null
      return
    }
    if (search.trim() || searchVisible) {
      search = ''
      searchVisible = false
      activeIndex = 0
      return
    }
    if (path.length === 0) {
      onClose()
      return
    }
    const newPath = path.slice(0, -1)
    path = newPath
    persistPath(newPath)
    activeIndex = 0
  }

  const toggleSearch = async () => {
    if (mode !== 'browse') return
    searchVisible = !searchVisible
    if (searchVisible) {
      await tick()
      searchInput?.focus()
    } else {
      search = ''
    }
  }

  const enterComposeNew = async () => {
    mode = 'compose'
    composeTarget = { kind: 'new' }
    composeText = ''
    composeError = null
    await tick()
    composeTextarea?.focus()
  }

  const enterComposeEdit = async (note: ProfileNote) => {
    mode = 'compose'
    composeTarget = { kind: 'edit', noteId: note.id }
    composeText = note.content
    composeError = null
    revealedSwipeId = null
    await tick()
    composeTextarea?.focus()
  }

  const handleSaveCompose = async () => {
    const content = composeText.trim()
    if (!content) {
      composeError = 'Content is required'
      return
    }
    if (content.length > NOTE_MAX_LENGTH) {
      composeError = `Content exceeds ${NOTE_MAX_LENGTH} characters`
      return
    }
    composing = true
    composeError = null
    try {
      if (composeTarget.kind === 'new') {
        const result = await createNote(content)
        if (!result.note) {
          composeError = result.error ?? 'Failed to save'
          composing = false
          return
        }
        const newNote: ProfileNote = result.note
        if (profile) {
          const existing = profile.talentNotes ?? []
          profile = { ...profile, talentNotes: [newNote, ...existing] }
          refreshTreeFromProfile()
        }
        flashNoteId = `nt.${newNote.id}`
        composing = false
        mode = 'browse'
        composeText = ''
        const newPath = ctx.pickerMode === 'notesOnly' ? [] : ['notes']
        path = newPath
        persistPath(newPath)
        search = ''
        searchVisible = false
        const idx =
          currentGroup?.children.findIndex((c) => c.id === flashNoteId) ?? 0
        activeIndex = Math.max(0, idx)
        await tick()
        const target = listEl?.querySelector(
          `[data-tp-item-id="${flashNoteId}"]`,
        )
        target?.scrollIntoView({ block: 'nearest' })
        if (flashTimer) clearTimeout(flashTimer)
        flashTimer = setTimeout(() => {
          flashNoteId = null
          flashTimer = null
        }, 1600)
      } else {
        const editId = composeTarget.noteId
        const result = await updateNote(editId, content)
        if (!result.note) {
          composeError = result.error ?? 'Failed to save'
          composing = false
          return
        }
        const updated: ProfileNote = result.note
        if (profile) {
          const existing = profile.talentNotes ?? []
          const next = existing.map((n) => (n.id === editId ? updated : n))
          profile = { ...profile, talentNotes: next }
          refreshTreeFromProfile()
        }
        flashNoteId = `nt.${editId}`
        composing = false
        mode = 'browse'
        composeText = ''
        await tick()
        if (flashTimer) clearTimeout(flashTimer)
        flashTimer = setTimeout(() => {
          flashNoteId = null
          flashTimer = null
        }, 1600)
      }
    } catch (e) {
      composeError = (e as Error).message
      composing = false
    }
  }

  const handleCancelCompose = async () => {
    mode = 'browse'
    composeText = ''
    composeError = null
  }

  const askConfirmDelete = (noteId: string) => {
    confirmDeleteId = noteId
    pendingDeleteError = null
  }

  const cancelConfirmDelete = () => {
    confirmDeleteId = null
    pendingDeleteError = null
  }

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return
    const targetId = confirmDeleteId
    pendingDeleteError = null
    const result = await deleteNote(targetId)
    if (!result.deletedId) {
      pendingDeleteError = result.error ?? 'Failed to delete'
      return
    }
    if (profile) {
      const existing = profile.talentNotes ?? []
      profile = {
        ...profile,
        talentNotes: existing.filter((n) => n.id !== targetId),
      }
      refreshTreeFromProfile()
    }
    confirmDeleteId = null
    revealedSwipeId = null
    pendingDeleteError = null
  }

  const handleKey = (e: KeyboardEvent) => {
    if (mode === 'compose') return
    if (confirmDeleteId) {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelConfirmDelete()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIndex = Math.min(visibleItems.length - 1, activeIndex + 1)
      revealedSwipeId = null
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIndex = Math.max(0, activeIndex - 1)
      revealedSwipeId = null
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = visibleItems[activeIndex]
      if (item) void handleSelect(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowLeft' && !search.trim() && path.length > 0) {
      e.preventDefault()
      void handleBack()
    } else if (e.key === 'ArrowRight' && !search.trim()) {
      e.preventDefault()
      const item = visibleItems[activeIndex]
      if (item?.kind === 'group') void handleSelect(item)
    } else if (e.key === '/' && !searchVisible && !search.trim()) {
      e.preventDefault()
      void toggleSearch()
    }
  }

  const handleComposeKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      void handleCancelCompose()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSaveCompose()
    }
  }

  const headerTitle = $derived.by(() => {
    if (authState === 'unauthenticated') return 'TalentProfile'
    if (mode === 'compose') {
      return composeTarget.kind === 'edit' ? 'Edit note' : 'New note'
    }
    if (search.trim()) return 'Search'
    if (path.length === 0) return 'TalentProfile'
    return currentGroup?.label ?? 'TalentProfile'
  })

  const showBackButton = $derived(
    authState === 'authenticated' &&
      (mode === 'compose' ||
        path.length > 0 ||
        !!search.trim() ||
        searchVisible),
  )

  const showAddNoteRow = $derived(
    authState === 'authenticated' &&
      mode === 'browse' &&
      !search.trim() &&
      currentGroup?.allowAdd === 'note',
  )

  const charCountLabel = $derived(`${composeText.length}/${NOTE_MAX_LENGTH}`)
  const overLimit = $derived(composeText.length > NOTE_MAX_LENGTH)

  let rootEl: HTMLDivElement | null = $state(null)
  $effect(() => {
    const el = rootEl
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (authState !== 'authenticated') {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        }
        return
      }
      if (mode === 'compose') return
      handleKey(e)
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  })

  const isNoteLeaf = (item: MenuNode): item is MenuLeaf =>
    item.kind === 'leaf' && !!item.noteId

  const findItemRow = (
    target: EventTarget | null,
  ): {
    el: HTMLElement
    itemId: string
  } | null => {
    if (!(target instanceof Element)) return null
    const wrap = target.closest('[data-tp-item-wrap]') as HTMLElement | null
    if (!wrap) return null
    const itemId = wrap.getAttribute('data-tp-item-id')
    const itemKind = wrap.getAttribute('data-tp-item-kind')
    if (!itemId || itemKind !== 'note-leaf') return null
    return { el: wrap, itemId }
  }

  $effect(() => {
    if (!mobile || !listEl) return
    if (listSwipeGesture) {
      listSwipeGesture.destroy()
      listSwipeGesture = null
    }
    listSwipeGesture = new DragGesture(
      listEl,
      ({ first, last, movement: [mx], cancel, event }) => {
        if (first) {
          const target = event.target as HTMLElement | null
          if (target?.closest('[data-tp-row-action]')) {
            cancel?.()
            return
          }
          const row = findItemRow(event.target)
          if (!row) {
            cancel?.()
            return
          }
          swipeStartX = mx
          swipeCurrentRow = row.el
          swipeCurrentItemId = row.itemId
          return
        }
        if (!swipeCurrentRow) return
        const dx = mx - swipeStartX
        if (last) {
          if (dx < -SWIPE_REVEAL_PX / 2) {
            revealedSwipeId = swipeCurrentItemId
          } else if (dx > SWIPE_REVEAL_PX / 2) {
            revealedSwipeId = null
          }
          swipeCurrentRow.style.removeProperty('--tp-swipe-offset')
          swipeCurrentRow = null
          swipeCurrentItemId = null
          return
        }
        const clamped = Math.max(
          -SWIPE_REVEAL_PX - 24,
          Math.min(SWIPE_REVEAL_PX / 4, dx),
        )
        swipeCurrentRow.style.setProperty('--tp-swipe-offset', `${clamped}px`)
      },
      { axis: 'x', filterTaps: true, threshold: 6 },
    )
    return () => {
      listSwipeGesture?.destroy()
      listSwipeGesture = null
    }
  })

  const noteFromLeaf = (leaf: MenuLeaf): ProfileNote | null => {
    if (!profile || !leaf.noteId) return null
    return profile.talentNotes?.find((n) => n.id === leaf.noteId) ?? null
  }

  const handleRowClick = (item: MenuNode) => {
    if (revealedSwipeId && isNoteLeaf(item) && item.id === revealedSwipeId) {
      revealedSwipeId = null
      return
    }
    void handleSelect(item)
  }

  const handleEditClick = (leaf: MenuLeaf) => {
    const note = noteFromLeaf(leaf)
    if (note) void enterComposeEdit(note)
  }

  const handleDeleteClick = (leaf: MenuLeaf) => {
    if (leaf.noteId) askConfirmDelete(leaf.noteId)
  }
</script>

{#if mobile}
  <div
    class="backdrop"
    data-tp-shown="true"
    onclick={onClose}
    role="presentation"
  ></div>
{/if}

<div
  class="popover"
  role="dialog"
  aria-label="Insert from TalentProfile"
  tabindex="-1"
  bind:this={rootEl}
>
  <div class="header">
    {#if showBackButton}
      <button
        class="icon-btn"
        type="button"
        onmousedown={(e) => e.preventDefault()}
        onclick={handleBack}
        aria-label="Back">{@html ICON_ARROW_LEFT}</button
      >
    {:else}
      <span class="header-logo">{@html ICON_LOGO}</span>
    {/if}
    <span class="title">{headerTitle}</span>
    {#if authState === 'authenticated' && mode === 'browse'}
      <button
        class="icon-btn"
        type="button"
        data-tp-active={searchVisible ? 'true' : 'false'}
        onmousedown={(e) => e.preventDefault()}
        onclick={toggleSearch}
        aria-label="Search">{@html ICON_SEARCH}</button
      >
    {/if}
  </div>

  {#if authState === 'checking'}
    <div class="empty">Loading…</div>
  {:else if authState === 'unauthenticated'}
    <div class="signin">
      <p class="signin-text">
        Sign in to TalentProfile to use snippets and autofill.
      </p>
      <button
        type="button"
        class="btn btn-primary"
        onmousedown={(e) => e.preventDefault()}
        onclick={handleSignInClick}>Sign in</button
      >
    </div>
  {:else if mode === 'browse'}
    <div class="search-row" data-tp-shown={searchVisible ? 'true' : 'false'}>
      <input
        bind:this={searchInput}
        bind:value={search}
        onkeydown={handleKey}
        class="search"
        type="text"
        placeholder="Search…"
        autocomplete="off"
        spellcheck="false"
      />
    </div>

    <div class="list" role="listbox" bind:this={listEl}>
      {#if loadError}
        <div class="empty">
          {loadError}
          <div class="retry-row">
            <button
              type="button"
              class="btn btn-secondary"
              onmousedown={(e) => e.preventDefault()}
              onclick={handleRetry}>Try again</button
            >
          </div>
        </div>
      {:else if !tree}
        <div class="empty">Loading…</div>
      {:else}
        {#if suggestionRow && path.length === 0 && !search.trim()}
          <button
            type="button"
            class="item"
            data-tp-suggestion="true"
            onmousedown={(e) => e.preventDefault()}
            onclick={applySuggestion}
          >
            <div class="item-label">
              <span class="label-text">{suggestionRow.title}</span>
              <span class="value">Suggested answer</span>
            </div>
          </button>
        {/if}
        {#if showAddNoteRow}
          <button
            type="button"
            class="item"
            onmousedown={(e) => e.preventDefault()}
            onclick={enterComposeNew}
          >
            <span class="item-icon">{@html ICON_PLUS}</span>
            <div class="item-label">
              <span class="label-text">Add note</span>
            </div>
          </button>
        {/if}

        {#if visibleItems.length === 0}
          {#if currentGroup?.emptyHint && !search.trim()}
            <div class="empty">{currentGroup.emptyHint}</div>
          {:else}
            <div class="empty">
              {search.trim() ? 'No matches' : 'Nothing here'}
            </div>
          {/if}
        {:else}
          {#each visibleItems as item, i (item.id)}
            {@const itemIsNote = isNoteLeaf(item)}
            {@const isRevealed = revealedSwipeId === item.id}
            {@const isConfirming =
              itemIsNote && confirmDeleteId === item.noteId}
            <div
              class="item-wrap"
              data-tp-item-wrap="true"
              data-tp-item-id={item.id}
              data-tp-item-kind={itemIsNote ? 'note-leaf' : 'other'}
              data-tp-revealed={isRevealed ? 'true' : 'false'}
            >
              <div
                class="row-actions"
                data-tp-visible={itemIsNote ? 'true' : 'false'}
              >
                {#if itemIsNote}
                  <button
                    type="button"
                    class="row-action row-action-edit"
                    data-tp-row-action="edit"
                    aria-label="Edit note"
                    onmousedown={(e) => e.preventDefault()}
                    onclick={(e) => {
                      e.stopPropagation()
                      handleEditClick(item)
                    }}
                  >
                    {@html ICON_PENCIL}
                  </button>
                  <button
                    type="button"
                    class="row-action row-action-delete"
                    data-tp-row-action="delete"
                    aria-label="Delete note"
                    onmousedown={(e) => e.preventDefault()}
                    onclick={(e) => {
                      e.stopPropagation()
                      handleDeleteClick(item)
                    }}
                  >
                    {@html ICON_TRASH}
                  </button>
                {/if}
              </div>

              {#if isConfirming}
                <div class="confirm-row">
                  <span class="confirm-text">Delete this note?</span>
                  <div class="confirm-buttons">
                    <button
                      type="button"
                      class="confirm-btn confirm-cancel"
                      onmousedown={(e) => e.preventDefault()}
                      onclick={cancelConfirmDelete}>Cancel</button
                    >
                    <button
                      type="button"
                      class="confirm-btn confirm-yes"
                      onmousedown={(e) => e.preventDefault()}
                      onclick={handleConfirmDelete}>Delete</button
                    >
                  </div>
                  {#if pendingDeleteError}
                    <span class="confirm-error">{pendingDeleteError}</span>
                  {/if}
                </div>
              {:else}
                <button
                  type="button"
                  class="item item-with-actions"
                  data-tp-active={i === activeIndex ? 'true' : 'false'}
                  data-tp-flash={flashNoteId === item.id ? 'true' : 'false'}
                  data-tp-is-note={itemIsNote ? 'true' : 'false'}
                  onmousedown={(e) => e.preventDefault()}
                  onmouseenter={() => (activeIndex = i)}
                  onclick={() => handleRowClick(item)}
                  role="option"
                  aria-selected={i === activeIndex}
                >
                  <div class="item-label">
                    <span class="label-text">{item.label}</span>
                    {#if item.kind === 'leaf'}
                      <span class="value">{item.preview}</span>
                    {/if}
                  </div>
                  {#if item.kind === 'group'}
                    <span class="item-chevron">›</span>
                  {/if}
                </button>
              {/if}
            </div>
          {/each}
        {/if}
      {/if}
    </div>

    {#if truncationToast}
      <div class="empty toast-warn" role="status">
        {truncationToast}
      </div>
    {/if}
  {:else}
    <div class="compose">
      <textarea
        bind:this={composeTextarea}
        bind:value={composeText}
        onkeydown={handleComposeKey}
        placeholder="Write your note. It will be searchable and insertable into any text field."
        spellcheck="true"
        disabled={composing}
      ></textarea>
      <div class="compose-meta">
        <span>⌘/Ctrl + Enter to save</span>
        <span class:over={overLimit}>{charCountLabel}</span>
      </div>
      {#if composeError}
        <div class="compose-error">{composeError}</div>
      {/if}
      <div class="compose-actions">
        <button
          type="button"
          class="btn btn-secondary"
          onmousedown={(e) => e.preventDefault()}
          onclick={handleCancelCompose}
          disabled={composing}>Cancel</button
        >
        <button
          type="button"
          class="btn btn-primary"
          onmousedown={(e) => e.preventDefault()}
          onclick={handleSaveCompose}
          disabled={composing || overLimit || !composeText.trim()}
          >{composing ? 'Saving…' : 'Save'}</button
        >
      </div>
    </div>
  {/if}
</div>
