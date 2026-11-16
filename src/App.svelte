<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import {
    BUILTIN_SOUNDS, PRESETS, effectiveVolume, sortFavoritesFirst,
    parseSleepTimer, formatCountdown, type SoundDef,
  } from '$lib/library'
  import { listImports, putImport, deleteImport } from '$lib/db'
  import { cycleTheme } from '$lib/theme'

  interface CustomProfile { id: string; name: string; levels: Record<string, number> }

  const STORAGE = {
    levels: 'soundnest:levels',
    master: 'soundnest:master',
    favorites: 'soundnest:favorites',
    profiles: 'soundnest:profiles',
    prev: 'soundnest:prev',
  }

  function load<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch { return fallback }
  }
  const persist = (key: string, v: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* quota — ignore */ }
  }

  let sounds = $state<SoundDef[]>([...BUILTIN_SOUNDS])
  let levels = $state<Record<string, number>>(load(STORAGE.levels, {}))
  let prevLevels = $state<Record<string, number>>(load(STORAGE.prev, {}))
  let master = $state<number>(load(STORAGE.master, 80))
  let playing = $state(false)
  let favorites = $state<Set<string>>(new Set(load<string[]>(STORAGE.favorites, [])))
  let filter = $state<'all' | 'fav'>('all')
  let profiles = $state<CustomProfile[]>(load(STORAGE.profiles, []))
  let profileName = $state('')
  let timerChoice = $state('off')
  let customMinutes = $state('20')
  let timerEndAt = $state<number | null>(null)
  let remainingSec = $state(0)
  let fadeGain = $state(1)
  let toast = $state('')
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let fileInput: HTMLInputElement | undefined

  const audioEls = new Map<string, HTMLAudioElement>()
  let tickHandle: ReturnType<typeof setInterval> | undefined
  let fadeHandle = 0

  const activePreset = $derived(
    PRESETS.find((p) => mixEquals(p.levels, levels)) ??
    profiles.find((p) => mixEquals(p.levels, levels))
  )
  const visible = $derived(
    sortFavoritesFirst(
      filter === 'fav' ? sounds.filter((s) => favorites.has(s.id)) : sounds,
      favorites
    )
  )
  const activeCount = $derived(Object.values(levels).filter((v) => v > 0).length)

  function mixEquals(a: Record<string, number>, b: Record<string, number>): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      if ((a[k] ?? 0) !== (b[k] ?? 0)) return false
    }
    return true
  }

  function showToast(msg: string) {
    toast = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast = ''), 3200)
  }

  function getAudio(def: SoundDef): HTMLAudioElement {
    let el = audioEls.get(def.id)
    if (!el) {
      el = new Audio()
      el.loop = true
      el.preload = 'auto'
      el.src = def.src
      audioEls.set(def.id, el)
    }
    return el
  }

  async function applyVolumes() {
    for (const def of sounds) {
      const el = audioEls.get(def.id)
      if (!el) continue
      const level = levels[def.id] ?? 0
      el.volume = effectiveVolume(level, master) * fadeGain
      if (playing && level > 0) {
        if (el.paused) {
          try { await el.play() } catch { showToast(`Could not play ${def.name}`) }
        }
      } else if (!el.paused) {
        el.pause()
      }
    }
  }

  $effect(() => {
    // react to levels/master/playing/fadeGain
    void [levels, master, playing, fadeGain]
    applyVolumes()
    persist(STORAGE.levels, levels)
    persist(STORAGE.master, master)
  })

  async function togglePlayAll() {
    playing = !playing
  }

  function toggleSound(id: string) {
    const cur = levels[id] ?? 0
    if (cur > 0) {
      prevLevels = { ...prevLevels, [id]: cur }
      levels = { ...levels, [id]: 0 }
    } else {
      levels = { ...levels, [id]: prevLevels[id] ?? 60 }
    }
    persist(STORAGE.prev, prevLevels)
  }

  function setLevel(id: string, value: number) {
    levels = { ...levels, [id]: Math.max(0, Math.min(100, Math.round(value))) }
  }

  function toggleFavorite(id: string) {
    const next = new Set(favorites)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    favorites = next
    persist(STORAGE.favorites, [...next])
  }

  function applyLevels(next: Record<string, number>) {
    const full: Record<string, number> = {}
    for (const s of sounds) full[s.id] = next[s.id] ?? 0
    levels = full
    playing = true
  }

  function saveProfile() {
    const name = profileName.trim()
    if (!name) return
    const profile: CustomProfile = { id: `custom:${Date.now()}`, name, levels: { ...levels } }
    profiles = [profile, ...profiles]
    persist(STORAGE.profiles, profiles)
    profileName = ''
    showToast(`Profile “${name}” saved`)
  }

  function removeProfile(id: string) {
    profiles = profiles.filter((p) => p.id !== id)
    persist(STORAGE.profiles, profiles)
  }

  function startTimer(minutes: number) {
    timerEndAt = Date.now() + minutes * 60_000
    remainingSec = minutes * 60
    showToast(`Sleep timer set for ${minutes} min`)
  }

  function cancelTimer() {
    timerEndAt = null
    remainingSec = 0
    cancelAnimationFrame(fadeHandle)
    fadeGain = 1
  }

  function onTimerChange() {
    cancelTimer()
    if (timerChoice === 'off') return
    const minutes = timerChoice === 'custom' ? parseSleepTimer(customMinutes) : parseSleepTimer(timerChoice)
    if (minutes > 0) startTimer(minutes)
  }

  function tick() {
    if (timerEndAt === null) return
    const left = Math.round((timerEndAt - Date.now()) / 1000)
    remainingSec = Math.max(0, left)
    if (left <= 0) {
      timerEndAt = null
      // fade master → 0 over 3 s, then stop everything
      const from = fadeGain
      const start = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 3000)
        fadeGain = from * (1 - t)
        if (t < 1) {
          fadeHandle = requestAnimationFrame(step)
        } else {
          playing = false
          fadeGain = 1
          showToast('Sleep timer finished — good night 🌙')
        }
      }
      fadeHandle = requestAnimationFrame(step)
    }
  }

  async function onImportFiles(e: Event) {
    const input = e.target as HTMLInputElement
    const files = [...(input.files ?? [])]
    if (!files.length) return
    let added = 0
    for (const file of files) {
      if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i)) {
        showToast(`Skipped “${file.name}” — not an audio file`)
        continue
      }
      if (file.size > 25 * 1024 * 1024) {
        showToast(`Skipped “${file.name}” — larger than 25 MB`)
        continue
      }
      const id = `imported:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
      try {
        await putImport({ id, name: file.name.replace(/\.[^.]+$/, ''), blob: file, addedAt: Date.now() })
        const url = URL.createObjectURL(file)
        sounds = [...sounds, { id, name: file.name.replace(/\.[^.]+$/, ''), src: url, kind: 'imported' }]
        levels = { ...levels, [id]: 70 }
        added++
      } catch (err) {
        showToast(`Could not import “${file.name}”`)
        console.error(err)
      }
    }
    if (added) showToast(`Imported ${added} sound${added > 1 ? 's' : ''}`)
    input.value = ''
  }

  async function removeImported(id: string) {
    try {
      await deleteImport(id)
    } catch {
      showToast('Could not delete from storage')
      return
    }
    const el = audioEls.get(id)
    if (el) { el.pause(); el.src = ''; audioEls.delete(id) }
    sounds = sounds.filter((s) => s.id !== id)
    const nextLevels = { ...levels }
    delete nextLevels[id]
    levels = nextLevels
    favorites = new Set([...favorites].filter((f) => f !== id))
    persist(STORAGE.favorites, [...favorites])
  }

  function iconFor(id: string): string {
    switch (id) {
      case 'rain': return 'M7 10a4.5 4.5 0 0 1 8.6-1.8M6 14h12M8 17l-1 2.5M12 17l-1 2.5M16 17l-1 2.5' // cloud + rain
      case 'ocean': return 'M3 12c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0M3 17c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0M3 7c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0' // waves
      case 'wind': return 'M3 9h9a3 3 0 1 0-3-3M3 13h14a3 3 0 1 1-3 3M3 17h7' // gusts
      case 'stream': return 'M9 3l-3 6 5 4-4 5M15 3l-3 6 5 4-4 5' // river zigzag
      case 'fireplace': return 'M12 21c-3 0-5-2-5-4.5 0-2 1-3.5 2-5 .3 1.2 1.3 2 2.3 2 .2-2-.4-4.5-2.3-6.5 3.3.8 6 3.8 6 7 0 3-1.3 7-3 7z' // flame
      case 'storm': return 'M7 9a4.5 4.5 0 0 1 8.6-1.8M13 12l-2.5 4h4L12 20M6 12h2' // cloud + bolt
      case 'crickets': return 'M15 4a6 6 0 1 0 5 8M9 4l3 3M8 8l4 1M11 13h6' // moon + antenna-ish
      case 'cafe': return 'M5 9h11v5a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4zM16 10h2a2 2 0 0 1 0 4h-2' // cup
      default: return 'M12 12a2.5 2.5 0 1 0 0 .01M12 4v4M12 16v4' // note-ish dot
    }
  }

  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement
    const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
    if (e.code === 'Space' && !inField) {
      e.preventDefault()
      togglePlayAll()
      return
    }
    if (inField) return
    if (e.key === '+' || e.key === '=') master = Math.min(100, master + 5)
    else if (e.key === '-') master = Math.max(0, master - 5)
    else {
      const idx = Number.parseInt(e.key, 10) - 1
      const builtin = BUILTIN_SOUNDS[idx]
      if (builtin) toggleSound(builtin.id)
    }
  }

  onMount(async () => {
    // hydrate imported sounds from IndexedDB
    try {
      const imports = await listImports()
      const imported: SoundDef[] = imports.map((r) => ({
        id: r.id, name: r.name, src: URL.createObjectURL(r.blob), kind: 'imported',
      }))
      sounds = [...BUILTIN_SOUNDS, ...imported]
    } catch (err) {
      console.error('SoundNest: failed to read imports', err)
    }
    document.addEventListener('keydown', onKeydown)
    tickHandle = setInterval(tick, 500)
  })

  onDestroy(() => {
    document.removeEventListener('keydown', onKeydown)
    clearInterval(tickHandle)
    cancelAnimationFrame(fadeHandle)
    for (const el of audioEls.values()) el.pause()
  })
</script>

<div class="app">
  <header class="topbar" data-tauri-drag-region>
    <div class="brand" data-tauri-drag-region>
      <span class="logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M4 10v4M8.5 7v10M13 4v16M17.5 8v8M22 11v2"/>
        </svg>
      </span>
      <div class="brand-text" data-tauri-drag-region>
        <h1>SoundNest</h1>
        <p>ambient mixer</p>
      </div>
    </div>

    <div class="master">
      <button class="play-btn" class:is-playing={playing} onclick={togglePlayAll}
        title={playing ? 'Pause all (Space)' : 'Play all (Space)'} aria-label={playing ? 'Pause' : 'Play'}>
        {#if playing}
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5.5v13c0 1.2 1.3 1.9 2.3 1.3l10-6.5a1.5 1.5 0 0 0 0-2.6l-10-6.5A1.5 1.5 0 0 0 8 5.5z"/></svg>
        {/if}
      </button>
      <div class="master-vol">
        <span class="vol-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 10v4h3l4 3.5v-11L7 10H4z" fill="currentColor" stroke="none"/><path d="M14 9.5a4 4 0 0 1 0 5M16.5 7a7.5 7.5 0 0 1 0 10"/></svg>
        </span>
        <input type="range" min="0" max="100" bind:value={master} aria-label="Master volume" />
      </div>
      <div class="timer" title="Sleep timer — fades out and pauses everything">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13" r="7.5"/><path d="M12 9.5v3.5l2.2 1.5M9.5 3h5"/></svg>
        <select class="timer-select" bind:value={timerChoice} onchange={onTimerChange} aria-label="Sleep timer">
          <option value="off">Off</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="45">45 min</option>
          <option value="60">60 min</option>
          <option value="90">90 min</option>
          <option value="custom">Custom…</option>
        </select>
        {#if timerChoice === 'custom'}
          <input class="custom-min" type="number" min="1" max="720" bind:value={customMinutes} onchange={onTimerChange} aria-label="Custom minutes" />
        {/if}
        {#if timerEndAt !== null}
          <span class="countdown mono">{formatCountdown(remainingSec)}</span>
          <button class="icon-btn" onclick={cancelTimer} title="Cancel sleep timer" aria-label="Cancel sleep timer">✕</button>
        {/if}
      </div>
    </div>

    <button class="icon-btn theme-btn" onclick={cycleTheme} title="Cycle theme (system → light → dark)" aria-label="Cycle theme">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></svg>
    </button>
  </header>

  <div class="body">
    <aside class="sidebar">
      <div class="side-section">
        <div class="side-title"><span>SOUND LIBRARY</span>
          <div class="side-tools">
            <button class="chip-btn" class:active={filter === 'all'} onclick={() => (filter = 'all')}>All</button>
            <button class="chip-btn" class:active={filter === 'fav'} onclick={() => (filter = 'fav')}>★ Favorites</button>
          </div>
        </div>
        <button class="import-btn" onclick={() => fileInput?.click()}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V6M8.5 9.5L12 6l3.5 3.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
          Import audio…
        </button>
        <input bind:this={fileInput} type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.opus" multiple hidden onchange={onImportFiles} />
        <div class="library-list">
          {#if visible.length === 0}
            <p class="dim empty-hint">No favorites yet — star a sound.</p>
          {/if}
          {#each visible as s (s.id)}
            <div class="lib-row" class:is-active={(levels[s.id] ?? 0) > 0 && playing}>
              <button class="lib-main" onclick={() => toggleSound(s.id)} title={(levels[s.id] ?? 0) > 0 ? 'Mute' : 'Enable'}>
                <span class="lib-glyph" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d={iconFor(s.id)} /></svg>
                </span>
                <span class="lib-name">{s.name}</span>
                {#if (levels[s.id] ?? 0) > 0}<span class="lib-level mono">{levels[s.id]}%</span>{/if}
              </button>
              <button class="icon-btn fav" class:starred={favorites.has(s.id)} onclick={() => toggleFavorite(s.id)} title={favorites.has(s.id) ? 'Unfavorite' : 'Favorite'} aria-label="Toggle favorite">
                <svg viewBox="0 0 24 24" width="15" height="15" fill={favorites.has(s.id) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>
              </button>
              {#if s.kind === 'imported'}
                <button class="icon-btn danger" onclick={() => removeImported(s.id)} title="Remove import" aria-label="Remove imported sound">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l1 12a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8l1-12"/></svg>
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <div class="side-section profiles">
        <div class="side-title"><span>MIX PRESETS</span></div>
        <div class="preset-grid">
          {#each PRESETS as p (p.id)}
            <button class="preset-chip" class:active={activePreset?.id === p.id} onclick={() => applyLevels(p.levels)}>{p.name}</button>
          {/each}
          {#each profiles as p (p.id)}
            <span class="preset-chip custom" class:active={activePreset?.id === p.id}>
              <button class="custom-apply" onclick={() => applyLevels(p.levels)}>{p.name}</button>
              <button class="custom-del" onclick={() => removeProfile(p.id)} title="Delete profile" aria-label="Delete profile">✕</button>
            </span>
          {/each}
        </div>
        <div class="save-profile">
          <input class="input slim" placeholder="Name current mix…" bind:value={profileName} onkeydown={(e) => e.key === 'Enter' && saveProfile()} />
          <button class="btn btn-ghost btn-sm" onclick={saveProfile} disabled={!profileName.trim()}>Save</button>
        </div>
      </div>
    </aside>

    <main class="stage">
      <div class="stage-head">
        <h2>Now mixing <span class="dim">· {activeCount} active</span></h2>
      </div>
      <div class="tiles">
        {#each sounds as s (s.id)}
          {@const level = levels[s.id] ?? 0}
          <div class="tile" class:on={level > 0}>
            <button class="tile-power" onclick={() => toggleSound(s.id)} title={level > 0 ? 'Mute' : 'Enable'} aria-pressed={level > 0}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v8"/><path d="M6.3 6.5a8 8 0 1 0 11.4 0"/></svg>
            </button>
            <div class="tile-glyph" class:pulse={level > 0 && playing} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d={iconFor(s.id)} /></svg>
            </div>
            <div class="tile-name">{s.name}</div>
            <input class="tile-slider" type="range" min="0" max="100" value={level} oninput={(e) => setLevel(s.id, Number((e.target as HTMLInputElement).value))} aria-label="{s.name} volume" />
            <div class="tile-foot">
              <span class="tile-val mono">{level}</span>
              {#if s.license}<span class="tile-license" title={s.license}>CC0</span>{:else if s.kind === 'imported'}<span class="tile-license">local</span>{/if}
            </div>
          </div>
        {/each}
      </div>
    </main>
  </div>

  <footer class="statusbar">
    <span class="dim"><span class="kbd">Space</span> play/pause · <span class="kbd">1–8</span> toggle sound · <span class="kbd">+</span><span class="kbd">−</span> master · all audio stays local</span>
    <span class="dim">{activeCount} sound{activeCount === 1 ? '' : 's'} active</span>
  </footer>

  {#if toast}<div class="toast">{toast}</div>{/if}
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100%; }
  .topbar {
    display: flex; align-items: center; gap: 1rem; padding: .55rem .9rem;
    background: var(--bg-elevated); border-bottom: 1px solid var(--border);
    user-select: none;
  }
  .brand { display: flex; align-items: center; gap: .55rem; min-width: 0; }
  .logo { display: grid; place-items: center; width: 34px; height: 34px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); }
  .brand-text h1 { font-size: .95rem; margin: 0; letter-spacing: .01em; }
  .brand-text p { margin: 0; font-size: .68rem; color: var(--fg-dim); text-transform: uppercase; letter-spacing: .12em; }
  .master { display: flex; align-items: center; gap: .9rem; margin-left: auto; }
  .play-btn {
    display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%;
    border: 1px solid var(--border); background: var(--bg-inset); color: var(--fg);
    cursor: pointer; transition: all .15s var(--ease);
  }
  .play-btn:hover { border-color: var(--accent); color: var(--accent); }
  .play-btn.is-playing { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
  .master-vol { display: flex; align-items: center; gap: .4rem; color: var(--fg-dim); }
  .master-vol input { width: 110px; accent-color: var(--accent); }
  .timer { display: flex; align-items: center; gap: .35rem; color: var(--fg-dim); }
  .timer-select { font: inherit; font-size: .82rem; color: var(--fg); background: var(--bg-inset); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .28rem .35rem; }
  .custom-min { width: 56px; font: inherit; font-size: .82rem; color: var(--fg); background: var(--bg-inset); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .28rem .35rem; }
  .countdown { font-size: .82rem; color: var(--accent); min-width: 3.2em; }

  .body { flex: 1; display: flex; min-height: 0; }
  .sidebar {
    width: 288px; display: flex; flex-direction: column; gap: .75rem; padding: .75rem;
    border-right: 1px solid var(--border); background: var(--bg-elevated); overflow-y: auto;
  }
  .side-section { display: flex; flex-direction: column; gap: .5rem; min-height: 0; }
  .side-section.profiles { border-top: 1px solid var(--border); padding-top: .75rem; }
  .side-title { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
  .side-title > span:first-child { font-size: .68rem; font-weight: 700; letter-spacing: .12em; color: var(--fg-dim); }
  .side-tools { display: flex; gap: .3rem; }
  .chip-btn { font: inherit; font-size: .7rem; border: 1px solid var(--border); background: transparent; color: var(--fg-dim); border-radius: 999px; padding: .12rem .5rem; cursor: pointer; }
  .chip-btn.active { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
  .import-btn {
    display: flex; align-items: center; justify-content: center; gap: .4rem; font: inherit; font-size: .82rem;
    border: 1px dashed var(--border-strong); background: transparent; color: var(--fg-dim);
    border-radius: var(--radius-sm); padding: .42rem; cursor: pointer;
  }
  .import-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
  .library-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; }
  .empty-hint { font-size: .8rem; padding: .4rem .2rem; }
  .lib-row { display: flex; align-items: center; gap: 2px; border-radius: var(--radius-sm); }
  .lib-row.is-active { background: var(--accent-soft); }
  .lib-main { flex: 1; display: flex; align-items: center; gap: .5rem; background: transparent; border: none; color: var(--fg); font: inherit; text-align: left; padding: .34rem .4rem; border-radius: var(--radius-sm); cursor: pointer; min-width: 0; }
  .lib-main:hover { background: var(--bg-hover); }
  .lib-glyph { display: grid; place-items: center; color: var(--accent); flex: 0 0 auto; }
  .lib-name { flex: 1; font-size: .84rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lib-level { font-size: .68rem; color: var(--fg-dim); }
  .icon-btn.fav.starred { color: var(--warn); }
  .icon-btn.danger:hover { color: var(--danger); background: var(--danger-soft); }

  .preset-grid { display: flex; flex-wrap: wrap; gap: .35rem; }
  .preset-chip {
    font: inherit; font-size: .78rem; color: var(--fg); background: var(--bg-inset);
    border: 1px solid transparent; border-radius: 999px; padding: .28rem .65rem; cursor: pointer;
  }
  .preset-chip:hover { border-color: var(--border-strong); }
  .preset-chip.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .preset-chip.custom { display: inline-flex; align-items: center; gap: .25rem; padding: .18rem .35rem .18rem .65rem; }
  .custom-apply { background: transparent; border: none; color: inherit; font: inherit; cursor: pointer; padding: 0; }
  .custom-del { background: transparent; border: none; color: var(--fg-dim); cursor: pointer; font-size: .7rem; padding: .1rem .25rem; border-radius: 4px; }
  .custom-del:hover { color: var(--danger); background: var(--danger-soft); }
  .save-profile { display: flex; gap: .35rem; }
  .input.slim { padding: .32rem .5rem; font-size: .8rem; }

  .stage { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: .9rem 1.1rem; overflow-y: auto; }
  .stage-head h2 { font-size: .95rem; margin: 0 0 .7rem; font-weight: 650; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: .7rem; align-content: start; }
  .tile {
    position: relative; display: flex; flex-direction: column; align-items: center; gap: .45rem;
    padding: .75rem .5rem .6rem; background: var(--bg-elevated); border: 1px solid var(--border);
    border-radius: var(--radius); box-shadow: var(--shadow); transition: border-color .15s var(--ease), transform .15s var(--ease);
  }
  .tile.on { border-color: var(--accent); }
  .tile-power { position: absolute; top: .35rem; right: .35rem; width: 30px; height: 30px; display: grid; place-items: center; border: none; background: transparent; color: var(--fg-dim); border-radius: 50%; cursor: pointer; }
  .tile-power:hover { color: var(--fg); background: var(--bg-hover); }
  .tile.on .tile-power { color: var(--accent); }
  .tile-glyph { color: var(--fg-dim); transition: color .2s var(--ease); }
  .tile.on .tile-glyph { color: var(--accent); }
  .tile-glyph.pulse { animation: pulse 2.6s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
  .tile-name { font-size: .82rem; font-weight: 600; }
  .tile-slider { width: 100%; accent-color: var(--accent); }
  .tile-foot { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0 .15rem; }
  .tile-val { font-size: .7rem; color: var(--fg-dim); }
  .tile-license { font-size: .58rem; font-weight: 700; letter-spacing: .06em; color: var(--fg-dim); background: var(--bg-inset); border-radius: 4px; padding: .05rem .3rem; }

  .statusbar { display: flex; justify-content: space-between; gap: 1rem; padding: .34rem .9rem; font-size: .7rem; background: var(--bg-elevated); border-top: 1px solid var(--border); user-select: none; }
  @media (max-width: 860px) {
    .sidebar { width: 232px; }
    .master-vol input { width: 70px; }
    .timer .countdown { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .tile-glyph.pulse { animation: none; } }
</style>
