import { useState } from 'react';
import { describeLayer } from '../../shared/audio/validate';
import { LIMITS, makeLayer, uid } from '../../shared/model';
import type { LayerKind } from '../../shared/types';
import { playerStatus } from '../audio/AudioService';
import { fmtHz, fmtNum, t } from '../i18n';
import { Visualizer, type VizMode } from '../player/Visualizer';
import {
  app,
  openModal,
  playGenerator,
  setGenerator,
  stopPlayback,
  togglePlay,
  updateGeneratorLayers,
} from '../state/app';
import { Icon } from '../ui/Icon';
import { Button, IconButton, LabeledSlider, NumberField, Segmented } from '../ui/controls';
import { KIND_COLOR, KIND_ICON, LayerStrip } from './LayerStrip';

const ADD: LayerKind[] = ['binaural', 'isochronic', 'monaural', 'am', 'tone', 'noise'];

export function Generator() {
  const gen = app.use((s) => s.generator);
  const np = app.use((s) => s.nowPlaying);
  const state = playerStatus.use((s) => s.state);
  const [viz, setViz] = useState<VizMode>('scope');
  const stage = gen.stages[0];
  const layers = stage.layers;
  const live = np?.kind === 'generator' && state !== 'stopped' && state !== 'ended';
  const isPlaying = live && state === 'playing';

  // headline readout: the first enabled rhythmic layer, else first tone
  const lead = layers.find((l) => l.enabled && l.kind !== 'noise' && l.kind !== 'tone') ?? layers.find((l) => l.enabled && l.kind !== 'noise');
  const d = lead ? describeLayer(lead) : null;
  const markers = layers.filter((l) => l.enabled).flatMap((l) => describeLayer(l).audibleHz);

  const setStage = (patch: Partial<typeof stage>) => setGenerator({ ...gen, stages: [{ ...stage, ...patch }] });

  return (
    <div className="view-inner">
      <div className="page-head">
        <div className="grow">
          <h1>{t('gen.title')}</h1>
          <p className="lead">{t('gen.lead')}</p>
        </div>
        <Button icon="download" onClick={() => openModal({ kind: 'export', session: gen, title: t('gen.exportTitle') })}>
          {t('common.export')}
        </Button>
        <Button
          icon="presets"
          onClick={() =>
            openModal({
              kind: 'save-preset',
              session: { ...gen, id: uid('session'), name: t('gen.newPresetName'), meta: { direction: 'custom' } },
            })
          }
        >
          {t('gen.saveAsPreset')}
        </Button>
      </div>

      <section className="panel instrument" aria-label={t('gen.instrument')}>
        <div className="scope-wrap">
          <Visualizer mode={viz} markers={markers} />
          <div className="readout">
            {d && d.audibleHz.length ? (
              <div className="q" style={{ '--c': 'var(--tone)' } as React.CSSProperties}>
                <span className="k">{t('q.audible')}</span>
                <span className="v">
                  {d.audibleHz.map((h) => fmtNum(h, 1)).join(' · ')}
                  <small>{t('unit.hz')}</small>
                </span>
                <span className="sub">{d.audibleHz.length > 1 ? t('q.audibleBinaural') : t('q.audibleSub')}</span>
              </div>
            ) : null}
            {d && d.rhythmHz !== null ? (
              <div className="q" style={{ '--c': 'var(--beat)' } as React.CSSProperties}>
                <span className="k">{t('q.rhythm')}</span>
                <span className="v">
                  {fmtNum(d.rhythmHz, 2)}
                  <small>{t('unit.hz')}</small>
                </span>
                <span className="sub">{t(`q.rhythmSub.${lead!.kind}`)}</span>
              </div>
            ) : null}
            {d && d.band && d.band !== 'infra' && d.band !== 'high' ? (
              <div className="q" style={{ '--c': 'var(--brain)' } as React.CSSProperties}>
                <span className="k">{t('q.brain')}</span>
                <span className="v" style={{ fontSize: 26, paddingTop: 6 }}>
                  {t(`band.${d.band}`)}
                </span>
                <span className="sub">{t('q.brainSub')}</span>
              </div>
            ) : null}
            {!d ? (
              <div className="q" style={{ '--c': 'var(--muted)' } as React.CSSProperties}>
                <span className="k">{t('q.noiseOnly')}</span>
                <span className="v" style={{ fontSize: 26 }}>
                  {layers.some((l) => l.enabled) ? t('kind.noise') : t('q.silence')}
                </span>
              </div>
            ) : null}
          </div>
          {viz === 'scope' ? (
            <div className="scope-legend">
              <span style={{ '--c': 'var(--tone)' } as React.CSSProperties}>{t('viz.left')}</span>
              <span style={{ '--c': 'var(--brain)' } as React.CSSProperties}>{t('viz.right')}</span>
            </div>
          ) : viz === 'envelope' ? (
            <>
              {layers.some((l) => l.enabled && l.kind === 'binaural') ? <p className="viz-note">{t('viz.binauralEnvelope')}</p> : null}
              <div className="scope-legend">
                <span style={{ '--c': 'var(--beat)' } as React.CSSProperties}>{t('viz.envelopeLegend')}</span>
              </div>
            </>
          ) : null}
          <div className="scope-tabs">
            <Segmented<VizMode>
              label={t('viz.mode')}
              value={viz}
              onChange={setViz}
              options={[
                { value: 'scope', label: t('viz.scope') },
                { value: 'envelope', label: t('viz.envelope') },
                { value: 'spectrum', label: t('viz.spectrum') },
              ]}
            />
          </div>
        </div>

        <div className="deck">
          <div className="transport">
            <button
              type="button"
              className="play-btn big"
              aria-label={isPlaying ? t('player.pause') : t('player.play')}
              onClick={() => void (live ? togglePlay() : playGenerator())}
            >
              <Icon name={isPlaying ? 'pause' : 'play'} size={24} />
            </button>
            <div className="status grow">
              <strong>{isPlaying ? t('gen.playing') : live ? t('player.paused') : t('gen.ready')}</strong>
              {isPlaying ? t('gen.liveHint') : t('gen.readyHint')}
            </div>
            {live ? <IconButton icon="stop" label={t('player.stop')} onClick={stopPlayback} /> : null}
          </div>

          <div className="sep" style={{ margin: '2px 0' }} />

          <div className="field">
            <span className="field-label">{t('gen.duration')}</span>
            <Segmented<'loop' | 'timed'>
              label={t('gen.duration')}
              value={gen.loop ? 'loop' : 'timed'}
              onChange={(v) => setGenerator({ ...gen, loop: v === 'loop' })}
              options={[
                { value: 'loop', label: t('gen.continuous') },
                { value: 'timed', label: t('gen.timed') },
              ]}
            />
          </div>
          {!gen.loop ? (
            <div className="field">
              <label className="field-label">{t('gen.minutes')}</label>
              <NumberField
                label={t('gen.minutes')}
                value={stage.durationSec / 60}
                min={1}
                max={LIMITS.stageMaxSec / 60}
                decimals={0}
                unit={t('unit.minShort')}
                onChange={(m) => setStage({ durationSec: Math.round(m * 60) })}
              />
            </div>
          ) : (
            <p className="small muted">{t('gen.continuousHint')}</p>
          )}
          <div className="row" style={{ gap: 12 }}>
            <div className="field grow">
              <label className="field-label">{t('gen.fadeIn')}</label>
              <NumberField
                label={t('gen.fadeIn')}
                value={gen.fadeInSec}
                min={0}
                max={120}
                decimals={0}
                unit={t('unit.secShort')}
                onChange={(fadeInSec) => setGenerator({ ...gen, fadeInSec })}
              />
            </div>
            <div className="field grow">
              <label className="field-label">{t('gen.fadeOut')}</label>
              <NumberField
                label={t('gen.fadeOut')}
                value={gen.fadeOutSec}
                min={0}
                max={300}
                decimals={0}
                unit={t('unit.secShort')}
                onChange={(fadeOutSec) => setGenerator({ ...gen, fadeOutSec })}
              />
            </div>
          </div>
          <LabeledSlider label={t('gen.intensity')} value={stage.volume} onChange={(volume) => setStage({ volume })} />
        </div>
      </section>

      <div className="section-title">
        <h2>{t('gen.layers')}</h2>
        <span className="hint">{t('gen.layersHint', { n: layers.length, max: LIMITS.maxLayers })}</span>
      </div>
      <div className="strips">
        {layers.map((l) => (
          <LayerStrip
            key={l.id}
            layer={l}
            canRemove={layers.length > 1}
            onChange={(patch) => updateGeneratorLayers((ls) => ls.map((x) => (x.id === l.id ? { ...x, ...patch } : x)))}
            onRemove={() => updateGeneratorLayers((ls) => ls.filter((x) => x.id !== l.id))}
            onDuplicate={
              layers.length < LIMITS.maxLayers
                ? () => updateGeneratorLayers((ls) => [...ls, { ...l, id: uid('layer') }])
                : undefined
            }
          />
        ))}
      </div>
      <div className="add-layer">
        <span className="small muted" style={{ marginRight: 4 }}>
          {t('gen.addLayer')}
        </span>
        {ADD.map((k) => (
          <Button
            key={k}
            size="sm"
            disabled={layers.length >= LIMITS.maxLayers}
            onClick={() => updateGeneratorLayers((ls) => [...ls, makeLayer(k, { volume: 0.4 })])}
          >
            <span style={{ color: KIND_COLOR[k], display: 'inline-flex' }}>
              <Icon name={KIND_ICON[k]} size={15} />
            </span>
            {t(`kind.${k}`)}
          </Button>
        ))}
      </div>

      <ConceptsNote />
    </div>
  );
}

function ConceptsNote() {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel panel-pad" style={{ marginTop: 26 }}>
      <button type="button" className="row linklike" style={{ textDecoration: 'none', color: 'var(--text)' }} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} />
        <h3>{t('concepts.title')}</h3>
      </button>
      {open ? (
        <div className="col" style={{ marginTop: 12, gap: 12 }}>
          <p className="prose">
            <span className="chip q-tone" style={{ marginRight: 8 }}>
              <span className="dot" />
              {t('q.audible')}
            </span>
            {t('concepts.audible')}
          </p>
          <p className="prose">
            <span className="chip q-beat" style={{ marginRight: 8 }}>
              <span className="dot" />
              {t('q.rhythm')}
            </span>
            {t('concepts.rhythm')}
          </p>
          <p className="prose">
            <span className="chip q-brain" style={{ marginRight: 8 }}>
              <span className="dot" />
              {t('q.brain')}
            </span>
            {t('concepts.brain')}
          </p>
          <p className="prose muted">{t('concepts.example', { a: fmtHz(195), b: fmtHz(205), c: fmtHz(10) })}</p>
        </div>
      ) : null}
    </div>
  );
}
