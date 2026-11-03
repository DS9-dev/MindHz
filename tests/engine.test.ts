import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HEADROOM, SynthEngine, computeTargets, renderSession } from '../src/shared/audio/engine';
import { validateLayer, bandOf, describeLayer } from '../src/shared/audio/validate';
import { SR, goertzel, makeLayer, makeSession, makeStage, maxStep, oneStage, peak, zeroCrossFreq } from './helpers';

describe('frequency accuracy', () => {
  it('pure tone is generated at the requested frequency', () => {
    for (const hz of [40, 100, 432, 528, 963, 1000, 7777.7]) {
      const s = oneStage([makeLayer('tone', { carrierHz: hz, volume: 1 })], 2);
      const { left, right } = renderSession(s, SR);
      const f = zeroCrossFreq(left, SR, SR * 0.3, SR * 1.7);
      assert.ok(Math.abs(f - hz) < hz * 1e-5 + 1e-3, `tone ${hz} measured ${f}`);
      assert.deepEqual(left.subarray(1000, 2000), right.subarray(1000, 2000), 'centred tone is identical L/R');
    }
  });

  it('binaural beat: left = carrier - beat/2, right = carrier + beat/2', () => {
    const s = oneStage([makeLayer('binaural', { carrierHz: 200, beatHz: 10, volume: 1 })], 3);
    const { left, right } = renderSession(s, SR);
    const fl = zeroCrossFreq(left, SR, SR * 0.5, SR * 2.5);
    const fr = zeroCrossFreq(right, SR, SR * 0.5, SR * 2.5);
    assert.ok(Math.abs(fl - 195) < 1e-3, `left ${fl}`);
    assert.ok(Math.abs(fr - 205) < 1e-3, `right ${fr}`);
  });

  it('monaural beat is identical in both ears and contains both tones', () => {
    const s = oneStage([makeLayer('monaural', { carrierHz: 300, beatHz: 6, volume: 1 })], 2);
    const { left, right } = renderSession(s, SR);
    assert.deepEqual(left, right);
    const a = goertzel(left, SR, 297, SR * 0.5, SR * 1.5);
    const b = goertzel(left, SR, 303, SR * 0.5, SR * 1.5);
    const off = goertzel(left, SR, 300, SR * 0.5, SR * 1.5);
    assert.ok(a > off * 100 && b > off * 100, 'two components at 297/303 Hz, nothing at 300');
  });

  it('isochronic and AM envelopes pulse at the beat rate', () => {
    for (const kind of ['isochronic', 'am'] as const) {
      const s = oneStage([makeLayer(kind, { carrierHz: 220, beatHz: 7, depth: 1, volume: 1 })], 3);
      const { left } = renderSession(s, SR);
      const rect = Float32Array.from(left, Math.abs);
      const atBeat = goertzel(rect, SR, 7, SR * 0.5, SR * 2.5);
      const offBeat = goertzel(rect, SR, 9.3, SR * 0.5, SR * 2.5);
      assert.ok(atBeat > offBeat * 50, `${kind}: envelope energy at 7 Hz`);
    }
  });

  it('stays accurate over a long session (phase accumulator does not drift)', () => {
    const s = oneStage([makeLayer('binaural', { carrierHz: 250, beatHz: 4, volume: 1 })], 180);
    const { left, right } = renderSession(s, SR, 8192);
    const from = SR * 170;
    const to = SR * 178;
    assert.ok(Math.abs(zeroCrossFreq(left, SR, from, to) - 248) < 1e-3);
    assert.ok(Math.abs(zeroCrossFreq(right, SR, from, to) - 252) < 1e-3);
  });
});

