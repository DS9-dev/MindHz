import { bandOf, describeLayer, validateLayer } from '../../shared/audio/validate';
import { LIMITS } from '../../shared/model';
import type { Layer, LayerKind, NoiseColor } from '../../shared/types';
import { fmtHz, fmtNum, t } from '../i18n';
import { Icon, type IconName } from '../ui/Icon';
import { Button, FreqControl, IconButton, LabeledSlider, QChip, Segmented, Select, Switch } from '../ui/controls';

export const KIND_ICON: Record<LayerKind, IconName> = {
  tone: 'tone',
  binaural: 'headphones',
  monaural: 'beats',
  isochronic: 'pulse',
  am: 'wave',
  noise: 'noise',
};

export const KIND_COLOR: Record<LayerKind, string> = {
  tone: 'var(--tone)',
  binaural: 'var(--brain)',
  monaural: 'var(--beat)',
  isochronic: 'var(--beat)',
  am: 'var(--beat)',
  noise: 'var(--muted)',
};

const KINDS: LayerKind[] = ['binaural', 'monaural', 'isochronic', 'am', 'tone', 'noise'];

export function LayerStrip({
  layer,
  onChange,
  onRemove,
  onDuplicate,
  canRemove = true,
}: {
  layer: Layer;
  onChange: (patch: Partial<Layer>) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  canRemove?: boolean;
}) {
  const k = layer.kind;
  const issues = layer.enabled ? validateLayer(layer) : [];
  const d = describeLayer(layer);
  const usesBeat = k === 'binaural' || k === 'monaural' || k === 'isochronic' || k === 'am';

  return (
    <section
      className={`strip${layer.enabled ? '' : ' off'}`}
      style={{ '--kind': KIND_COLOR[k] } as React.CSSProperties}
      aria-label={t(`kind.${k}`)}
    >
      <div className="ident">
        <div className="kind">
          <span style={{ color: KIND_COLOR[k], display: 'inline-flex' }}>
            <Icon name={KIND_ICON[k]} />
          </span>
          <Select
            label={t('layer.method')}
            value={k}
            options={KINDS.map((x) => ({ value: x, label: t(`kind.${x}`) }))}
            onChange={(kind) => onChange({ kind })}
          />
        </div>
        <div className="desc">{t(`kind.${k}.desc`)}</div>
        <div className="row wrap" style={{ gap: 6 }}>
          {d.audibleHz.length ? (
            <QChip q="tone">{d.audibleHz.map((h) => fmtNum(h, 2)).join(' / ')} {t('unit.hz')}</QChip>
          ) : null}
          {d.rhythmHz !== null ? <QChip q="beat">{fmtHz(d.rhythmHz)}</QChip> : null}
          {d.band && d.band !== 'infra' && d.band !== 'high' ? <QChip q="brain">{t(`band.${d.band}`)}</QChip> : null}
        </div>
      </div>

      <div className="params">
        {k !== 'noise' ? (
          <FreqControl
            label={k === 'tone' ? t('layer.frequency') : t('layer.carrier')}
            value={layer.carrierHz}
            min={LIMITS.carrierMin}
            max={LIMITS.carrierMax}
            color="var(--tone)"
            onChange={(carrierHz) => onChange({ carrierHz })}
          />
        ) : (
          <div className="field">
            <span className="field-label">{t('layer.noiseColor')}</span>
            <Segmented<NoiseColor>
              label={t('layer.noiseColor')}
              value={layer.noiseColor}
              onChange={(noiseColor) => onChange({ noiseColor })}
              options={(['white', 'pink', 'brown'] as const).map((c) => ({ value: c, label: t(`noise.${c}`) }))}
            />
          </div>
        )}
        {usesBeat ? (
          <FreqControl
            label={k === 'isochronic' ? t('layer.pulseRate') : k === 'am' ? t('layer.modRate') : t('layer.beat')}
            value={layer.beatHz}
            min={LIMITS.beatMin}
            max={LIMITS.beatMax}
            color="var(--beat)"
            hint={layer.beatHz >= 0.5 ? <span style={{ color: 'var(--brain)' }}>{t(`band.${bandOf(layer.beatHz)}`)}</span> : null}
            onChange={(beatHz) => onChange({ beatHz })}
          />
        ) : null}
        {k === 'isochronic' || k === 'am' ? (
          <LabeledSlider label={t('layer.depth')} value={layer.depth} onChange={(depth) => onChange({ depth })} color="var(--beat)" />
        ) : null}
        {k === 'isochronic' ? (
          <LabeledSlider
            label={t('layer.duty')}
            value={layer.duty}
            min={0.1}
            max={0.9}
            onChange={(duty) => onChange({ duty })}
            color="var(--beat)"
          />
        ) : null}
      </div>

      <div className="mix">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <label className="switch-row small muted">
            <Switch checked={layer.enabled} onChange={(enabled) => onChange({ enabled })} label={t('layer.enabled')} />
            {layer.enabled ? t('layer.on') : t('layer.off')}
          </label>
          <div className="row" style={{ gap: 0 }}>
            {onDuplicate ? <IconButton icon="copy" label={t('layer.duplicate')} onClick={onDuplicate} size={16} /> : null}
            <IconButton icon="trash" label={t('layer.remove')} onClick={onRemove} disabled={!canRemove} size={16} />
          </div>
        </div>
        <LabeledSlider label={t('layer.volume')} value={layer.volume} onChange={(volume) => onChange({ volume })} />
        {k !== 'binaural' ? (
          <LabeledSlider
            label={t('layer.pan')}
            value={layer.pan}
            min={-1}
            max={1}
            onChange={(pan) => onChange({ pan: Math.abs(pan) < 0.04 ? 0 : pan })}
            format={(v) => (Math.abs(v) < 0.04 ? t('layer.center') : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`)}
          />
        ) : (
          <p className="small muted">{t('layer.binauralStereo')}</p>
        )}
      </div>

      {issues.length ? (
        <div className="issues">
          {issues.map((i) => (
            <div key={i.code} className={`issue ${i.level}`} role={i.level === 'info' ? undefined : 'alert'}>
              <Icon name={i.level === 'error' ? 'error' : i.level === 'warn' ? 'warn' : i.code === 'headphones' ? 'headphones' : 'info'} size={16} />
              <span>{t(i.msg, i.params as Record<string, string | number>)}</span>
              {i.fix ? (
                <Button size="sm" className="btn sm fix" onClick={() => onChange(i.fix!)}>
                  {t(i.fixLabel ?? 'issue.fix')}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
