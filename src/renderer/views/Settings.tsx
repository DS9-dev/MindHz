import { useEffect, useState } from 'react';
import type { Settings as S } from '../../shared/types';
import { api } from '../api';
import { audio, playerStatus } from '../audio/AudioService';
import { fmtNum, t } from '../i18n';
import {
  app,
  exportPresetsFile,
  importPresetsFile,
  openModal,
  toast,
  updateSettings,
} from '../state/app';
import { Icon } from '../ui/Icon';
import { Button, Segmented, Select, Slider, Switch } from '../ui/controls';

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div>
        <div className="t">{title}</div>
        {desc ? <div className="d">{desc}</div> : null}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}

export function Settings() {
  const s = app.use((x) => x.settings);
  const info = app.use((x) => x.info);
  const sessions = app.use((x) => x.library.sessions);
  const sr = playerStatus.use((x) => x.sampleRate);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const set = (p: Partial<S>) => updateSettings(p);

  useEffect(() => {
    void audio.listOutputs().then(setDevices);
    const h = () => void audio.listOutputs().then(setDevices);
    navigator.mediaDevices?.addEventListener?.('devicechange', h);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', h);
  }, []);

  return (
    <div className="view-inner">
      <div className="page-head">
        <div className="grow">
          <h1>{t('settings.title')}</h1>
        </div>
      </div>
      <div className="settings">
        <section className="panel panel-pad">
          <h2>{t('settings.appearance')}</h2>
          <Row title={t('settings.theme')}>
            <Segmented<S['theme']>
              label={t('settings.theme')}
              value={s.theme}
              onChange={(theme) => set({ theme })}
              options={[
                { value: 'system', label: <><Icon name="monitor" size={15} />{t('settings.themeSystem')}</> },
                { value: 'light', label: <><Icon name="sun" size={15} />{t('settings.themeLight')}</> },
                { value: 'dark', label: <><Icon name="moon" size={15} />{t('settings.themeDark')}</> },
              ]}
            />
          </Row>
          {info?.micaSupported ? (
            <Row title={t('settings.mica')} desc={t('settings.micaDesc')}>
              <Switch checked={s.mica} onChange={(mica) => set({ mica })} label={t('settings.mica')} />
            </Row>
          ) : null}
          <Row title={t('settings.reduceMotion')} desc={t('settings.reduceMotionDesc')}>
            <Switch checked={s.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} label={t('settings.reduceMotion')} />
          </Row>
          <Row title={t('settings.language')} desc={t('settings.languageDesc')}>
            <Segmented<S['language']>
              label={t('settings.language')}
              value={s.language}
              onChange={(language) => set({ language })}
              options={[
                { value: 'ru', label: 'Русский' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Row>
        </section>

        <section className="panel panel-pad">
          <h2>{t('settings.sound')}</h2>
          <Row title={t('settings.device')} desc={t('settings.deviceDesc')}>
            <Select
              label={t('settings.device')}
              value={s.outputDeviceId}
              onChange={(outputDeviceId) => set({ outputDeviceId })}
              options={[{ value: '', label: t('settings.deviceDefault') }, ...devices.map((d) => ({ value: d.id, label: d.label }))]}
            />
          </Row>
          <Row title={t('settings.sampleRate')} desc={sr ? t('settings.sampleRateNow', { sr: fmtNum(sr, 0) }) : t('settings.sampleRateDesc')}>
            <Select<number>
              label={t('settings.sampleRate')}
              value={s.sampleRate}
              onChange={(sampleRate) => set({ sampleRate })}
              options={[
                { value: 0, label: t('settings.auto') },
                { value: 44100, label: '44 100 Hz' },
                { value: 48000, label: '48 000 Hz' },
                { value: 96000, label: '96 000 Hz' },
              ]}
            />
          </Row>
          <Row title={t('settings.latency')} desc={t('settings.latencyDesc')}>
            <Segmented<S['latency']>
              label={t('settings.latency')}
              value={s.latency}
              onChange={(latency) => set({ latency })}
              options={[
                { value: 'playback', label: t('settings.latencyPlayback') },
                { value: 'balanced', label: t('settings.latencyBalanced') },
                { value: 'interactive', label: t('settings.latencyInteractive') },
              ]}
            />
          </Row>
        </section>

        <section className="panel panel-pad">
          <h2>{t('settings.safety')}</h2>
          <Row title={t('settings.volumeLimit')} desc={t('settings.volumeLimitDesc')}>
            <div className="row" style={{ width: 220 }}>
              <Slider
                label={t('settings.volumeLimit')}
                value={s.volumeLimit}
                min={0.1}
                max={1}
                step={0.05}
                onChange={(volumeLimit) => set({ volumeLimit })}
                color={s.volumeLimit > 0.8 ? 'var(--warn)' : undefined}
              />
              <span className="small muted" style={{ width: 40, textAlign: 'right' }}>
                {Math.round(s.volumeLimit * 100)}%
              </span>
            </div>
          </Row>
          <Row title={t('settings.safetyInfo')} desc={t('settings.safetyInfoDesc')}>
            <Button icon="shield" onClick={() => openModal({ kind: 'safety' })}>
              {t('settings.showSafety')}
            </Button>
          </Row>
        </section>

        <section className="panel panel-pad">
          <h2>{t('settings.data')}</h2>
          <Row title={t('settings.exportPresets')} desc={t('settings.exportPresetsDesc', { n: sessions.length })}>
            <Button icon="download" disabled={!sessions.length} onClick={() => void exportPresetsFile(sessions)}>
              {t('common.export')}
            </Button>
          </Row>
          <Row title={t('settings.importPresets')} desc={t('settings.importPresetsDesc')}>
            <Button icon="upload" onClick={() => void importPresetsFile()}>
              {t('presets.import')}
            </Button>
          </Row>
          <Row title={t('settings.dataFolder')} desc={info?.dataPath}>
            <Button icon="folder" onClick={() => void api.openDataFolder()}>
              {t('settings.open')}
            </Button>
          </Row>
          <Row title={t('settings.resetSettings')} desc={t('settings.resetSettingsDesc')}>
            <Button
              variant="danger"
              onClick={() =>
                openModal({
                  kind: 'confirm',
                  title: t('settings.resetSettings'),
                  text: t('settings.resetSettingsConfirm'),
                  confirm: t('settings.reset'),
                  danger: true,
                  run: () => {
                    const keep = app.get().settings;
                    updateSettings({
                      theme: 'system',
                      mica: true,
                      reduceMotion: false,
                      outputDeviceId: '',
                      sampleRate: 0,
                      latency: 'playback',
                      volumeLimit: 0.8,
                      masterVolume: Math.min(keep.masterVolume, 0.3),
                      language: 'ru',
                    });
                    toast('success', t('settings.resetDone'));
                  },
                })
              }
            >
              {t('settings.reset')}
            </Button>
          </Row>
          <Row title={t('settings.resetAll')} desc={t('settings.resetAllDesc')}>
            <Button
              variant="danger"
              onClick={() =>
                openModal({
                  kind: 'confirm',
                  title: t('settings.resetAll'),
                  text: t('settings.resetAllConfirm'),
                  confirm: t('settings.resetAllBtn'),
                  danger: true,
                  run: async () => {
                    await api.resetAll();
                    window.location.reload();
                  },
                })
              }
            >
              {t('settings.resetAllBtn')}
            </Button>
          </Row>
        </section>

        <section className="panel panel-pad">
          <h2>{t('settings.about')}</h2>
          <p className="prose" style={{ marginTop: 10 }}>
            {t('settings.aboutText')}
          </p>
          <dl className="facts">
            <dt>{t('settings.version')}</dt>
            <dd>
              MindHz {info?.version} {info?.portable ? `(${t('settings.portable')})` : ''}
            </dd>
            <dt>{t('settings.runtime')}</dt>
            <dd>
              Electron {info?.electron} · Chromium {info?.chrome} · {info?.platform}/{info?.arch}
            </dd>
            <dt>{t('settings.license')}</dt>
            <dd>MIT · © 2026 DS9-dev</dd>
            <dt>{t('settings.updates')}</dt>
            <dd>{t('settings.updatesText')}</dd>
          </dl>
          <div className="row" style={{ marginTop: 16 }}>
            <Button icon="external" onClick={() => void api.openExternal('https://github.com/DS9-dev/MindHz')}>
              GitHub
            </Button>
            <Button icon="download" variant="ghost" onClick={() => void api.openExternal('https://github.com/DS9-dev/MindHz/releases')}>
              {t('settings.releases')}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