describe('level safety', () => {
  it('never clips, even with 8 full-volume layers', () => {
    const layers = [
      makeLayer('tone', { carrierHz: 100, volume: 1 }),
      makeLayer('tone', { carrierHz: 101, volume: 1 }),
      makeLayer('binaural', { carrierHz: 200, beatHz: 10, volume: 1 }),
      makeLayer('monaural', { carrierHz: 150, beatHz: 5, volume: 1 }),
      makeLayer('isochronic', { carrierHz: 300, beatHz: 12, volume: 1 }),
      makeLayer('am', { carrierHz: 99, beatHz: 3, volume: 1 }),
      makeLayer('noise', { noiseColor: 'brown', volume: 1 }),
      makeLayer('noise', { noiseColor: 'white', volume: 1 }),
    ];
    const s = oneStage(layers, 4);
    const { left, right } = renderSession(s, SR);
    assert.ok(peak(left) <= HEADROOM + 1e-6, `left peak ${peak(left)}`);
    assert.ok(peak(right) <= HEADROOM + 1e-6, `right peak ${peak(right)}`);
  });

  it('noise generators stay bounded and are deterministic', () => {
    for (const c of ['white', 'pink', 'brown'] as const) {
      const s = oneStage([makeLayer('noise', { id: 'n1', noiseColor: c, volume: 1 })], 5);
      const a = renderSession(s, SR);
      const b = renderSession(s, SR);
      assert.deepEqual(a.left, b.left);
      assert.ok(peak(a.left) <= HEADROOM + 1e-6);
      assert.ok(peak(a.left) > 0.05, `${c} noise is audible`);
      assert.notDeepEqual(a.left.subarray(0, 1000), a.right.subarray(0, 1000), 'stereo noise is decorrelated');
    }
  });

  it('starts and ends silently (fade in/out)', () => {
    const s = oneStage([makeLayer('tone', { carrierHz: 440, volume: 1 })], 2, { fadeInSec: 0.5, fadeOutSec: 0.5 });
    const { left } = renderSession(s, SR);
    assert.ok(Math.abs(left[0]) < 1e-3);
    assert.ok(Math.abs(left[left.length - 1]) < 1e-3);
    assert.ok(peak(left.subarray(0, 480)) < 0.01, 'first 10 ms are very quiet');
  });
});

describe('transitions', () => {
  const sineStepBound = (fmax: number) => ((2 * Math.PI * fmax) / SR) * HEADROOM * 1.02 + 1e-4;

  it('smooth stage transition glides frequency without clicks', () => {
    const id = 'L1';
    const s = makeSession({
      fadeInSec: 0.2,
      fadeOutSec: 0.2,
      stages: [
        makeStage({ durationSec: 2, layers: [makeLayer('binaural', { id, carrierHz: 200, beatHz: 10, volume: 1 })] }),
        makeStage({
          durationSec: 4,
          transitionSec: 2,
          layers: [makeLayer('binaural', { id, carrierHz: 400, beatHz: 4, volume: 1 })],
        }),
      ],
    });
    const { left, right } = renderSession(s, SR);
    assert.ok(maxStep(left) <= sineStepBound(400), `max step ${maxStep(left)}`);
    assert.ok(maxStep(right) <= sineStepBound(402), `max step ${maxStep(right)}`);
    const f = zeroCrossFreq(right, SR, SR * 4.5, SR * 5.5);
    assert.ok(Math.abs(f - 402) < 0.05, `after transition right ear at 402 Hz, got ${f}`);
  });

  it('instant transition is still click-protected', () => {
    const s = makeSession({
      fadeInSec: 0.1,
      fadeOutSec: 0.1,
      stages: [
        makeStage({ durationSec: 1, layers: [makeLayer('tone', { id: 'a', carrierHz: 300, volume: 1 })] }),
        makeStage({
          durationSec: 1,
          transition: 'instant',
          layers: [makeLayer('tone', { id: 'b', carrierHz: 500, volume: 1, pan: 0 })],
        }),
      ],
    });
    const { left } = renderSession(s, SR);
    // a pure discontinuity would produce a step close to 2*HEADROOM
    assert.ok(maxStep(left) < sineStepBound(500) * 1.5, `max step ${maxStep(left)}`);
  });

  it('cross-fades layers that only exist in one stage', () => {
    const s = makeSession({
      stages: [
        makeStage({ durationSec: 1, layers: [makeLayer('tone', { id: 'a', carrierHz: 200, volume: 1 })] }),
        makeStage({ durationSec: 1, transitionSec: 0.5, layers: [makeLayer('noise', { id: 'n', volume: 1 })] }),
      ],
    });
    const mid = computeTargets(s, 1.25);
    assert.equal(mid.targets.length, 2);
    const total = mid.targets.reduce((a, t) => a + t.gain, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, 'equal-sum cross-fade');
  });
});

