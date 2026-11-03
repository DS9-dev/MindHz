import type { Language } from '../../shared/types';
import { en } from './en';
import { ru } from './ru';

export type Key = keyof typeof ru;

const dicts: Record<Language, Record<string, string>> = { ru, en };
let lang: Language = 'ru';

export function setLanguage(l: Language): void {
  lang = l;
}

export function getLanguage(): Language {
  return lang;
}

/** Translate a key; `{name}` placeholders are replaced from params. */
export function t(key: Key | string, params?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? (ru as Record<string, string>)[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

const nf = new Map<string, Intl.NumberFormat>();
export function fmtNum(v: number, maxFrac = 2): string {
  const k = `${lang}-${maxFrac}`;
  let f = nf.get(k);
  if (!f) {
    f = new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: maxFrac });
    nf.set(k, f);
  }
  return f.format(v);
}

export function fmtHz(v: number): string {
  if (v >= 10000) return `${fmtNum(v / 1000, 2)} ${t('unit.khz')}`;
  return `${fmtNum(v, v < 10 ? 2 : 2)} ${t('unit.hz')}`;
}

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 1) return t('unit.sec', { n: Math.round(sec) });
  if (m < 60) return t('unit.min', { n: m });
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? t('unit.hmin', { h, m: r }) : t('unit.h', { n: h });
}

export function fmtBytes(b: number): string {
  if (b < 1024 * 1024) return `${fmtNum(b / 1024, 0)} ${t('unit.kb')}`;
  if (b < 1024 ** 3) return `${fmtNum(b / 1024 ** 2, 1)} ${t('unit.mb')}`;
  return `${fmtNum(b / 1024 ** 3, 2)} ${t('unit.gb')}`;
}
