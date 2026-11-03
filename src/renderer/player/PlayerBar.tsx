import { useState } from 'react';
import { audio, playerStatus } from '../audio/AudioService';
import { fmtDuration, fmtTime, t } from '../i18n';
import { app, navigate, setContinuous, setMasterVolume, stopPlayback, togglePlay } from '../state/app';
import { Icon } from '../ui/Icon';
import { IconButton, Popover, Slider } from '../ui/controls';
import { Meters } from './Visualizer';

const SLEEP_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90, 120];

export function PlayerBar() {
  const state = playerStatus.use((s) => s.state);
  const position = playerStatus.use((s) => Math.floor(s.position));
  const duration = playerStatus.use((s) => s.duration);
  const stageIndex = playerStatus.use((s) => s.stageIndex);
  const loop = playerStatus.use((s) => s.loop);
  const sleepLeft = playerStatus.use((s) => (s.sleepLeft === null ? null : Math.ceil(s.sleepLeft)));
  const nowPlaying = app.use((s) => s.nowPlaying);
  const playing = app.use((s) => s.playing);
  const volume = app.use((s) => s.settings.masterVolume);
  const limit = app.use((s) => s.settings.volumeLimit);
  const [sleepOpen, setSleepOpen] = useState(false);

  const isPlaying = state === 'playing';
  const active = state !== 'stopped' && state !== 'ended';
  const stage = playing && stageIndex >= 0 ? playing.stages[stageIndex] : null;
  const multiStage = (playing?.stages.length ?? 0) > 1;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const hot = volume > 0.7;

  let sub = t('player.idle');
  if (nowPlaying) {
    if (state === 'paused') sub = t('player.paused');
    else if (state === 'ended') sub = t('player.ended');
    else if (state === 'stopped') sub = t('player.stopped');
    else if (stage && multiStage) sub = t('player.stage', { n: stageIndex + 1, total: playing!.stages.length, name: stage.name });
    else sub = nowPlaying.kind === 'generator' ? t('player.live') : t('player.playing');
  }

  // stage boundaries on the progress bar
  const ticks: number[] = [];
  if (playing && multiStage && duration > 0) {
    let acc = 0;
    for (let i = 0; i < playing.stages.length - 1; i++) {
      acc += playing.stages[i].durationSec;
      ticks.push((acc / duration) * 100);
    }
  }

  return (
    <footer className="player" aria-label={t('player.label')}>
      <div className="controls">
        <button
          type="button"
          className="play-btn"
          onClick={() => void togglePlay()}
          aria-label={isPlaying ? t('player.pause') : t('player.play')}
          title={`${isPlaying ? t('player.pause') : t('player.play')} (${t('player.space')})`}
        >
          <Icon name={isPlaying ? 'pause' : 'play'} size={20} />
        </button>
        <IconButton icon="stop" label={t('player.stop')} onClick={stopPlayback} disabled={!active} />
      </div>

      <div className="now">
        <div className="title">
          {nowPlaying ? (
            <button
              type="button"
              className="linklike"
              style={{ color: 'inherit', textDecoration: 'none', font: 'inherit', fontWeight: 600 }}
              onClick={() => {
                if (nowPlaying.kind === 'generator') navigate('generator');
                else if (!playing?.builtin) {
                  app.set({ builderId: nowPlaying.id });
                  navigate('builder');
                } else navigate('presets');
              }}
            >
              {nowPlaying.name}
            </button>
          ) : (
            t('app.name')
          )}
        </div>
        <div className="sub">{sub}</div>
      </div>

      <div className="progress">
        <span style={{ minWidth: 40, textAlign: 'right' }}>{fmtTime(active ? position : 0)}</span>
        <div className={`bar${active && loop ? ' indef' : ''}`}>
          {!loop ? <i style={{ width: `${active ? pct : 0}%` }} /> : active ? <i /> : null}
          {!loop ? ticks.map((x) => <span key={x} className="tick" style={{ left: `${x}%` }} />) : null}
        </div>
        <span style={{ minWidth: 40 }}>{loop ? '∞' : fmtTime(duration)}</span>
      </div>

      <div className="row" style={{ gap: 2 }}>
        <IconButton
          icon="loop"
          label={loop ? t('player.continuousOn') : t('player.continuousOff')}
          active={loop}
          disabled={!nowPlaying}
          onClick={() => setContinuous(!loop)}
        />
        <div className="popover-anchor">
          <IconButton
            icon="timer"
            label={t('player.sleep')}
            active={sleepLeft !== null}
            onClick={() => setSleepOpen((v) => !v)}
          />
          {sleepLeft !== null ? (
            <span className="small muted" style={{ position: 'absolute', left: 30, top: 8, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
              {fmtTime(sleepLeft)}
            </span>
          ) : null}
          <Popover open={sleepOpen} onClose={() => setSleepOpen(false)}>
            <div className="head">{t('player.sleepTitle')}</div>
            {SLEEP_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                className="menu-item"
                role="menuitemradio"
                aria-checked={m === 0 ? sleepLeft === null : false}
                onClick={() => {
                  audio.setSleep(m ? m * 60 : null);
                  setSleepOpen(false);
                }}
              >
                {m === 0 ? t('player.sleepOff') : fmtDuration(m * 60)}
              </button>
            ))}
            <div className="head" style={{ paddingTop: 2 }}>
              {t('player.sleepNote')}
            </div>
          </Popover>
        </div>
      </div>

      <div className="row" style={{ gap: 14 }}>
        <div className={`volume${hot ? ' hot' : ''}`} title={hot ? t('player.volumeHot') : t('player.volume')}>
          <Icon name={volume === 0 ? 'mute' : 'speaker'} size={18} />
          <Slider
            label={t('player.volume')}
            value={volume}
            min={0}
            max={limit}
            step={0.01}
            color={hot ? 'var(--warn)' : undefined}
            onChange={setMasterVolume}
          />
          <span className="val">{Math.round(volume * 100)}</span>
        </div>
        <Meters />
      </div>
    </footer>
  );
}