describe('real-time transport', () => {
  it('output is independent of the host buffer size', () => {
    const s = oneStage(
      [makeLayer('binaural', { carrierHz: 210, beatHz: 7 }), makeLayer('noise', { id: 'nz', noiseColor: 'pink' })],
      3,
    );
    const a = renderSession(s, SR, 128);
    const b = renderSession(s, SR, 1000);
    const c = renderSession(s, SR, 4093);
    assert.deepEqual(a.left, b.left);
    assert.deepEqual(a.right, c.right);
  });

  it('live parameter changes, pause/resume and stop are click-free', () => {
    const eng = new SynthEngine(SR);
    const layer = makeLayer('tone', { id: 't', carrierHz: 300, volume: 1 });
    const s = oneStage([layer], 60, { loop: true });
    eng.setSession(s);
    eng.setMasterVolume(1, true);
    eng.play();
    const out: number[] = [];
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    const run = (blocks: number) => {
      for (let i = 0; i < blocks; i++) {
        eng.process(L, R);
        out.push(...L);
      }
    };
    run(200);
    eng.setSession({ ...s, stages: [{ ...s.stages[0], layers: [{ ...layer, carrierHz: 600, volume: 0.3 }] }] }, true);
    run(200);
    eng.setMasterVolume(0.2);
    run(100);
    eng.pause();
    run(100);
    assert.equal(eng.status().state, 'paused');
    eng.play();
    run(100);
    eng.stop(0.2);
    run(200);
    assert.equal(eng.status().state, 'stopped');
    const x = Float32Array.from(out);
    const bound = ((2 * Math.PI * 600) / SR) * HEADROOM * 1.05 + 1e-4;
    assert.ok(maxStep(x) <= bound, `max step ${maxStep(x)} > ${bound}`);
    assert.ok(peak(x.subarray(x.length - 128)) === 0, 'silent after stop');
  });

  it('a continuous session keeps playing past its nominal length', () => {
    const eng = new SynthEngine(8000);
    eng.setSession(oneStage([makeLayer('tone', { carrierHz: 200 })], 1, { loop: true }));
    eng.play();
    const L = new Float32Array(8000);
    const R = new Float32Array(8000);
    for (let i = 0; i < 3; i++) eng.process(L, R);
    assert.equal(eng.status().state, 'playing');
    assert.ok(peak(L) > 0.1);
  });

  it('a finite session ends by itself', () => {
    const eng = new SynthEngine(8000);
    eng.setSession(oneStage([makeLayer('tone', { carrierHz: 200 })], 1));
    eng.play();
    const L = new Float32Array(8000 * 2);
    const R = new Float32Array(8000 * 2);
    eng.process(L, R);
    assert.equal(eng.status().state, 'ended');
  });
});

describe('validation', () => {
  it('maps beat rates to conventional EEG bands', () => {
    assert.equal(bandOf(2), 'delta');
    assert.equal(bandOf(6), 'theta');
    assert.equal(bandOf(10), 'alpha');
    assert.equal(bandOf(20), 'beta');
    assert.equal(bandOf(40), 'gamma');
  });

  it('flags an inaudible "brainwave" tone and offers a rhythm-based alternative', () => {
    const issues = validateLayer(makeLayer('tone', { carrierHz: 10 }));
    const i = issues.find((x) => x.code === 'infrasonic-tone');
    assert.ok(i?.fix?.kind === 'isochronic' && (i.fix.carrierHz ?? 0) >= 100);
  });

  it('warns about binaural parameters outside the perceptual range', () => {
    const codes = validateLayer(makeLayer('binaural', { carrierHz: 3000, beatHz: 60 })).map((x) => x.code);
    assert.ok(codes.includes('binaural-high-carrier'));
    assert.ok(codes.includes('binaural-fast-beat'));
    assert.ok(codes.includes('headphones'));
  });

  it('keeps the three quantities separate', () => {
    const d = describeLayer(makeLayer('binaural', { carrierHz: 200, beatHz: 10 }));
    assert.deepEqual(d.audibleHz, [195, 205]);
    assert.equal(d.rhythmHz, 10);
    assert.equal(d.band, 'alpha');
  });
});
