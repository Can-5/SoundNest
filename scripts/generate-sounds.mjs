#!/usr/bin/env node
// Generates the bundled ambience loops for SoundNest.
// Every loop is synthesized from math (noise, filters, LFOs, envelopes) —
// no pre-existing audio is used. Output is CC0: do what you want with it.
// Usage: node scripts/generate-sounds.mjs  (writes src/assets/sounds/*.wav)

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SR = 22050
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'sounds')

mkdirSync(outDir, { recursive: true })

// deterministic RNG so regenerated files are identical
let seed = 0x2f6e2b1
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}
const randn = () => (rand() + rand() + rand() + rand() - 2) / 0.5 // approx N(0,~0.29)

// ── tiny DSP helpers ─────────────────────────────────────────────
const lowpass = (samples, fc) => {
  const rc = 1 / (2 * Math.PI * fc)
  const dt = 1 / SR
  const alpha = dt / (rc + dt)
  let y = 0
  return samples.map((x) => (y = y + alpha * (x - y)))
}
const highpass = (samples, fc) => {
  const rc = 1 / (2 * Math.PI * fc)
  const dt = 1 / SR
  const alpha = rc / (rc + dt)
  let yPrev = 0, xPrev = 0
  return samples.map((x) => {
    const y = alpha * (yPrev + x - xPrev)
    yPrev = y; xPrev = x
    return y
  })
}
const bandpass = (samples, fc, q) => {
  // state-variable filter
  const w0 = 2 * Math.PI * fc / SR
  const sinw0 = Math.sin(w0)
  const alpha = sinw0 / (2 * q)
  const cosw0 = Math.cos(w0)
  const b0 = alpha, b1 = 0, b2 = -alpha
  const a0 = 1 + alpha, a1 = -2 * cosw0, a2 = 1 - alpha
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return samples.map((x0) => {
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2
    x2 = x1; x1 = x0; y2 = y1; y1 = y0
    return y0
  })
}
const brownNoise = (n) => {
  let last = 0
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const white = rand() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    out[i] = last * 3.5
  }
  return out
}
const whiteNoise = (n) => {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = (rand() * 2 - 1) * 0.8
  return out
}
const pinkNoise = (n) => {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
    b6 = w * 0.115926
    out[i] = pink * 0.11
  }
  return out
}
const lfo = (n, hz, depth) => {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = 1 + depth * Math.sin(2 * Math.PI * hz * (i / SR))
  return out
}
const applyGain = (samples, gain) => samples.map((x, i) => x * gain[i])
const normalize = (samples, peak = 0.85) => {
  let max = 0
  for (const x of samples) max = Math.max(max, Math.abs(x))
  const g = max > 0 ? peak / max : 1
  return samples.map((x) => x * g)
}
// equal-power crossfade of the tail into the head => seamless loop
const loopSeamless = (samples, fadeSec = 1) => {
  const fade = Math.floor(fadeSec * SR)
  const n = samples.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (i < fade) {
      const t = i / fade
      const a = Math.cos(t * Math.PI / 2)
      const b = Math.sin(t * Math.PI / 2)
      out[i] = samples[i] * a + samples[n - fade + i] * b
    } else {
      out[i] = samples[i]
    }
  }
  return out
}
const addAt = (dst, src, offsetSamples, gain = 1) => {
  for (let i = 0; i < src.length && offsetSamples + i < dst.length; i++) {
    dst[offsetSamples + i] += src[i] * gain
  }
}

const writeWav = (name, samples) => {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  const path = join(outDir, name)
  writeFileSync(path, buf)
  console.log(`wrote ${name} (${(buf.length / 1024).toFixed(0)} KB)`)
}

const N = (sec) => Math.floor(sec * SR)

