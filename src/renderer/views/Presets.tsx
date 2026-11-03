import { BUILTIN_PRESETS, PRESET_DIRECTIONS } from '../../shared/catalog/presets';
import { needsHeadphones, sessionDuration } from '../../shared/model';
import type { Session } from '../../shared/types';
import { playerStatus } from '../audio/AudioService';
import { fmtDuration, t } from '../i18n';
import {
  app,
  deleteUserSession,
  duplicateToLibrary,
  exportPresetsFile,
  importPresetsFile,
  navigate,
  openModal,
  playSession,
  stopPlayback,
} from '../state/app';
import { Icon } from '../ui/Icon';
import { Button, EvidenceBadge, IconButton } from '../ui/controls';

/** Programme shape: rhythm rate (amber) or tone pitch (sea-glass) per stage over time. */
export function MiniTimeline({ session }: { session: Session }) {
  const total = sessionDuration(session) || 1;
  const W = 300;
  const H = 34;
  // y per stage: rhythm rate (log) when the stage has a rhythmic layer, else tone pitch (log)
  const vals = session.stages.map((st) => {
    const lead = st.layers.find((l) => l.enabled && l.kind !== 'noise' && l.kind !== 'tone');
    const tone = st.layers.find((l) => l.enabled && l.kind === 'tone');
    return lead ? Math.log(Math.max(0.1, lead.beatHz)) : tone ? Math.log(tone.carrierHz) : null;
  });
  const rhythmic = session.stages.some((st) => st.layers.some((l) => l.enabled && l.kind !== 'noise' && l.kind !== 'tone'));
  const known = vals.filter((v): v is number => v !== null);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const yOf = (v: number | null) => (v === null || hi - lo < 1e-6 ? H / 2 : H - 7 - ((v - lo) / (hi - lo)) * (H - 14));
  const pts: string[] = [];
  let acc = 0;
  session.stages.forEach((st, i) => {
    const y = yOf(vals[i]);
    const tr = i > 0 ? Math.min(st.transitionSec, st.durationSec) : 0;
    const x1 = ((acc + tr) / total) * W;
    acc += st.durationSec;
    const x2 = (acc / total) * W;
    pts.push(i === 0 ? `M0,${y.toFixed(1)}` : `L${x1.toFixed(1)},${y.toFixed(1)}`);
    pts.push(`L${x2.toFixed(1)},${y.toFixed(1)}`);
  });
  return (
    <svg className="mini-timeline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={pts.join(' ')} fill="none" stroke={rhythmic ? 'var(--beat)' : 'var(--tone)'} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

function PresetCard({ s, mine }: { s: Session; mine?: boolean }) {
  const np = app.use((x) => x.nowPlaying);
  const state = playerStatus.use((x) => x.state);
  const isThis = np?.kind === 'session' && np.id === s.id && state !== 'stopped' && state !== 'ended';
  const headphones = s.stages.some((st) => needsHeadphones(st.layers));
  return (
    <article className={`preset${s.meta?.direction === 'esoteric' ? ' eso' : ''}${isThis ? ' playing' : ''}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <h3 className="grow" style={{ fontSize: 16 }}>
          {s.name}
        </h3>
        {s.meta?.evidence ? <EvidenceBadge level={s.meta.evidence} short={s.meta.evidence !== 'esoteric'} /> : null}
      </div>
      <p className="purpose">{s.meta?.purpose || t('presets.noPurpose')}</p>
      <MiniTimeline session={s} />
      <div className="meta">
        <span>{s.loop ? t('presets.continuous') : fmtDuration(sessionDuration(s))}</span>
        <span>{t('presets.stages', { n: s.stages.length })}</span>
        {headphones ? (
          <span className="row" style={{ gap: 4 }} title={t('issue.headphones')}>
            <Icon name="headphones" size={14} />
            {t('presets.headphones')}
          </span>
        ) : (
          <span className="row" style={{ gap: 4 }}>
            <Icon name="speaker" size={14} />
            {t('presets.speakers')}
          </span>
        )}
      </div>
      <div className="actions">
        <Button
          icon={isThis ? 'stop' : 'play'}
          variant={isThis ? undefined : 'primary'}
          size="sm"
          onClick={() => (isThis ? stopPlayback() : void playSession(s))}
        >
          {isThis ? t('player.stop') : t('presets.play')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => openModal({ kind: 'preset', session: s })}>
          {t('presets.details')}
        </Button>
        <span className="grow" />
        {mine ? (
          <>
            <IconButton
              icon="edit"
              label={t('common.edit')}
              size={16}
              onClick={() => {
                app.set({ builderId: s.id });
                navigate('builder');
              }}
            />
            <IconButton
              icon="trash"
              label={t('common.delete')}
              size={16}
              onClick={() =>
                openModal({
                  kind: 'confirm',
                  title: t('presets.deleteTitle'),
                  text: t('presets.deleteText', { name: s.name }),
                  confirm: t('common.delete'),
                  danger: true,
                  run: () => deleteUserSession(s.id),
                })
              }
            />
          </>
        ) : (
          <IconButton icon="copy" label={t('presets.editCopy')} size={16} onClick={() => duplicateToLibrary(s)} />
        )}
      </div>
    </article>
  );
}

export function Presets() {
  const mine = app.use((s) => s.library.sessions);
  return (
    <div className="view-inner">
      <div className="page-head">
        <div className="grow">
          <h1>{t('presets.title')}</h1>
          <p className="lead">{t('presets.lead')}</p>
        </div>
        <Button icon="upload" onClick={() => void importPresetsFile()}>
          {t('presets.import')}
        </Button>
        <Button icon="download" disabled={!mine.length} onClick={() => void exportPresetsFile(mine)}>
          {t('presets.exportMine')}
        </Button>
      </div>

      {PRESET_DIRECTIONS.map((d) => (
        <section key={d}>
          <div className="section-title">
            <h2>{t(`direction.${d}`)}</h2>
            <span className="hint">{t(`direction.${d}.hint`)}</span>
          </div>
          <div className="preset-grid">
            {BUILTIN_PRESETS.filter((p) => p.meta?.direction === d).map((p) => (
              <PresetCard key={p.id} s={p} />
            ))}
          </div>
        </section>
      ))}

      <section>
        <div className="section-title">
          <h2>{t('presets.mine')}</h2>
          <span className="hint">{t('presets.mineHint')}</span>
        </div>
        {mine.length ? (
          <div className="preset-grid">
            {mine.map((p) => (
              <PresetCard key={p.id} s={p} mine />
            ))}
          </div>
        ) : (
          <div className="panel empty">
            <p>{t('presets.mineEmpty')}</p>
            <div className="row">
              <Button icon="plus" onClick={() => navigate('builder')}>
                {t('presets.createInBuilder')}
              </Button>
              <Button icon="wave" variant="ghost" onClick={() => navigate('generator')}>
                {t('presets.fromGenerator')}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
