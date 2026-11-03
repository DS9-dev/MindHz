import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { HEADROOM, renderSession } from '../src/shared/audio/engine';
import { validateLayer } from '../src/shared/audio/validate';
import { CATALOG } from '../src/shared/catalog/catalog';
import { BUILTIN_PRESETS } from '../src/shared/catalog/presets';
import { REFERENCES, REF_BY_ID } from '../src/shared/catalog/references';
import { sessionDuration } from '../src/shared/model';
import {
  DEFAULT_SETTINGS,
  makeBundle,
  parseBundle,
  sanitizeLibrary,
  sanitizeSession,
  sanitizeSettings,
} from '../src/shared/schema';
import { JsonStore } from '../src/main/store';
import { en } from '../src/renderer/i18n/en';
import { ru } from '../src/renderer/i18n/ru';
import { peak } from './helpers';

describe('catalogue integrity', () => {
  it('has unique ids and every reference exists', () => {
    const ids = new Set<string>();
    for (const e of CATALOG) {
      assert.ok(!ids.has(e.id), `duplicate ${e.id}`);
      ids.add(e.id);
      for (const r of e.refs) assert.ok(REF_BY_ID[r], `${e.id}: unknown reference ${r}`);
      assert.ok(e.summary && e.purpose && e.science && e.limitations, `${e.id}: missing text`);
      assert.ok(e.play.length > 0, `${e.id}: nothing to play`);
    }
  });

  it('covers all required groups', () => {
    for (const band of ['delta', 'theta', 'alpha', 'beta', 'gamma'])
      assert.ok(CATALOG.some((e) => e.quantity === 'brain' && e.band === band), band);
    for (const hz of [174, 285, 396, 417, 528, 639, 741, 852, 963, 432])
      assert.ok(CATALOG.some((e) => e.value === hz), `${hz} Hz`);
  });

  it('esoteric entries are labelled as such and keep their interpretation separate', () => {
    for (const e of CATALOG.filter((x) => x.category === 'solfeggio')) {
      assert.equal(e.evidence, 'esoteric');
      assert.ok(e.esoteric && e.esoteric.length > 10);
    }
  });

  it('references are well-formed (DOI syntax, links)', () => {
    for (const r of REFERENCES) {
      if (r.doi) assert.match(r.doi, /^10\.\d{4,9}\/\S+$/, r.id);
      if (r.url) assert.match(r.url, /^https:\/\//, r.id);
      assert.ok(r.year > 1900 && r.year <= 2026, r.id);
    }
  });

  it('play specs never ask for an inaudible plain tone', () => {
    for (const e of CATALOG)
      for (const p of e.play)
        if (p.kind === 'tone') assert.ok((p.carrierHz ?? 0) >= 20, `${e.id} plays an inaudible tone`);
  });
});

describe('built-in presets', () => {
  it('are valid sessions with explanation and evidence', () => {
    const ids = new Set<string>();
    for (const p of BUILTIN_PRESETS) {
      assert.ok(!ids.has(p.id));
      ids.add(p.id);
      const clean = sanitizeSession(p);
      assert.ok(clean, p.id);
      assert.equal(clean.stages.length, p.stages.length);
      assert.ok(p.meta?.purpose && p.meta.explanation && p.meta.evidence, p.id);
      for (const r of p.meta?.refs ?? []) assert.ok(REF_BY_ID[r], `${p.id}: ${r}`);
      assert.ok(sessionDuration(p) >= 60);
      for (const st of p.stages)
        for (const l of st.layers)
          assert.ok(!validateLayer(l).some((i) => i.level === 'error'), `${p.id}: invalid layer`);
    }
  });

  it('cover all four directions', () => {
    for (const d of ['mind', 'emotion', 'rest', 'esoteric'])
      assert.ok(BUILTIN_PRESETS.filter((p) => p.meta?.direction === d).length >= 3, d);
  });

  it('render without clipping (first 20 s of each)', () => {
    for (const p of BUILTIN_PRESETS) {
      const short = { ...p, stages: p.stages.map((s) => ({ ...s, durationSec: Math.min(s.durationSec, 10) })) };
      const { left, right } = renderSession(short, 16000);
      assert.ok(peak(left) <= HEADROOM + 1e-6 && peak(right) <= HEADROOM + 1e-6, p.id);
    }
  });
});

describe('sanitising user data', () => {
  it('clamps absurd values and drops garbage', () => {
    const s = sanitizeSession({
      name: 'x'.repeat(1000),
      stages: [
        { durationSec: -5, layers: [{ kind: 'tone', carrierHz: 1e9, volume: 7 }, { kind: 'evil' }, null] },
        'nope',
      ],
      fadeInSec: 'a',
    });
    assert.ok(s);
    assert.equal(s.name.length, 120);
    assert.equal(s.stages.length, 1);
    assert.equal(s.stages[0].layers.length, 1);
    assert.equal(s.stages[0].layers[0].carrierHz, 20000);
    assert.equal(s.stages[0].layers[0].volume, 1);
    assert.equal(s.stages[0].durationSec, 1);
    assert.equal(s.fadeInSec, 5);
  });

  it('settings: unknown → defaults, master volume never above the limit', () => {
    assert.deepEqual(sanitizeSettings(undefined), DEFAULT_SETTINGS);
    const s = sanitizeSettings({ volumeLimit: 0.5, masterVolume: 1, theme: 'neon' });
    assert.equal(s.masterVolume, 0.5);
    assert.equal(s.theme, 'system');
  });

  it('preset bundles round-trip and get fresh ids', () => {
    const b = makeBundle([BUILTIN_PRESETS[0]]);
    const back = parseBundle(JSON.stringify(b));
    assert.equal(back.sessions.length, 1);
    assert.notEqual(back.sessions[0].id, BUILTIN_PRESETS[0].id);
    assert.equal(back.sessions[0].builtin, false);
    assert.throws(() => parseBundle('{oops'), /IMPORT_INVALID_JSON/);
    assert.throws(() => parseBundle('{"sessions": []}'), /IMPORT_EMPTY/);
  });
});

describe('settings storage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mindhz-store-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('saves and restores (simulated restart)', async () => {
    const a = new JsonStore(dir, 'settings.json', sanitizeSettings);
    assert.deepEqual(a.load(), DEFAULT_SETTINGS);
    await a.save({ ...DEFAULT_SETTINGS, theme: 'light', masterVolume: 0.42 });
    const b = new JsonStore(dir, 'settings.json', sanitizeSettings);
    const s = b.load();
    assert.equal(s.theme, 'light');
    assert.equal(s.masterVolume, 0.42);
  });

  it('serialises concurrent saves — last one wins', async () => {
    const st = new JsonStore(dir, 'lib.json', sanitizeLibrary);
    st.load();
    const saves = [];
    for (let i = 0; i < 20; i++) saves.push(st.save({ ...sanitizeLibrary({}), favorites: [`f${i}`] }));
    await Promise.all(saves);
    assert.deepEqual(new JsonStore(dir, 'lib.json', sanitizeLibrary).load().favorites, ['f19']);
  });

  it('recovers from a corrupted file using the backup', async () => {
    const st = new JsonStore(dir, 'settings.json', sanitizeSettings);
    await st.save({ ...DEFAULT_SETTINGS, theme: 'dark' });
    await st.save({ ...DEFAULT_SETTINGS, theme: 'light' });
    writeFileSync(join(dir, 'settings.json'), '{"theme": "da'); // torn write
    const again = new JsonStore(dir, 'settings.json', sanitizeSettings);
    const s = again.load();
    assert.equal(again.recoveredFrom, 'backup');
    assert.equal(s.theme, 'dark');
    assert.ok(readdirSync(dir).some((f) => f.startsWith('settings.json.corrupt-')));
  });

  it('writes human-readable JSON', () => {
    assert.match(readFileSync(join(dir, 'lib.json'), 'utf8'), /\n {2}"version"/);
  });
});

describe('localisation', () => {
  it('English dictionary covers every Russian key', () => {
    const missing = Object.keys(ru).filter((k) => !(k in en));
    assert.deepEqual(missing, []);
  });
});