// ── 1. rain: pink noise lowpassed + slow swell ───────────────────
{
  const n = N(12)
  let s = lowpass(pinkNoise(n), 1800)
  s = applyGain(s, lfo(n, 1 / 12, 0.18))
  s = normalize(loopSeamless(s, 1), 0.8)
  writeWav('rain.wav', s)
}
// ── 2. ocean: brown noise, slow 12 s wave cycle (duration is a multiple) ──
{
  const n = N(24)
  let s = lowpass(brownNoise(n), 420)
  s = applyGain(s, lfo(n, 1 / 12, 0.42))
  s = normalize(loopSeamless(s, 1.5), 0.85)
  writeWav('ocean.wav', s)
}
// ── 3. wind: brown noise lowpassed + gusts ───────────────────────
{
  const n = N(12)
  let s = lowpass(brownNoise(n), 650)
  s = applyGain(s, lfo(n, 1 / 12, 0.35))
  s = normalize(loopSeamless(s, 1), 0.8)
  writeWav('wind.wav', s)
}
// ── 4. stream: white noise bandpassed, fast ripple ───────────────
{
  const n = N(12)
  let s = bandpass(whiteNoise(n), 1100, 0.9)
  s = bandpass([...s].map((x) => x * 0.6), 2300, 1.4).map((x, i) => x * 0.4 + s[i] * 0.6)
  const ripple = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    ripple[i] = 1 + 0.25 * Math.sin(2 * Math.PI * 3.5 * (i / SR)) + 0.1 * Math.sin(2 * Math.PI * 7 * (i / SR) + 1)
  }
  s = applyGain(s, ripple)
  s = normalize(loopSeamless(s, 0.5), 0.75)
  writeWav('stream.wav', s)
}
// ── 5. fireplace: low rumble + poisson crackles ─────────────────
{
  const n = N(12)
  const rumble = lowpass(brownNoise(n), 220)
  const s = new Float32Array(n)
  s.set(rumble.map((x) => x * 0.9))
  // crackles: ~3 per second, short bandpassed bursts
  let t = 0.4
  while (t < 11.5) {
    const start = Math.floor(t * SR)
    const len = Math.floor((0.004 + rand() * 0.02) * SR)
    const burst = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (len / 4))
      burst[i] = (rand() * 2 - 1) * env
    }
    addAt(s, bandpass([...burst], 1400 + rand() * 1200, 2), start, 1.4)
    t += 0.15 + rand() * 0.85
  }
  const out = normalize(loopSeamless(s, 0.75), 0.85)
  writeWav('fireplace.wav', out)
}
// ── 6. storm: rain + distant thunder every ~8 s ─────────────────
{
  const n = N(24)
  const rain = lowpass(pinkNoise(n), 1500)
  const s = new Float32Array(n)
  s.set(applyGain(rain, lfo(n, 1 / 24, 0.2)))
  // two thunder events per loop
  for (const at of [3.5, 15]) {
    const len = Math.floor(3.2 * SR)
    const start = Math.floor(at * SR)
    const burst = brownNoise(len)
    const thunder = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (SR * 0.9)) * (0.6 + 0.4 * Math.sin((i / len) * Math.PI))
      thunder[i] = burst[i] * env
    }
    addAt(s, lowpass([...thunder], 110), start, 2.2)
  }
  const out = normalize(loopSeamless(s, 1), 0.9)
  writeWav('storm.wav', out)
}
// ── 7. crickets: 4.3 kHz chirp synthesis over faint noise floor ──
{
  const n = N(12)
  const floorS = pinkNoise(n).map((x) => x * 0.06)
  const s = new Float32Array(n)
  s.set(floorS)
  // chirp: 18 pulses at 42 Hz, repeated with jitter ~ every 1 s
  let t = 0.2
  while (t < 11.4) {
    const chirpLen = Math.floor(0.42 * SR)
    const chirp = new Float32Array(chirpLen)
    for (let i = 0; i < chirpLen; i++) {
      const env = Math.sin((Math.PI * i) / chirpLen)
      const pulse = Math.sin(2 * Math.PI * 42 * (i / SR)) > 0 ? 1 : 0
      chirp[i] = Math.sin(2 * Math.PI * 4300 * (i / SR)) * pulse * env
    }
    addAt(s, chirp, Math.floor(t * SR), 0.32)
    t += 0.8 + rand() * 0.7
  }
  const out = normalize(loopSeamless(s, 0.25), 0.7)
  writeWav('crickets.wav', out)
}
// ── 8. café: low murmur — wandering pink noise ───────────────────
{
  const n = N(12)
  let s = lowpass(pinkNoise(n), 480)
  const wander = new Float32Array(n)
  let w = 0.5
  for (let i = 0; i < n; i++) {
    w += (rand() - 0.5) * 0.008
    w = Math.max(0.15, Math.min(0.85, w))
    wander[i] = w
  }
  s = applyGain(s, wander)
  s = normalize(loopSeamless(s, 1), 0.6)
  writeWav('cafe.wav', s)
}
console.log('done')
