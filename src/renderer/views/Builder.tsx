import { useEffect, useState } from 'react';
import { transitionLength } from '../../shared/audio/engine';
import { LIMITS, makeLayer, makeSession, makeStage, sessionDuration, uid } from '../../shared/model';
import type { LayerKind, Session, Stage } from '../../shared/types';
import { playerStatus } from '../audio/AudioService';
import { fmtDuration, fmtNum, fmtTime, t } from '../i18n';
import {
  app,
  deleteUserSession,
  duplicateToLibrary,
  exportPresetsFile,
  importPresetsFile,
  openModal,
  playSession,
  saveUserSession,
  stopPlayback,
} from '../state/app';
import { Icon } from '../ui/Icon';
import { Button, IconButton, LabeledSlider, NumberField, Segmented, Switch } from '../ui/controls';
import { KIND_COLOR, KIND_ICON, LayerStrip } from './LayerStrip';

const ADD: LayerKind[] = ['binaural', 'isochronic', 'monaural', 'am', 'tone', 'noise'];

function newSession(): Session {
  const layerId = uid('layer');
  const noiseId = uid('layer');
  return makeSession({
    name: t('builder.untitled'),
    meta: { direction: 'custom' },
    stages: [
      makeStage({
        name: t('builder.stageN', { n: 1 }),
        durationSec: 600,
        layers: [
          makeLayer('binaural', { id: layerId, carrierHz: 200, beatHz: 10, volume: 0.5 }),
          makeLayer('noise', { id: noiseId, noiseColor: 'pink', volume: 0.25 }),
        ],
      }),
      makeStage({
        name: t('builder.stageN', { n: 2 }),
        durationSec: 600,
        transitionSec: 60,
        layers: [
          makeLayer('binaural', { id: layerId, carrierHz: 180, beatHz: 6, volume: 0.45 }),
          makeLayer('noise', { id: noiseId, noiseColor: 'pink', volume: 0.25 }),
        ],
      }),
    ],
  });
}

