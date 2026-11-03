import { useMemo, useState } from 'react';
import { CATALOG, type CatalogCategory, type CatalogEntry, playSpecToLayer } from '../../shared/catalog/catalog';
import { REF_BY_ID, refLink } from '../../shared/catalog/references';
import { LIMITS, makeLayer } from '../../shared/model';
import type { CustomFrequency, EvidenceLevel } from '../../shared/types';
import { api } from '../api';
import { fmtHz, fmtNum, t } from '../i18n';
import {
  app,
  navigate,
  openModal,
  playGenerator,
  removeCustomFrequency,
  setGenerator,
  toast,
  toggleFavorite,
  updateGeneratorLayers,
} from '../state/app';
import { Icon } from '../ui/Icon';
import { Button, EvidenceBadge, IconButton, QChip, Select } from '../ui/controls';

const CATS: (CatalogCategory | 'all' | 'favorites')[] = [
  'all',
  'favorites',
  'brainwave',
  'acoustic',
  'solfeggio',
  'esoteric',
  'noise',
  'custom',
];

function customToEntry(c: CustomFrequency): CatalogEntry {
  return {
    id: c.id,
    name: c.name,
    category: 'custom',
    quantity: c.quantity,
    value: c.hz,
    summary: c.note || t('catalog.customSummary'),
    purpose: t('catalog.customPurpose'),
    science: t('catalog.customScience'),
    evidence: 'insufficient',
    limitations: t('catalog.customLimits'),
    refs: [],
    play:
      c.quantity === 'rhythm'
        ? [{ kind: 'binaural', carrierHz: 200, beatHz: c.hz }]
        : [{ kind: 'tone', carrierHz: Math.max(20, c.hz), volume: 0.5 }],
    tags: [],
  };
}

const qColor = (e: CatalogEntry) =>
  e.quantity === 'audible' ? 'var(--tone)' : e.quantity === 'rhythm' ? 'var(--beat)' : e.quantity === 'brain' ? 'var(--brain)' : 'var(--text-2)';

