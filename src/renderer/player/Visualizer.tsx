import { useEffect, useRef } from 'react';
import { audio, playerStatus } from '../audio/AudioService';
import { app } from '../state/app';

export type VizMode = 'scope' | 'spectrum' | 'envelope';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

/**
 * Live signal view drawn on a canvas from the analyser nodes. Draws nothing
 * (and costs nothing) while audio is idle. Never flashes: rhythm is shown as a
 * moving envelope trace, not as a blinking light.
 */
export function Visualizer({ mode, markers = [] }: { mode: VizMode; markers?: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const dark = app.use((s) => s.dark);
  const reduced = app.use((s) => s.settings.reduceMotion);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const colors = {
      tone: cssVar('--tone'),
      brain: cssVar('--brain'),
      beat: cssVar('--beat'),
      line: cssVar('--line'),
      muted: cssVar('--muted'),
    };
    let raf = 0;
    let last = 0;
    const timeL = new Float32Array(2048);
    const timeR = new Float32Array(2048);
    let freq = new Float32Array(8192);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      draw(true);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const grid = (W: number, H: number) => {
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(H / 2) + 0.5);
      ctx.lineTo(W, Math.round(H / 2) + 0.5);
      ctx.stroke();
    };

    const drawScope = (W: number, H: number, live: boolean) => {
      grid(W, H);
      const aL = audio.analyserL;
      const aR = audio.analyserR;
      if (!live || !aL || !aR) return;
      aL.getFloatTimeDomainData(timeL);
      aR.getFloatTimeDomainData(timeR);
      // trigger on a rising zero crossing of the left channel for a stable picture
      let start = 0;
      for (let i = 1; i < 1024; i++) {
        if (timeL[i - 1] < 0 && timeL[i] >= 0) {
          start = i;
          break;
        }
      }
      const n = 1000;
      const mid = H / 2;
      // display auto-gain: the picture should not depend on the listening volume
      let pk = 0;
      for (let i = start; i < start + n; i++) pk = Math.max(pk, Math.abs(timeL[i]), Math.abs(timeR[i]));
      const amp = (H * 0.2) / Math.max(pk, 0.004);
      const trace = (buf: Float32Array, color: string, alpha: number) => {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.6 * (window.devicePixelRatio || 1);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * W;
          const y = mid - buf[start + i] * amp;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      trace(timeR, colors.brain, 0.85);
      trace(timeL, colors.tone, 0.95);
    };

    const drawSpectrum = (W: number, H: number, live: boolean) => {
      const a = audio.analyserMix;
      const sr = playerStatus.get().sampleRate || 48000;
      const fMin = 20;
      const fMax = 20000;
      const xOf = (f: number) => (Math.log(f / fMin) / Math.log(fMax / fMin)) * W;
      ctx.strokeStyle = colors.line;
      ctx.fillStyle = colors.muted;
      ctx.font = `${11 * (window.devicePixelRatio || 1)}px system-ui`;
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
        const x = Math.round(xOf(f)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, H * 0.22);
        ctx.lineTo(x, H - 26);
        ctx.stroke();
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 4, H - 12);
      }
      for (const m of markersRef.current) {
        if (m < fMin || m > fMax) continue;
        const x = xOf(m);
        ctx.strokeStyle = colors.tone;
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, H * 0.22);
        ctx.lineTo(x, H - 26);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      if (!live || !a) return;
      if (freq.length !== a.frequencyBinCount) freq = new Float32Array(a.frequencyBinCount);
      a.getFloatFrequencyData(freq);
      const binHz = sr / 2 / freq.length;
      const top = H * 0.24;
      const bottom = H - 28;
      const yOf = (db: number) => bottom - Math.max(0, Math.min(1, (db + 110) / 100)) * (bottom - top);
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, colors.tone);
      grad.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.moveTo(0, bottom);
      const cols = Math.min(600, Math.floor(W / 2));
      for (let c = 0; c <= cols; c++) {
        const f0 = fMin * Math.pow(fMax / fMin, c / cols);
        const f1 = fMin * Math.pow(fMax / fMin, (c + 1) / cols);
        let db = -200;
        for (let b = Math.floor(f0 / binHz); b <= Math.ceil(f1 / binHz) && b < freq.length; b++) db = Math.max(db, freq[b]);
        ctx.lineTo((c / cols) * W, yOf(db));
      }
      ctx.lineTo(W, bottom);
      ctx.closePath();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.tone;
      ctx.lineWidth = 1.4 * (window.devicePixelRatio || 1);
      ctx.stroke();
    };

    const drawEnvelope = (W: number, H: number) => {
      const env = audio.envelope;
      const n = env.length;
      const head = audio.envelopeHead;
      const top = H * 0.36;
      const bottom = H - 30;
      let pk = 0;
      for (let i = 0; i < n; i++) pk = Math.max(pk, env[i]);
      const scale = 1 / Math.max(pk, 0.004);
      ctx.beginPath();
      ctx.moveTo(0, bottom);
      for (let i = 0; i < n; i++) {
        const v = env[(head + i) % n];
        ctx.lineTo((i / (n - 1)) * W, bottom - Math.min(1, v * scale) * (bottom - top));
      }
      ctx.lineTo(W, bottom);
      ctx.closePath();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = colors.beat;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.beat;
      ctx.lineWidth = 1.4 * (window.devicePixelRatio || 1);
      ctx.stroke();
    };

    function draw(force = false) {
      const W = canvas!.width;
      const H = canvas!.height;
      const st = playerStatus.get().state;
      const live = st === 'playing' || st === 'pausing' || st === 'stopping';
      if (!live && !force) return;
      ctx!.clearRect(0, 0, W, H);
      if (mode === 'scope') drawScope(W, H, live);
      else if (mode === 'spectrum') drawSpectrum(W, H, live);
      else drawEnvelope(W, H);
    }

    const minDt = reduced ? 1000 / 15 : 0;
    let wasLive = false;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const st = playerStatus.get().state;
      const live = st === 'playing' || st === 'pausing' || st === 'stopping';
      if (!live) {
        if (wasLive) draw(true); // final idle frame
        wasLive = false;
        return;
      }
      wasLive = true;
      if (ts - last < minDt) return;
      last = ts;
      draw();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mode, dark, reduced]);

  return <canvas ref={ref} aria-hidden="true" />;
}

/** Peak meters in the player bar (driven by worklet peak values). */
export function Meters() {
  const pl = playerStatus.use((s) => s.peakL);
  const pr = playerStatus.use((s) => s.peakR);
  const w = (p: number) => {
    const db = 20 * Math.log10(Math.max(1e-5, p));
    return `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
  };
  return (
    <div className="meters" title="L / R">
      <div className="m">
        <i style={{ width: w(pl) }} />
      </div>
      <div className="m">
        <i style={{ width: w(pr) }} />
      </div>
    </div>
  );
}
