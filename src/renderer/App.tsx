import { useEffect } from 'react';
import { t } from './i18n';
import { Dialogs } from './dialogs/Dialogs';
import { PlayerBar } from './player/PlayerBar';
import { app, dismissToast, navigate, stopPlayback, togglePlay, type View } from './state/app';
import { Icon, type IconName } from './ui/Icon';
import { Builder } from './views/Builder';
import { Catalog } from './views/Catalog';
import { Generator } from './views/Generator';
import { Presets } from './views/Presets';
import { Settings } from './views/Settings';
import logo from '../../build/icon.svg';

const NAV: { view: View; icon: IconName; key: string }[] = [
  { view: 'generator', icon: 'wave', key: 'nav.generator' },
  { view: 'catalog', icon: 'library', key: 'nav.catalog' },
  { view: 'presets', icon: 'presets', key: 'nav.presets' },
  { view: 'builder', icon: 'timeline', key: 'nav.builder' },
];

function Toasts() {
  const toasts = app.use((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind}`} role={x.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={x.kind === 'success' ? 'check' : x.kind === 'error' ? 'error' : x.kind === 'warn' ? 'warn' : 'info'} />
          <div className="msg">{x.text}</div>
          {x.action ? (
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => {
                x.action!.run();
                dismissToast(x.id);
              }}
            >
              {x.action.label}
            </button>
          ) : null}
          <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label={t('common.close')} onClick={() => dismissToast(x.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const view = app.use((s) => s.view);
  const info = app.use((s) => s.info);
  const lang = app.use((s) => s.settings.language);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
      if (app.get().modal) return;
      if (e.code === 'Space' && !typing && el.getAttribute('role') !== 'switch' && el.tagName !== 'BUTTON') {
        e.preventDefault();
        void togglePlay();
      } else if (e.key === 'Escape' && !typing) stopPlayback();
      else if (e.ctrlKey && /^Digit[1-5]$/.test(e.code)) {
        const v = (['generator', 'catalog', 'presets', 'builder', 'settings'] as View[])[Number(e.code.slice(5)) - 1];
        navigate(v);
      }
    };
    window.addEventListener('keydown', onKey);
    // hardware media keys / Windows media overlay
    const ms = navigator.mediaSession;
    if (ms) {
      ms.setActionHandler('play', () => void togglePlay());
      ms.setActionHandler('pause', () => void togglePlay());
      ms.setActionHandler('stop', () => stopPlayback());
    }
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const np = app.use((s) => s.nowPlaying);
  useEffect(() => {
    if (navigator.mediaSession && np) navigator.mediaSession.metadata = new MediaMetadata({ title: np.name, artist: 'MindHz' });
  }, [np]);

  const isMac = info?.platform === 'darwin';

  return (
    <div className="shell" key={lang}>
      <header className={`titlebar${isMac ? ' mac' : ''}`}>
        <span className="logo" dangerouslySetInnerHTML={{ __html: logo }} />
        <span className="name">MindHz</span>
        <span className="ver">{info?.version}</span>
        <span className="grow" />
      </header>
      <nav className="rail" aria-label={t('nav.label')}>
        {NAV.map((n, i) => (
          <button
            key={n.view}
            type="button"
            aria-current={view === n.view ? 'page' : undefined}
            onClick={() => navigate(n.view)}
            title={`${t(n.key)} (Ctrl+${i + 1})`}
          >
            <Icon name={n.icon} />
            <span className="label">{t(n.key)}</span>
          </button>
        ))}
        <span className="spacer" />
        <p className="safety-note">{t('nav.safetyNote')}</p>
        <button
          type="button"
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => navigate('settings')}
          title={`${t('nav.settings')} (Ctrl+5)`}
        >
          <Icon name="settings" />
          <span className="label">{t('nav.settings')}</span>
        </button>
      </nav>
      <main className="view" key={view}>
        {view === 'generator' ? <Generator /> : null}
        {view === 'catalog' ? <Catalog /> : null}
        {view === 'presets' ? <Presets /> : null}
        {view === 'builder' ? <Builder /> : null}
        {view === 'settings' ? <Settings /> : null}
      </main>
      <PlayerBar />
      <Dialogs />
      <Toasts />
    </div>
  );
}
