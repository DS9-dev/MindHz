import { useMemo, useRef, useState } from 'react';
import { REF_BY_ID, refLink } from '../../shared/catalog/references';
import { estimateBytes, finiteSession } from '../../shared/export/render';
import { WAV_MAX_BYTES } from '../../shared/export/wav';
import { needsHeadphones, sessionDuration } from '../../shared/model';
import type { ExportSettings, Session } from '../../shared/types';
import { api } from '../api';
import { type ExportJob, startExport } from '../audio/exporter';
import { fmtBytes, fmtDuration, fmtNum, t } from '../i18n';
import { MiniTimeline } from '../views/Presets';
import {
  addCustomFrequency,
  app,
  closeModal,
  duplicateToLibrary,
  playSession,
  saveUserSession,
  toast,
  updateSettings,
  type Modal as ModalState,
} from '../state/app';
import { Icon } from '../ui/Icon';
import { Button, EvidenceBadge, Modal, NumberField, Segmented, Select } from '../ui/controls';

export function Dialogs() {
  const modal = app.use((s) => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case 'export':
      return <ExportDialog session={modal.session} title={modal.title} />;
    case 'safety':
      return <SafetyDialog />;
    case 'preset':
      return <PresetDialog session={modal.session} />;
    case 'save-preset':
      return <SavePresetDialog session={modal.session} />;
    case 'confirm':
      return <ConfirmDialog m={modal} />;
    case 'custom-frequency':
      return <CustomFrequencyDialog />;
  }
}

