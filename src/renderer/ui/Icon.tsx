/** Hand-drawn 20px stroke icon set (no third-party icon font). */
const P: Record<string, string> = {
  play: 'M7 4.5v11l9-5.5z',
  pause: 'M6.5 4.5h2.5v11H6.5zM11 4.5h2.5v11H11z',
  stop: 'M5.5 5.5h9v9h-9z',
  wave: 'M2 10c1.6 0 1.6-5 3.2-5s1.6 10 3.2 10 1.6-10 3.2-10 1.6 10 3.2 10 1.6-5 3.2-5',
  library: 'M4 3.5v13M7.5 3.5v13M11 4l4 12.5M3 16.5h14',
  presets: 'M3.5 4.5h13M3.5 10h13M3.5 15.5h13M7 3v3M13 8.5v3M9 14v3',
  timeline: 'M3 15.5h14M3 15.5V5M6 12.5h4v-4h3v-3h3',
  settings:
    'M10 6.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4',
  plus: 'M10 4v12M4 10h12',
  minus: 'M4 10h12',
  close: 'M5 5l10 10M15 5L5 15',
  check: 'M4 10.5l4 4 8-9',
  trash: 'M4.5 6h11M8 6V4h4v2M6 6l.8 10h6.4L14 6',
  copy: 'M7 7h9v9H7zM4 13V4h9',
  edit: 'M4 16l1-4 8-8 3 3-8 8zM11.5 5.5l3 3',
  download: 'M10 3.5v9M6 9l4 4 4-4M4 16.5h12',
  upload: 'M10 13V4M6 7.5l4-4 4 4M4 16.5h12',
  star: 'M10 3l2.1 4.5 4.9.6-3.6 3.3 1 4.8L10 13.8 5.6 16.2l1-4.8L3 8.1l4.9-.6z',
  search: 'M8.5 3.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12.2 12.2l4.3 4.3',
  info: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM10 9v4.5M10 6.2v.3',
  warn: 'M10 3.2L17.5 16H2.5zM10 8v4M10 14v.2',
  error: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM7.5 7.5l5 5M12.5 7.5l-5 5',
  headphones: 'M3.5 13v-2.5a6.5 6.5 0 0 1 13 0V13M3.5 12.5h2.5v4H3.5zM14 12.5h2.5v4H14z',
  speaker: 'M3.5 8v4h3l4 3.5v-11l-4 3.5zM13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10',
  mute: 'M3.5 8v4h3l4 3.5v-11l-4 3.5zM13.5 8l4 4M17.5 8l-4 4',
  timer: 'M10 5.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM10 8v3.2l2 1.3M8 2.5h4',
  loop: 'M4 9V7.5A2.5 2.5 0 0 1 6.5 5H15l-2-2M16 11v1.5a2.5 2.5 0 0 1-2.5 2.5H5l2 2',
  shield: 'M10 2.8l6 2.4v4.3c0 3.6-2.6 6.4-6 7.7-3.4-1.3-6-4.1-6-7.7V5.2z',
  book: 'M3.5 4.5c2-.8 4.5-.6 6.5.8 2-1.4 4.5-1.6 6.5-.8v11c-2-.8-4.5-.6-6.5.8-2-1.4-4.5-1.6-6.5-.8zM10 5.3v11',
  external: 'M11 3.5h5.5V9M16.5 3.5L9 11M14 12v4.5H3.5V6H8',
  folder: 'M3 5.5h5l1.5 1.5H17v9H3z',
  sparkle: 'M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2 2M12.5 12.5l2 2M5.5 14.5l2-2M12.5 7.5l2-2',
  moon: 'M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z',
  sun: 'M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4',
  monitor: 'M3 4.5h14v9H3zM7.5 16.5h5M10 13.5v3',
  chevronDown: 'M5.5 8l4.5 4.5L14.5 8',
  chevronRight: 'M8 5.5l4.5 4.5L8 14.5',
  chevronLeft: 'M12 5.5L7.5 10l4.5 4.5',
  dots: 'M5 10h.1M10 10h.1M15 10h.1',
  noise: 'M3 10h1l1-4 1.5 8 1.5-6 1.5 5 1.5-7 1.5 6 1.5-3 1 1h2',
  pulse: 'M2.5 13h3V7h3v6h3V7h3v6h3',
  beats: 'M2.5 10c2.5-5 5-5 7.5 0s5 5 7.5 0',
  tone: 'M2.5 10c1.25-4 2.5-4 3.75 0s2.5 4 3.75 0 2.5-4 3.75 0 2.5 4 3.75 0',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, title }: { name: IconName; size?: number; title?: string }) {
  const filled = name === 'play' || name === 'pause' || name === 'stop';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={P[name]} />
    </svg>
  );
}
