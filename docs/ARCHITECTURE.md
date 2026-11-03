# Architecture

```
┌──────────── main process (Node) ────────────┐      ┌──────────── renderer (sandboxed) ─────────────┐
│ window, app:// protocol + CSP                │ IPC  │ React UI · state store · i18n                  │
│ JsonStore (atomic writes, .bak recovery)     │◄────►│ AudioService ──► AudioWorklet (SynthEngine)    │
│ export file writer (token-based, .part)      │      │ exporter ─────► Web Worker (SynthEngine+codec) │
│ portable / data-folder policy, smoke mode    │      │ visualisers (AnalyserNode, worklet envelope)   │
└──────────────────────────────────────────────┘      └────────────────────────────────────────────────┘
                         src/shared: types, model, engine, validate, codecs, catalogue, presets, schema
```

## Audio engine (`src/shared/audio/engine.ts`)

- Pure TypeScript, no Web Audio nodes in the signal path → identical output in the worklet and in the export worker.
- Parameters are evaluated on a fixed 128-sample grid regardless of the host buffer size (verified by tests), noise is seeded from layer ids → deterministic.
- Each voice: phase accumulators in `[0,1)` (no drift in long sessions), one-pole smoothing for gain (12 ms), frequency (60 ms) and other parameters (30 ms).
- Level safety: every voice is bounded to ±1 per channel; per-voice gain targets are normalised to a sum ≤ 1 and share one smoother, so the smoothed sum also stays ≤ 1; the mix is scaled to −1 dBFS and hard-limited as a last resort. Clipping is impossible by construction (tested with 8 full-scale layers).
- Sessions are lists of stages. Layers with the same id in consecutive stages morph (log-interpolated frequencies); others cross-fade with equal-sum gains. "Instant" transitions still use a 30 ms ramp. Session fades use raised-cosine envelopes.
- Transport: play/pause (50 ms ramps), stop with a configurable fade (the sleep timer uses 12 s). Loading a new session while sounding fades the old one out first.

## Export

`renderToSink` streams one-second chunks through the encoder into a sink with back-pressure (each chunk is acknowledged after the main process wrote it), so memory stays flat for multi-hour files. The main process writes to `<name>.part` and renames on success; on cancel/quit the partial file is removed. WAV > 4 GiB is refused (FLAC suggested).

FLAC encoder: fixed predictors 0–4, partitioned Rice (RICE/RICE2), independent / left-side / right-side / mid-side stereo chosen per frame, CRC-8/16, STREAMINFO with min/max frame size and MD5. Verified bit-exact by an independent decoder in the tests and by ffmpeg when available.

## Persistence

`settings.json`, `library.json` (user sessions, favourites, custom frequencies, generator state) and `window-state.json` in the data folder. Every read goes through sanitisers (`src/shared/schema.ts`): unknown or out-of-range values become safe defaults, so a hand-edited or corrupted file can never crash the app or produce dangerous parameters.

## Security

`contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, private `app://` origin with path-traversal protection, no navigation / new windows / webviews, IPC sender checks, permission handler that only allows audio-output selection, external links limited to `https:` and opened in the system browser. The renderer never supplies file paths: the main process picks them via native dialogs and hands out opaque tokens.

## Tests

`npm test` covers frequency accuracy (tones, binaural L/R, monaural, iso/AM envelopes, 3-minute drift), clipping, fades, click-free transitions and live edits, buffer-size independence, export = playback (bit-exact for float WAV), FLAC round-trip with MD5 for 16/24 bit × 44.1/48/96 kHz, catalogue/preset integrity, import sanitising, settings persistence and corruption recovery, i18n key coverage. `npm run smoke` runs the packaged app end-to-end.