function SafetyDialog() {
  const accepted = app.use((s) => s.settings.safetyAccepted);
  const accept = () => {
    updateSettings({ safetyAccepted: true });
    closeModal();
  };
  return (
    <Modal
      title={t('safety.title')}
      onClose={accepted ? closeModal : undefined}
      footer={
        <Button variant="primary" icon="check" onClick={accept}>
          {accepted ? t('common.close') : t('safety.accept')}
        </Button>
      }
    >
      <p className="prose">{t('safety.intro')}</p>
      <ul className="safety-list">
        {(['volume', 'start', 'rhythm', 'stop', 'medical', 'driving'] as const).map((k) => (
          <li key={k}>
            <Icon name={k === 'volume' ? 'speaker' : k === 'medical' ? 'shield' : k === 'rhythm' ? 'pulse' : k === 'driving' ? 'warn' : k === 'stop' ? 'stop' : 'info'} />
            <span>{t(`safety.${k}`)}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function ConfirmDialog({ m }: { m: Extract<ModalState, { kind: 'confirm' }> }) {
  return (
    <Modal
      title={m.title}
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={m.danger ? 'danger solid' : 'primary'}
            onClick={() => {
              closeModal();
              m.run();
            }}
          >
            {m.confirm}
          </Button>
        </>
      }
    >
      <p className="prose">{m.text}</p>
    </Modal>
  );
}

function PresetDialog({ session: s }: { session: Session }) {
  return (
    <Modal
      wide
      title={s.name}
      onClose={closeModal}
      footer={
        <>
          {s.builtin ? (
            <Button
              icon="copy"
              variant="ghost"
              onClick={() => {
                closeModal();
                duplicateToLibrary(s);
              }}
            >
              {t('presets.editCopy')}
            </Button>
          ) : null}
          <Button
            icon="play"
            variant="primary"
            onClick={() => {
              closeModal();
              void playSession(s);
            }}
          >
            {t('presets.play')}
          </Button>
        </>
      }
    >
      <div className="row wrap" style={{ gap: 14, marginBottom: 12 }}>
        {s.meta?.evidence ? <EvidenceBadge level={s.meta.evidence} /> : null}
        <span className="small muted">{s.loop ? t('presets.continuous') : fmtDuration(sessionDuration(s))}</span>
        {s.stages.some((st) => needsHeadphones(st.layers)) ? (
          <span className="small muted row" style={{ gap: 4 }}>
            <Icon name="headphones" size={14} />
            {t('presets.headphones')}
          </span>
        ) : null}
      </div>
      {s.meta?.purpose ? <p className="prose" style={{ fontSize: 15 }}>{s.meta.purpose}</p> : null}
      {s.meta?.explanation ? (
        <div className="science-block" style={{ marginTop: 14 }}>
          <h3>
            <Icon name="book" size={17} />
            {s.meta.evidence === 'esoteric' ? t('presets.aboutEsoteric') : t('presets.aboutScience')}
          </h3>
          <p className="prose">{s.meta.explanation}</p>
          {s.meta.evidence ? <p className="small muted" style={{ marginTop: 6 }}>{t(`evidence.${s.meta.evidence}.long`)}</p> : null}
        </div>
      ) : null}
      <div className="science-block">
        <h3>{t('presets.programme')}</h3>
        <MiniTimeline session={s} />
        <ol className="refs" style={{ listStyle: 'decimal', paddingLeft: 20 }}>
          {s.stages.map((st, i) => (
            <li key={st.id}>
              <b>{st.name}</b> — {fmtDuration(st.durationSec)}
              {i > 0 ? `, ${st.transition === 'instant' ? t('builder.instant').toLowerCase() : t('builder.morphShort', { s: fmtNum(st.transitionSec, 0) })}` : ''}
              <div className="note">
                {st.layers
                  .filter((l) => l.enabled)
                  .map((l) =>
                    l.kind === 'noise'
                      ? `${t('kind.noise')} (${t(`noise.${l.noiseColor}`).toLowerCase()})`
                      : l.kind === 'tone'
                        ? `${t('kind.tone')} ${fmtNum(l.carrierHz, 2)} ${t('unit.hz')}`
                        : `${t(`kind.${l.kind}`)} ${fmtNum(l.beatHz, 2)} ${t('unit.hz')} / ${fmtNum(l.carrierHz, 1)} ${t('unit.hz')}`,
                  )
                  .join(' + ')}
              </div>
            </li>
          ))}
        </ol>
      </div>
      {s.meta?.refs?.length ? (
        <div className="science-block">
          <h3>{t('catalog.sources')}</h3>
          <ul className="refs">
            {s.meta.refs.map((id) => {
              const r = REF_BY_ID[id];
              if (!r) return null;
              const link = refLink(r);
              return (
                <li key={id}>
                  {r.authors} ({r.year}). <i>{r.title}</i>. {r.venue}.{' '}
                  {link ? (
                    <button type="button" className="linklike small" onClick={() => void api.openExternal(link)}>
                      {t('catalog.openSource')}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <p className="small muted" style={{ marginTop: 16 }}>
        {t('presets.disclaimer')}
      </p>
    </Modal>
  );
}

function SavePresetDialog({ session }: { session: Session }) {
  const [name, setName] = useState(session.name);
  const [purpose, setPurpose] = useState(session.meta?.purpose ?? '');
  const save = () => {
    const stages = session.stages.map((st) => ({ ...st, durationSec: session.loop ? Math.max(st.durationSec, 600) : st.durationSec }));
    const s = saveUserSession({
      ...session,
      name: name.trim() || t('gen.newPresetName'),
      stages,
      meta: { ...(session.meta ?? { direction: 'custom' }), direction: 'custom', purpose },
      createdAt: Date.now(),
    });
    closeModal();
    toast('success', t('toast.presetSaved', { name: s.name }), {
      label: t('toast.open'),
      run: () => app.set({ builderId: s.id, view: 'builder' }),
    });
  };
  return (
    <Modal
      title={t('save.title')}
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon="check" onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <div className="field">
          <label className="field-label" htmlFor="sp-name">
            {t('builder.name')}
          </label>
          <input id="sp-name" autoFocus className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="sp-purpose">
            {t('builder.purpose')}
          </label>
          <textarea id="sp-purpose" className="input" value={purpose} maxLength={600} placeholder={t('builder.purposePh')} onChange={(e) => setPurpose(e.target.value)} />
        </div>
        <p className="small muted">{t('save.hint')}</p>
      </div>
    </Modal>
  );
}

function CustomFrequencyDialog() {
  const [name, setName] = useState('');
  const [hz, setHz] = useState(100);
  const [quantity, setQuantity] = useState<'audible' | 'rhythm'>('audible');
  const [note, setNote] = useState('');
  const save = () => {
    addCustomFrequency({ name: name.trim() || `${fmtNum(hz, 2)} ${t('unit.hz')}`, hz, quantity, note });
    closeModal();
    toast('success', t('custom.saved'));
  };
  return (
    <Modal
      title={t('custom.title')}
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon="check" onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <div className="field">
          <label className="field-label" htmlFor="cf-name">
            {t('custom.name')}
          </label>
          <input id="cf-name" autoFocus className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="row" style={{ gap: 14, alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 160 }}>
            <span className="field-label">{t('custom.value')}</span>
            <NumberField label={t('custom.value')} value={hz} onChange={setHz} min={0.1} max={20000} step={1} unit={t('unit.hz')} />
          </div>
          <div className="field">
            <span className="field-label">{t('custom.quantity')}</span>
            <Segmented<'audible' | 'rhythm'>
              label={t('custom.quantity')}
              value={quantity}
              onChange={setQuantity}
              options={[
                { value: 'audible', label: t('quantity.audible') },
                { value: 'rhythm', label: t('quantity.rhythm') },
              ]}
            />
          </div>
        </div>
        <p className="small muted">{quantity === 'audible' ? t('custom.audibleHint') : t('custom.rhythmHint')}</p>
        {quantity === 'audible' && hz < 20 ? <p className="small" style={{ color: 'var(--warn)' }}>{t('custom.inaudible')}</p> : null}
        <div className="field">
          <label className="field-label" htmlFor="cf-note">
            {t('custom.note')}
          </label>
          <textarea id="cf-note" className="input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

type Phase = { kind: 'setup' } | { kind: 'running'; progress: number } | { kind: 'done'; path: string; fileName: string; bytes: number } | { kind: 'error'; message: string };

function ExportDialog({ session, title }: { session: Session; title: string }) {
  const defaults = app.use((s) => s.settings.export);
  const [o, setO] = useState<ExportSettings>({
    ...defaults,
    fadeInSec: session.fadeInSec,
    fadeOutSec: session.fadeOutSec,
    durationMin: session.loop ? defaults.durationMin : sessionDuration(session) / 60,
  });
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const job = useRef<ExportJob | null>(null);
  const seconds = Math.round(o.durationMin * 60);
  const bitDepth = o.format === 'flac' && o.bitDepth === 32 ? 24 : o.bitDepth;
  const size = estimateBytes({ format: o.format, sampleRate: o.sampleRate, bitDepth, channels: o.channels }, seconds);
  const tooBig = o.format === 'wav' && size > WAV_MAX_BYTES;
  const binaural = session.stages.some((st) => needsHeadphones(st.layers));
  const programmeMin = sessionDuration(session) / 60;

  const fileName = useMemo(() => {
    const safe = title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) || 'MindHz';
    return `${safe} — ${fmtDuration(seconds)}`;
  }, [title, seconds]);

  const run = async () => {
    updateSettings({ export: { ...o, bitDepth } });
    const s = finiteSession(session, seconds, { in: o.fadeInSec, out: o.fadeOutSec });
    setPhase({ kind: 'running', progress: 0 });
    const j = startExport(s, { format: o.format, sampleRate: o.sampleRate, bitDepth, channels: o.channels }, fileName, (p) =>
      setPhase({ kind: 'running', progress: p }),
    );
    job.current = j;
    try {
      const r = await j.promise;
      if (!r) setPhase({ kind: 'setup' });
      else {
        setPhase({ kind: 'done', ...r });
        toast('success', t('export.doneToast', { name: r.fileName }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'CANCELLED') setPhase({ kind: 'setup' });
      else setPhase({ kind: 'error', message: msg });
    } finally {
      job.current = null;
    }
  };

  const close = () => {
    job.current?.cancel();
    closeModal();
  };

  return (
    <Modal
      title={t('export.title')}
      onClose={phase.kind === 'running' ? closeModal : close}
      footer={
        phase.kind === 'running' ? (
          <>
            <Button variant="ghost" onClick={() => job.current?.cancel()}>
              {t('common.cancel')}
            </Button>
            <Button onClick={closeModal}>{t('export.hide')}</Button>
          </>
        ) : phase.kind === 'done' ? (
          <>
            <Button icon="folder" variant="ghost" onClick={() => void api.export.reveal(phase.path)}>
              {t('export.reveal')}
            </Button>
            <Button variant="primary" onClick={closeModal}>
              {t('common.done')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" icon="download" disabled={tooBig || seconds < 1} onClick={() => void run()}>
              {t('export.start')}
            </Button>
          </>
        )
      }
    >
      <p className="small muted" style={{ marginBottom: 14 }}>
        {title} · {t('export.matchNote')}
      </p>
      {phase.kind === 'setup' || phase.kind === 'error' ? (
        <div className="col" style={{ gap: 14 }}>
          <div className="grid-fields">
            <div className="field">
              <span className="field-label">{t('export.format')}</span>
              <Segmented<'wav' | 'flac'>
                label={t('export.format')}
                value={o.format}
                onChange={(format) => setO({ ...o, format })}
                options={[
                  { value: 'flac', label: 'FLAC', title: t('export.flacHint') },
                  { value: 'wav', label: 'WAV', title: t('export.wavHint') },
                ]}
              />
            </div>
            <div className="field">
              <span className="field-label">{t('export.channels')}</span>
              <Segmented<1 | 2>
                label={t('export.channels')}
                value={o.channels}
                onChange={(channels) => setO({ ...o, channels })}
                options={[
                  { value: 2, label: t('export.stereo') },
                  { value: 1, label: t('export.mono') },
                ]}
              />
            </div>
            <div className="field">
              <span className="field-label">{t('export.sampleRate')}</span>
              <Select<number>
                label={t('export.sampleRate')}
                value={o.sampleRate}
                onChange={(sampleRate) => setO({ ...o, sampleRate })}
                options={[44100, 48000, 96000].map((v) => ({ value: v, label: `${fmtNum(v, 0)} ${t('unit.hz')}` }))}
              />
            </div>
            <div className="field">
              <span className="field-label">{t('export.bitDepth')}</span>
              <Select<number>
                label={t('export.bitDepth')}
                value={bitDepth}
                onChange={(b) => setO({ ...o, bitDepth: b as 16 | 24 | 32 })}
                options={[
                  { value: 16, label: t('export.bit16') },
                  { value: 24, label: t('export.bit24') },
                  ...(o.format === 'wav' ? [{ value: 32, label: t('export.bit32') }] : []),
                ]}
              />
            </div>
            <div className="field">
              <span className="field-label">{t('export.duration')}</span>
              <NumberField
                label={t('export.duration')}
                value={o.durationMin}
                onChange={(durationMin) => setO({ ...o, durationMin })}
                min={0.1}
                max={360}
                decimals={1}
                unit={t('unit.minShort')}
              />
            </div>
            <div className="field">
              <span className="field-label">{t('export.fades')}</span>
              <div className="row" style={{ gap: 6 }}>
                <NumberField label={t('gen.fadeIn')} value={o.fadeInSec} onChange={(fadeInSec) => setO({ ...o, fadeInSec })} min={0} max={600} decimals={0} unit="↗" />
                <NumberField label={t('gen.fadeOut')} value={o.fadeOutSec} onChange={(fadeOutSec) => setO({ ...o, fadeOutSec })} min={0} max={600} decimals={0} unit="↘" />
              </div>
            </div>
          </div>
          {!session.loop && Math.abs(o.durationMin - programmeMin) > 0.05 ? (
            <p className="small muted">{t('export.durationDiffers', { d: fmtDuration(programmeMin * 60) })}</p>
          ) : null}
          {session.loop ? <p className="small muted">{t('export.continuousNote')}</p> : null}
          {o.channels === 1 && binaural ? (
            <div className="issue warn">
              <Icon name="warn" size={16} />
              <span>{t('export.monoBinaural')}</span>
              <Button size="sm" className="btn sm fix" onClick={() => setO({ ...o, channels: 2 })}>
                {t('export.stereo')}
              </Button>
            </div>
          ) : null}
          {tooBig ? (
            <div className="issue error">
              <Icon name="error" size={16} />
              <span>{t('export.wavTooBig')}</span>
              <Button size="sm" className="btn sm fix" onClick={() => setO({ ...o, format: 'flac' })}>
                FLAC
              </Button>
            </div>
          ) : null}
          <p className="small muted">{t('export.size', { size: fmtBytes(size), approx: o.format === 'flac' ? '≈ ' : '' })}</p>
          {phase.kind === 'error' ? (
            <div className="issue error">
              <Icon name="error" size={16} />
              <span>{t('export.failed', { msg: phase.message })}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {phase.kind === 'running' ? (
        <div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{t('export.rendering')}</span>
            <span className="muted">{Math.round(phase.progress * 100)}%</span>
          </div>
          <div className="progress-big">
            <i style={{ width: `${phase.progress * 100}%` }} />
          </div>
          <p className="small muted">{t('export.backgroundNote')}</p>
        </div>
      ) : null}
      {phase.kind === 'done' ? (
        <div className="col" style={{ gap: 8 }}>
          <p className="row" style={{ gap: 8 }}>
            <span style={{ color: 'var(--ok)', display: 'inline-flex' }}>
              <Icon name="check" />
            </span>
            {t('export.done', { name: phase.fileName, size: fmtBytes(phase.bytes) })}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
