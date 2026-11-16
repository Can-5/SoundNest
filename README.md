# SoundNest

**Ambient sound mixer for deep work, relaxation and sleep.** Blend rain, ocean, wind, fire, storms and more — layered with independent volumes, saved presets, a sleep timer, and your own imported audio.

SoundNest is a Tauri 2 desktop app (Rust + Svelte + TypeScript). All audio is generated or stored locally; nothing ever leaves your machine.

## Features

- **8 synthesized ambience loops** — rain, ocean waves, wind, forest stream, fireplace crackle, thunderstorm, crickets, café murmur
- **Real-time mixing** — every sound has its own level; master volume on top
- **Mix presets** — Deep Focus, Rainy Cozy, Storm Sleep, Nature Walk, Night Crickets
- **Custom profiles** — save the current mix under a name; stored locally
- **Sleep timer** — fade-out over 3 s, then pause everything (15–120 min + custom)
- **Import your own audio** — WAV/MP3/FLAC/OGG/M4A/AAC/Opus up to 25 MB, stored in IndexedDB on disk
- **Favorites** — star sounds to pin them
- **Favorites filter & keyboard control** — `Space` play/pause, `1–8` toggle a sound, `+`/`−` master volume
- **Light/dark/system theme**
- **Real audio playback** — HTML Audio elements with looping; mixed per-sound volumes

## Sound content & licenses

Every bundled loop is **synthesized by a script in this repository** (`scripts/generate-sounds.mjs`, white/pink/brown noise, one-pole/state-variable filters, LFOs and envelopes). No pre-existing recordings are used. The generated files are released under **CC0** (public domain) as with the rest of the project. Regenerate them with:

```bash
node scripts/generate-sounds.mjs
```

User-imported files are stored locally via IndexedDB and are never uploaded anywhere. You are responsible for the licenses of files you import.

## Install

Download a bundle from the releases page, or build from source:

```bash
pnpm install
pnpm tauri build
```

Requirements: Node 20+, pnpm 10+, Rust stable, and the platform prerequisites for Tauri 2
(Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`; see https://v2.tauri.app/start/prerequisites/)

## Develop

```bash
pnpm install
pnpm dev        # run the app with hot reload
pnpm test       # unit tests (vitest)
pnpm build      # production frontend build
pnpm tauri dev  # desktop shell with hot reload
```

Project layout:

```
src/                  Svelte frontend
  lib/library.ts      sound catalog, presets, mixer math (unit-tested)
  lib/db.ts           IndexedDB wrapper for imported audio
  assets/sounds/*.wav generated loops (~5 MB, CC0)
scripts/generate-sounds.mjs   synthesizer (Node, no deps)
src-tauri/            Rust shell (no privileged commands; offline only)
```

## Privacy

- No network requests, no telemetry, no account.
- Volumes, favorites and profiles are stored in `localStorage`; imported audio in IndexedDB. Both stay on your device.
- Deleting imported sounds removes them from disk (IndexedDB).

## Platform notes

- **Linux** (Wayland/X11), **Windows**, **macOS** — all supported. On macOS, press `Space` to play/pause; make sure SoundNest (or your terminal) is focused.
- Audio decoding depends on the OS WebView (WebKitGTK / WebView2 / WKWebView). If a custom file won't play, its codec isn't supported there; convert it (e.g. to OGG or WAV) and re-import.

## License

MIT (code) · CC0 (generated audio) — see [LICENSE](LICENSE).