export function Builder() {
  const sessions = app.use((s) => s.library.sessions);
  const builderId = app.use((s) => s.builderId);
  const current = sessions.find((s) => s.id === builderId) ?? null;

  useEffect(() => {
    if (!current && sessions.length) app.set({ builderId: sessions[0].id });
  }, [current, sessions]);

  const create = () => {
    const s = saveUserSession(newSession());
    app.set({ builderId: s.id });
  };

  return (
    <div className="view-inner">
      <div className="page-head">
        <div className="grow">
          <h1>{t('builder.title')}</h1>
          <p className="lead">{t('builder.lead')}</p>
        </div>
        <Button icon="upload" onClick={() => void importPresetsFile()}>
          {t('presets.import')}
        </Button>
        <Button icon="plus" variant="primary" onClick={create}>
          {t('builder.new')}
        </Button>
      </div>
      <div className="builder">
        <nav className="panel session-list" aria-label={t('builder.mySessions')}>
          {sessions.length === 0 ? <p className="small muted" style={{ padding: 10 }}>{t('builder.none')}</p> : null}
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="item"
              aria-selected={s.id === current?.id}
              onClick={() => app.set({ builderId: s.id })}
            >
              <span>{s.name}</span>
              <span className="s">
                {s.loop ? t('presets.continuous') : fmtDuration(sessionDuration(s))} · {t('presets.stages', { n: s.stages.length })}
              </span>
            </button>
          ))}
        </nav>
        {current ? (
          <SessionEditor key={current.id} session={current} />
        ) : (
          <div className="panel empty">
            <h2>{t('builder.emptyTitle')}</h2>
            <p>{t('builder.emptyText')}</p>
            <Button icon="plus" variant="primary" onClick={create}>
              {t('builder.new')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionEditor({ session }: { session: Session }) {
  const [sel, setSel] = useState(0);
  const np = app.use((s) => s.nowPlaying);
  const state = playerStatus.use((s) => s.state);
  const stageIndex = playerStatus.use((s) => s.stageIndex);
  const isThis = np?.kind === 'session' && np.id === session.id && state !== 'stopped' && state !== 'ended';
  const idx = Math.min(sel, session.stages.length - 1);
  const stage = session.stages[idx];

  const save = (patch: Partial<Session>) => saveUserSession({ ...session, ...patch });
  const setStages = (stages: Stage[]) => save({ stages });
  const setStage = (patch: Partial<Stage>) => setStages(session.stages.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const addStage = () => {
    if (session.stages.length >= LIMITS.maxStages) return;
    const last = session.stages[session.stages.length - 1];
    // keep layer ids so the new stage morphs smoothly from the previous one
    const st = makeStage({
      name: t('builder.stageN', { n: session.stages.length + 1 }),
      durationSec: last.durationSec,
      transitionSec: 30,
      volume: last.volume,
      layers: last.layers.map((l) => ({ ...l })),
    });
    setStages([...session.stages, st]);
    setSel(session.stages.length);
  };
  const moveStage = (dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= session.stages.length) return;
    const arr = [...session.stages];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    setStages(arr);
    setSel(j);
  };

  return (
    <div className="col" style={{ gap: 16, minWidth: 0 }}>
      <section className="panel panel-pad">
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field grow" style={{ minWidth: 220 }}>
            <label className="field-label" htmlFor="sess-name">
              {t('builder.name')}
            </label>
            <input id="sess-name" className="input" value={session.name} maxLength={120} onChange={(e) => save({ name: e.target.value })} />
          </div>
          <Button
            icon={isThis ? 'stop' : 'play'}
            variant={isThis ? undefined : 'primary'}
            onClick={() => (isThis ? stopPlayback() : void playSession(session))}
          >
            {isThis ? t('player.stop') : t('builder.playFromStart')}
          </Button>
          <Button icon="download" onClick={() => openModal({ kind: 'export', session, title: session.name })}>
            {t('common.export')}
          </Button>
          <IconButton icon="copy" label={t('common.duplicate')} onClick={() => duplicateToLibrary(session)} />
          <IconButton icon="external" label={t('builder.exportJson')} onClick={() => void exportPresetsFile([session], session.name)} />
          <IconButton
            icon="trash"
            label={t('common.delete')}
            onClick={() =>
              openModal({
                kind: 'confirm',
                title: t('presets.deleteTitle'),
                text: t('presets.deleteText', { name: session.name }),
                confirm: t('common.delete'),
                danger: true,
                run: () => deleteUserSession(session.id),
              })
            }
          />
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label className="field-label" htmlFor="sess-purpose">
            {t('builder.purpose')}
          </label>
          <input
            id="sess-purpose"
            className="input"
            maxLength={600}
            placeholder={t('builder.purposePh')}
            value={session.meta?.purpose ?? ''}
            onChange={(e) => save({ meta: { direction: 'custom', ...session.meta, purpose: e.target.value } })}
          />
        </div>
        <div className="grid-fields" style={{ marginTop: 14 }}>
          <div className="field">
            <span className="field-label">{t('builder.fadeIn')}</span>
            <NumberField label={t('builder.fadeIn')} value={session.fadeInSec} min={0} max={LIMITS.fadeMaxSec} decimals={0} unit={t('unit.secShort')} onChange={(fadeInSec) => save({ fadeInSec })} />
          </div>
          <div className="field">
            <span className="field-label">{t('builder.fadeOut')}</span>
            <NumberField label={t('builder.fadeOut')} value={session.fadeOutSec} min={0} max={LIMITS.fadeMaxSec} decimals={0} unit={t('unit.secShort')} onChange={(fadeOutSec) => save({ fadeOutSec })} />
          </div>
          <label className="switch-row" style={{ alignSelf: 'end', height: 34 }}>
            <Switch checked={session.loop} onChange={(loop) => save({ loop })} label={t('builder.loop')} />
            <span>
              {t('builder.loop')}
              <span className="small muted" style={{ display: 'block' }}>
                {t('builder.loopHint')}
              </span>
            </span>
          </label>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          {t('builder.total', { d: fmtTime(sessionDuration(session)) })} · {t('builder.autosave')}
        </p>
      </section>

      <Timeline session={session} selected={idx} onSelect={setSel} playingIndex={isThis ? stageIndex : -1} />

      <div className="stage-tabs" role="tablist" aria-label={t('builder.stages')}>
        {session.stages.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            className="stage-tab"
            aria-selected={i === idx}
            onClick={() => setSel(i)}
          >
            <span>
              {i + 1}. {s.name}
            </span>
            <span className="s">
              {fmtDuration(s.durationSec)}
              {i > 0 ? ` · ${s.transition === 'instant' ? t('builder.instant') : t('builder.morphShort', { s: fmtNum(s.transitionSec, 0) })}` : ''}
              {isThis && stageIndex === i ? ` · ${t('builder.nowPlaying')}` : ''}
            </span>
          </button>
        ))}
        <button type="button" className="stage-tab add" onClick={addStage} aria-label={t('builder.addStage')} title={t('builder.addStage')}>
          <Icon name="plus" />
        </button>
      </div>

      <section className="panel panel-pad">
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field grow" style={{ minWidth: 160 }}>
            <label className="field-label" htmlFor="stage-name">
              {t('builder.stageName')}
            </label>
            <input id="stage-name" className="input" value={stage.name} maxLength={80} onChange={(e) => setStage({ name: e.target.value })} />
          </div>
          <div className="field" style={{ width: 140 }}>
            <span className="field-label">{t('builder.stageMinutes')}</span>
            <NumberField
              label={t('builder.stageMinutes')}
              value={stage.durationSec / 60}
              min={LIMITS.stageMinSec / 60}
              max={LIMITS.stageMaxSec / 60}
              decimals={1}
              unit={t('unit.minShort')}
              onChange={(m) => setStage({ durationSec: Math.max(1, Math.round(m * 60)) })}
            />
          </div>
          <IconButton icon="chevronLeft" label={t('builder.moveLeft')} onClick={() => moveStage(-1)} disabled={idx === 0} />
          <IconButton icon="chevronRight" label={t('builder.moveRight')} onClick={() => moveStage(1)} disabled={idx === session.stages.length - 1} />
          <IconButton
            icon="copy"
            label={t('builder.duplicateStage')}
            disabled={session.stages.length >= LIMITS.maxStages}
            onClick={() => {
              const arr = [...session.stages];
              arr.splice(idx + 1, 0, { ...stage, id: uid('stage'), name: `${stage.name} (${t('common.copy')})`, layers: stage.layers.map((l) => ({ ...l })) });
              setStages(arr);
              setSel(idx + 1);
            }}
          />
          <IconButton
            icon="trash"
            label={t('builder.deleteStage')}
            disabled={session.stages.length <= 1}
            onClick={() => {
              setStages(session.stages.filter((_, i) => i !== idx));
              setSel(Math.max(0, idx - 1));
            }}
          />
        </div>

        {idx > 0 ? (
          <div className="grid-fields" style={{ marginTop: 14 }}>
            <div className="field">
              <span className="field-label">{t('builder.transition')}</span>
              <Segmented<'smooth' | 'instant'>
                label={t('builder.transition')}
                value={stage.transition}
                onChange={(transition) => setStage({ transition })}
                options={[
                  { value: 'smooth', label: t('builder.smooth') },
                  { value: 'instant', label: t('builder.instant') },
                ]}
              />
            </div>
            {stage.transition === 'smooth' ? (
              <div className="field">
                <span className="field-label">{t('builder.transitionSec')}</span>
                <NumberField
                  label={t('builder.transitionSec')}
                  value={stage.transitionSec}
                  min={0}
                  max={Math.min(LIMITS.transitionMaxSec, stage.durationSec)}
                  decimals={0}
                  unit={t('unit.secShort')}
                  onChange={(transitionSec) => setStage({ transitionSec })}
                />
              </div>
            ) : (
              <p className="small muted" style={{ alignSelf: 'end' }}>
                {t('builder.instantHint')}
              </p>
            )}
            <LabeledSlider label={t('builder.intensity')} value={stage.volume} onChange={(volume) => setStage({ volume })} />
          </div>
        ) : (
          <div className="grid-fields" style={{ marginTop: 14 }}>
            <p className="small muted" style={{ alignSelf: 'end' }}>
              {t('builder.firstStageHint')}
            </p>
            <LabeledSlider label={t('builder.intensity')} value={stage.volume} onChange={(volume) => setStage({ volume })} />
          </div>
        )}
        {idx > 0 ? <p className="small muted" style={{ marginTop: 10 }}>{t('builder.morphHint')}</p> : null}
      </section>

      <div className="strips">
        {stage.layers.map((l) => (
          <LayerStrip
            key={l.id}
            layer={l}
            onChange={(patch) => setStage({ layers: stage.layers.map((x) => (x.id === l.id ? { ...x, ...patch } : x)) })}
            onRemove={() => setStage({ layers: stage.layers.filter((x) => x.id !== l.id) })}
          />
        ))}
        {stage.layers.length === 0 ? <div className="panel empty"><p>{t('builder.silentStage')}</p></div> : null}
      </div>
      <div className="add-layer">
        <span className="small muted" style={{ marginRight: 4 }}>
          {t('gen.addLayer')}
        </span>
        {ADD.map((k) => (
          <Button
            key={k}
            size="sm"
            disabled={stage.layers.length >= LIMITS.maxLayers}
            onClick={() => setStage({ layers: [...stage.layers, makeLayer(k, { volume: 0.4 })] })}
          >
            <span style={{ color: KIND_COLOR[k], display: 'inline-flex' }}>
              <Icon name={KIND_ICON[k]} size={15} />
            </span>
            {t(`kind.${k}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Frequency-over-time view of the programme: rhythm (amber) and carriers (sea-glass). */
function Timeline({
  session,
  selected,
  onSelect,
  playingIndex,
}: {
  session: Session;
  selected: number;
  onSelect: (i: number) => void;
  playingIndex: number;
}) {
  const position = playerStatus.use((s) => s.position);
  const W = 1000;
  const H = 170;
  const total = sessionDuration(session) || 1;
  const x = (sec: number) => (sec / total) * W;
  const rhythmY = (hz: number) => 18 + (1 - Math.log(Math.max(0.5, Math.min(100, hz)) / 0.5) / Math.log(200)) * 70;
  const carrierY = (hz: number) => 104 + (1 - Math.log(Math.max(20, Math.min(20000, hz)) / 20) / Math.log(1000)) * 50;

  const starts: number[] = [];
  let acc = 0;
  for (const st of session.stages) {
    starts.push(acc);
    acc += st.durationSec;
  }
  const lines: { d: string; color: string; key: string }[] = [];
  session.stages.forEach((st, i) => {
    const s0 = starts[i];
    const tr = i > 0 ? transitionLength(st) : 0;
    const prev = i > 0 ? session.stages[i - 1] : null;
    for (const l of st.layers) {
      if (!l.enabled || l.kind === 'noise') continue;
      const p = prev?.layers.find((q) => q.id === l.id && q.kind === l.kind && q.enabled);
      const segs: [number, (h: number) => number, number, number | undefined, string][] = [];
      if (l.kind !== 'tone') segs.push([l.beatHz, rhythmY, 0, p && p.kind !== 'tone' ? p.beatHz : undefined, 'var(--beat)']);
      segs.push([l.carrierHz, carrierY, 1, p?.carrierHz, 'var(--tone)']);
      for (const [hz, yf, n, prevHz, color] of segs) {
        let d = '';
        if (prevHz !== undefined) d += `M${x(s0)},${yf(prevHz)} L${x(s0 + tr)},${yf(hz)} `;
        else d += `M${x(s0 + tr)},${yf(hz)} `;
        d += `L${x(s0 + st.durationSec)},${yf(hz)}`;
        lines.push({ d, color, key: `${st.id}-${l.id}-${n}` });
      }
    }
  });

  return (
    <div className="timeline" aria-label={t('builder.timeline')}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {session.stages.map((st, i) => (
          <rect
            key={st.id}
            x={x(starts[i])}
            y={0}
            width={x(st.durationSec)}
            height={H}
            fill={i === selected ? 'color-mix(in srgb, var(--accent) 9%, transparent)' : i % 2 ? 'var(--line)' : 'transparent'}
            opacity={i === selected ? 1 : 0.5}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelect(i)}
          />
        ))}
        <line x1={0} x2={W} y1={96} y2={96} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
        {lines.map((l) => (
          <path key={l.key} d={l.d} fill="none" stroke={l.color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" pointerEvents="none" />
        ))}
        {playingIndex >= 0 ? (
          <line x1={x(Math.min(position, total))} x2={x(Math.min(position, total))} y1={0} y2={H} stroke="var(--text)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
      <div className="small muted" style={{ position: 'absolute', left: 10, top: 4, pointerEvents: 'none', color: 'var(--beat)' }}>
        {t('q.rhythm')}
      </div>
      <div className="small muted" style={{ position: 'absolute', left: 10, top: 100, pointerEvents: 'none', color: 'var(--tone)' }}>
        {t('builder.carriers')}
      </div>
    </div>
  );
}