export function Catalog() {
  const lib = app.use((s) => s.library);
  const selected = app.use((s) => s.catalogSelection);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<(typeof CATS)[number]>('all');
  const [ev, setEv] = useState<EvidenceLevel | 'any'>('any');

  const all = useMemo(() => [...CATALOG, ...lib.customFrequencies.map(customToEntry)], [lib.customFrequencies]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(',', '.');
    return all.filter((e) => {
      if (cat === 'favorites' && !lib.favorites.includes(e.id)) return false;
      if (cat !== 'all' && cat !== 'favorites' && e.category !== cat) return false;
      if (ev !== 'any' && e.evidence !== ev) return false;
      if (!needle) return true;
      const hay = `${e.name} ${e.summary} ${e.purpose} ${e.tags.join(' ')} ${e.value ?? ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [all, q, cat, ev, lib.favorites]);

  const groups = useMemo(() => {
    const m = new Map<CatalogCategory, CatalogEntry[]>();
    for (const e of list) {
      if (!m.has(e.category)) m.set(e.category, []);
      m.get(e.category)!.push(e);
    }
    return [...m.entries()];
  }, [list]);

  const current = all.find((e) => e.id === selected) ?? list[0] ?? null;

  return (
    <div className="view-inner">
      <div className="page-head">
        <div className="grow">
          <h1>{t('catalog.title')}</h1>
          <p className="lead">{t('catalog.lead')}</p>
        </div>
        <Button icon="plus" onClick={() => openModal({ kind: 'custom-frequency' })}>
          {t('catalog.addCustom')}
        </Button>
      </div>

      <div className="catalog">
        <div className="panel">
          <div style={{ padding: '14px 14px 6px' }}>
            <div className="search">
              <Icon name="search" size={16} />
              <input
                className="input"
                placeholder={t('catalog.search')}
                aria-label={t('catalog.search')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="filters" role="group" aria-label={t('catalog.categories')}>
              {CATS.map((c) => (
                <button key={c} type="button" className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>
                  {c === 'favorites' ? <Icon name="star" size={13} /> : null}
                  {t(`cat.${c}`)}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <Select<EvidenceLevel | 'any'>
                label={t('catalog.evidenceFilter')}
                value={ev}
                onChange={setEv}
                options={[
                  { value: 'any', label: t('catalog.anyEvidence') },
                  ...(['established', 'supported', 'preliminary', 'insufficient', 'esoteric'] as const).map((x) => ({
                    value: x,
                    label: t(`evidence.${x}`),
                  })),
                ]}
              />
            </div>
          </div>
          <div className="catalog-list" role="listbox" aria-label={t('catalog.title')}>
            {groups.length === 0 ? (
              <div className="empty">
                <p>{cat === 'favorites' ? t('catalog.noFavorites') : cat === 'custom' ? t('catalog.noCustom') : t('catalog.nothing')}</p>
              </div>
            ) : null}
            {groups.map(([g, entries]) => (
              <div key={g}>
                <div className="catalog-group">{t(`cat.${g}`)}</div>
                {entries.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    role="option"
                    className="entry"
                    aria-selected={current?.id === e.id}
                    onClick={() => app.set({ catalogSelection: e.id })}
                    style={{ '--c': qColor(e) } as React.CSSProperties}
                  >
                    <span className="hz">
                      {e.value === null ? '∿' : fmtNum(e.value, 2)}
                      {e.value !== null ? <small>{t('unit.hz')}</small> : null}
                    </span>
                    <span className="nm">
                      <div>{e.name}</div>
                      <div className="s">{t(`quantity.${e.quantity}`)}</div>
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      {lib.favorites.includes(e.id) ? (
                        <span style={{ color: 'var(--beat)', display: 'inline-flex' }}>
                          <Icon name="star" size={14} />
                        </span>
                      ) : null}
                      <EvidenceBadge level={e.evidence} short />
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {current ? <EntryDetail entry={current} favorite={lib.favorites.includes(current.id)} /> : <div />}
      </div>
    </div>
  );
}

function EntryDetail({ entry: e, favorite }: { entry: CatalogEntry; favorite: boolean }) {
  const color = qColor(e);
  const listen = () => {
    const g = app.get().generator;
    const layers = e.play.map((p, i) => makeLayer(p.kind, { ...playSpecToLayer(p), id: `cat-${e.id}-${i}` }));
    setGenerator({ ...g, stages: [{ ...g.stages[0], layers }] });
    void playGenerator();
    toast('info', t('catalog.playingInGenerator', { name: e.name }), { label: t('catalog.openGenerator'), run: () => navigate('generator') });
  };
  const addToGenerator = () => {
    const n = app.get().generator.stages[0].layers.length;
    if (n >= LIMITS.maxLayers) {
      toast('warn', t('catalog.tooManyLayers', { max: LIMITS.maxLayers }));
      return;
    }
    updateGeneratorLayers((ls) => [...ls, ...e.play.map((p) => makeLayer(p.kind, playSpecToLayer(p)))].slice(0, LIMITS.maxLayers));
    toast('success', t('catalog.addedToGenerator'), { label: t('catalog.openGenerator'), run: () => navigate('generator') });
  };
  const how = e.play
    .map((p) =>
      p.kind === 'noise'
        ? t(`noise.${p.noiseColor ?? 'pink'}`) + ' ' + t('kind.noise').toLowerCase()
        : p.kind === 'tone'
          ? `${t('kind.tone')}: ${fmtHz(p.carrierHz ?? 0)}`
          : `${t(`kind.${p.kind}`)}: ${t('layer.carrier').toLowerCase()} ${fmtHz(p.carrierHz ?? 200)}, ${t('q.rhythm').toLowerCase()} ${fmtHz(p.beatHz ?? 10)}`,
    )
    .join('; ');

  return (
    <article className="panel detail" aria-live="polite">
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div className="grow">
          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            {e.quantity === 'audible' ? <QChip q="tone">{t('quantity.audible')}</QChip> : null}
            {e.quantity === 'rhythm' ? <QChip q="beat">{t('quantity.rhythm')}</QChip> : null}
            {e.quantity === 'brain' ? <QChip q="brain">{t('quantity.brain')}</QChip> : null}
            {e.quantity === 'noise' ? <QChip q="noise">{t('quantity.noise')}</QChip> : null}
            {e.band && e.quantity !== 'brain' ? <QChip q="brain">{t(`band.${e.band}`)}</QChip> : null}
            <span className="chip">{t(`cat.${e.category}`)}</span>
          </div>
          <h2 style={{ fontSize: 22 }}>{e.name}</h2>
        </div>
        <IconButton icon="star" label={favorite ? t('catalog.unfavorite') : t('catalog.favorite')} active={favorite} onClick={() => toggleFavorite(e.id)} />
        {e.category === 'custom' ? (
          <IconButton icon="trash" label={t('common.delete')} onClick={() => removeCustomFrequency(e.id)} />
        ) : null}
      </div>

      <div className="row" style={{ alignItems: 'flex-end', gap: 20, marginTop: 16, flexWrap: 'wrap' }}>
        <div className="value" style={{ '--c': color } as React.CSSProperties}>
          {e.value === null ? t('quantity.noise') : e.range ? `${fmtNum(e.range[0], 1)}–${fmtNum(e.range[1], 1)}` : fmtNum(e.value, 2)}
          {e.value !== null ? <small>{t('unit.hz')}</small> : null}
        </div>
        <div className="grow" />
        <Button icon="play" variant="primary" onClick={listen}>
          {t('catalog.listen')}
        </Button>
        <Button icon="plus" onClick={addToGenerator}>
          {t('catalog.addToGenerator')}
        </Button>
      </div>

      <p className="prose" style={{ marginTop: 18, fontSize: 15 }}>
        {e.summary}
      </p>

      <dl className="facts">
        <dt>{t('catalog.purpose')}</dt>
        <dd>{e.purpose}</dd>
        <dt>{t('catalog.evidence')}</dt>
        <dd>
          <EvidenceBadge level={e.evidence} />
          <div className="small muted" style={{ marginTop: 4 }}>
            {t(`evidence.${e.evidence}.long`)}
          </div>
        </dd>
        <dt>{t('catalog.howPlayed')}</dt>
        <dd>{how}</dd>
      </dl>

      <div className="science-block">
        <h3>
          <Icon name="book" size={17} />
          {t('catalog.science')}
        </h3>
        <p className="prose">{e.science}</p>
        {e.refs.length ? (
          <ul className="refs">
            {e.refs.map((id) => {
              const r = REF_BY_ID[id];
              if (!r) return null;
              const link = refLink(r);
              return (
                <li key={id}>
                  {r.authors} ({r.year}). <i>{r.title}</i>. {r.venue}.
                  {r.doi ? ` DOI: ${r.doi}.` : ''}
                  <span className="tag">{t(`refkind.${r.kind}`)}</span>{' '}
                  {link ? (
                    <button type="button" className="linklike small" onClick={() => void api.openExternal(link)}>
                      {t('catalog.openSource')}
                    </button>
                  ) : null}
                  {r.note ? <div className="note">{r.note}</div> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="small muted" style={{ marginTop: 8 }}>
            {t('catalog.noRefs')}
          </p>
        )}
      </div>

      {e.esoteric ? (
        <div className="eso-block">
          <h3>
            <Icon name="sparkle" size={17} />
            {t('catalog.esoteric')}
          </h3>
          <p className="disclaimer">{t('catalog.esotericDisclaimer')}</p>
          <p className="prose">{e.esoteric}</p>
        </div>
      ) : null}

      <div className="limits">
        <Icon name="warn" size={16} />
        <div>
          <b style={{ color: 'var(--text)' }}>{t('catalog.limitations')}. </b>
          {e.limitations}
        </div>
      </div>
    </article>
  );
}
