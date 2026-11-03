/**
 * Built-in listening modes. Names describe the intended use, not a guaranteed
 * result; each mode explains its purpose and the strength of the evidence.
 * Layer ids are shared between stages so parameters morph smoothly.
 */
import type { Layer, LayerKind, PresetDirection, Session, SessionMeta, Stage } from '../types';

const L = (kind: LayerKind, id: string, p: Partial<Layer> = {}): Layer => ({
  id,
  kind,
  enabled: true,
  volume: 0.6,
  pan: 0,
  carrierHz: 200,
  beatHz: 10,
  depth: kind === 'isochronic' ? 1 : 0.8,
  duty: 0.5,
  noiseColor: 'pink',
  ...p,
});

let stageNo = 0;
const S = (name: string, minutes: number, layers: Layer[], p: Partial<Stage> = {}): Stage => ({
  id: `builtin-stage-${++stageNo}`,
  name,
  durationSec: Math.round(minutes * 60),
  transitionSec: 30,
  transition: 'smooth',
  volume: 1,
  layers,
  ...p,
});

function preset(
  id: string,
  name: string,
  direction: PresetDirection,
  meta: Omit<SessionMeta, 'direction'>,
  stages: Stage[],
  extra: Partial<Session> = {},
): Session {
  return {
    id: `builtin-${id}`,
    name,
    builtin: true,
    stages,
    fadeInSec: 8,
    fadeOutSec: 15,
    loop: false,
    meta: { direction, needsHeadphones: stages.some((s) => s.layers.some((l) => l.kind === 'binaural')), ...meta },
    ...extra,
  };
}

const pink = (v = 0.25) => L('noise', 'bed', { noiseColor: 'pink', volume: v });
const brown = (v = 0.3) => L('noise', 'bed', { noiseColor: 'brown', volume: v });

export const BUILTIN_PRESETS: Session[] = [
  // ───────── Mind ─────────
  preset(
    'focus',
    'Концентрация',
    'mind',
    {
      purpose: 'Звуковой фон для сосредоточенной работы в течение одного интервала (25 минут).',
      explanation:
        'Мягкие бинауральные биения 14 Гц (низкая бета / SMR) поверх розового шума, который маскирует отвлекающие звуки. ' +
        'Маскировка шумом — понятный акустический эффект; влияние самих биений на внимание не доказано.',
      evidence: 'insufficient',
      refs: ['garcia2019', 'soderlund2007', 'gruzelier2014'],
    },
    [S('Фокус', 25, [L('binaural', 'b', { carrierHz: 220, beatHz: 14, volume: 0.45 }), pink(0.3)])],
  ),
  preset(
    'reading',
    'Спокойное чтение',
    'mind',
    {
      purpose: 'Неназойливый фон для чтения.',
      explanation:
        'Тихие биения 10 Гц (альфа) и коричневый шум. Спокойный монотонный фон помогает заглушить окружающие звуки.',
      evidence: 'insufficient',
      refs: ['garcia2019', 'riedy2021'],
    },
    [S('Чтение', 30, [L('binaural', 'b', { carrierHz: 180, beatHz: 10, volume: 0.35 }), brown(0.35)])],
  ),
  preset(
    'learning',
    'Обучение',
    'mind',
    {
      purpose: 'Разминка внимания и затем ровный рабочий фон для учебной сессии.',
      explanation:
        'Этап «настройки» с альфа-биениями 10 Гц плавно переходит в 14 Гц. Это экспериментальный режим: данные о влиянии ' +
        'биений на усвоение материала противоречивы.',
      evidence: 'insufficient',
      refs: ['garcia2019', 'ingendoh2023'],
    },
    [
      S('Настройка', 5, [L('binaural', 'b', { carrierHz: 200, beatHz: 10, volume: 0.45 }), pink(0.25)]),
      S('Учёба', 30, [L('binaural', 'b', { carrierHz: 220, beatHz: 14, volume: 0.45 }), pink(0.25)], { transitionSec: 60 }),
    ],
  ),
  preset(
    'memory',
    'Запоминание',
    'mind',
    {
      purpose: 'Экспериментальный режим для заучивания.',
      explanation:
        'Тета-ритм связан с процессами памяти (Klimesch, 1999), но это корреляция в ЭЭГ. Исследования биений ' +
        'на рабочую память дают противоречивые результаты (Beauchene et al., 2016; Ingendoh et al., 2023).',
      evidence: 'preliminary',
      refs: ['klimesch1999', 'beauchene2016', 'ingendoh2023'],
    },
    [S('Тета', 20, [L('binaural', 'b', { carrierHz: 200, beatHz: 6, volume: 0.45 }), pink(0.2)])],
  ),
  preset(
    'active-work',
    'Активная умственная работа',
    'mind',
    {
      purpose: 'Бодрый ритмичный фон для интенсивной работы.',
      explanation:
        'Изохронные импульсы 16 Гц с переходом к 40 Гц амплитудной модуляции. Ритм 40 Гц вызывает отчётливый ' +
        'слуховой устойчивый ответ (ASSR) — это реакция мозга, а не доказанное улучшение мышления.',
      evidence: 'insufficient',
      refs: ['picton2003', 'garcia2019'],
    },
    [
      S('Разгон', 20, [L('isochronic', 'r', { carrierHz: 260, beatHz: 16, volume: 0.35, depth: 0.7 }), pink(0.3)]),
      S('Гамма', 10, [L('am', 'g', { carrierHz: 300, beatHz: 40, volume: 0.3, depth: 0.6 }), pink(0.3)], {
        transitionSec: 45,
      }),
    ],
  ),

  // ───────── Emotion ─────────
  preset(
    'relax',
    'Расслабление',
    'emotion',
    {
      purpose: 'Короткая пауза для расслабления.',
      explanation:
        'Биения медленно снижаются с 10 до 8 Гц на фоне розового шума. Метаанализ показывает небольшое снижение ' +
        'тревожности при прослушивании бинауральных биений, но с высокой неоднородностью исследований.',
      evidence: 'preliminary',
      refs: ['garcia2019', 'chaieb2015'],
    },
    [
      S('Вход', 5, [L('binaural', 'b', { carrierHz: 200, beatHz: 10, volume: 0.5 }), pink(0.3)]),
      S('Покой', 15, [L('binaural', 'b', { carrierHz: 180, beatHz: 8, volume: 0.45 }), pink(0.3)], { transitionSec: 120 }),
    ],
  ),
  preset(
    'tension',
    'Снижение субъективного напряжения',
    'emotion',
    {
      purpose: 'Звуковой фон для снятия ощущения напряжения.',
      explanation:
        'Схожий протокол (бинауральные биения) снижал тревогу перед операцией в рандомизированном исследовании ' +
        '(Padmanabhan et al., 2005). Это не лечение тревожных расстройств: при стойкой тревоге обратитесь к специалисту.',
      evidence: 'preliminary',
      refs: ['padmanabhan2005', 'garcia2019'],
    },
    [
      S('Снижение', 15, [L('binaural', 'b', { carrierHz: 200, beatHz: 10, volume: 0.5 }), brown(0.3)]),
      S('Тишина', 5, [L('binaural', 'b', { carrierHz: 180, beatHz: 8, volume: 0.3 }), brown(0.2)], { transitionSec: 90 }),
    ],
  ),
  preset(
    'meditation',
    'Медитация',
    'emotion',
    {
      purpose: 'Сопровождение медитации с постепенным замедлением ритма.',
      explanation:
        'Биения переходят от альфа (10 Гц) к тете (6 Гц). Тета-активность наблюдается при медитации, но ' +
        'звук не «вводит» в медитативное состояние автоматически.',
      evidence: 'preliminary',
      refs: ['jirakittayakorn2017', 'ingendoh2023'],
    },
    [
      S('Альфа', 5, [L('binaural', 'b', { carrierHz: 200, beatHz: 10, volume: 0.5 }), brown(0.25)]),
      S('Тета', 20, [L('binaural', 'b', { carrierHz: 180, beatHz: 6, volume: 0.45 }), brown(0.25)], { transitionSec: 180 }),
    ],
  ),
  preset(
    'calm',
    'Спокойствие',
    'emotion',
    {
      purpose: 'Мягкий фон без наушников.',
      explanation:
        'Медленная амплитудная модуляция тёплого тона и коричневый шум. Работает через колонки. Эффекты — ' +
        'субъективные, связанные со спокойным звучанием.',
      evidence: 'insufficient',
      refs: ['riedy2021'],
    },
    [S('Спокойствие', 20, [L('am', 'a', { carrierHz: 174, beatHz: 0.2, depth: 0.5, volume: 0.35 }), brown(0.4)])],
    { loop: true },
  ),
  preset(
    'immersion',
    'Эмоциональное погружение',
    'emotion',
    {
      purpose: 'Глубокий медленный фон для рефлексии и погружения в себя (работает через колонки).',
      explanation:
        'Монауральные биения 6 → 4,5 Гц — слышны и без наушников. Исследований именно этого режима нет.',
      evidence: 'insufficient',
      refs: ['chaieb2015'],
    },
    [
      S('Погружение', 10, [L('monaural', 'm', { carrierHz: 160, beatHz: 6, volume: 0.45 }), brown(0.3)]),
      S('Глубина', 20, [L('monaural', 'm', { carrierHz: 140, beatHz: 4.5, volume: 0.4 }), brown(0.3)], { transitionSec: 120 }),
    ],
  ),

  // ───────── Rest ─────────
  preset(
    'sleep',
    'Подготовка ко сну',
    'rest',
    {
      purpose: 'Постепенно затихающий фон перед сном.',
      explanation:
        'Ритм биений снижается от 10 до 2 Гц, несущая опускается, громкость плавно уменьшается, в конце звук ' +
        'затухает. Доказательств, что такие программы улучшают сон, недостаточно (Riedy et al., 2021); но ' +
        'тихий монотонный фон многим помогает расслабиться.',
      evidence: 'insufficient',
      refs: ['riedy2021', 'ingendoh2023'],
    },
    [
      S('Расслабление', 10, [L('binaural', 'b', { carrierHz: 200, beatHz: 10, volume: 0.45 }), brown(0.35)]),
      S('Тета', 15, [L('binaural', 'b', { carrierHz: 170, beatHz: 6, volume: 0.35 }), brown(0.32)], { transitionSec: 180 }),
      S('Дельта', 20, [L('binaural', 'b', { carrierHz: 140, beatHz: 2.5, volume: 0.25 }), brown(0.28)], {
        transitionSec: 300,
        volume: 0.8,
      }),
    ],
    { fadeOutSec: 180 },
  ),
  preset(
    'background',
    'Спокойный звуковой фон',
    'rest',
    {
      purpose: 'Нейтральный шумовой фон без ритма — для отдыха или маскировки звуков.',
      explanation: 'Смесь розового и коричневого шума. Маскировка звуков — установленный акустический эффект.',
      evidence: 'supported',
      refs: ['riedy2021'],
    },
    [
      S('Фон', 60, [
        L('noise', 'p', { noiseColor: 'pink', volume: 0.3 }),
        L('noise', 'br', { noiseColor: 'brown', volume: 0.4 }),
      ]),
    ],
    { loop: true },
  ),
  preset(
    'nap',
    'Восстановительный отдых',
    'rest',
    {
      purpose: 'Короткий отдых (20 минут) с мягким «пробуждением» в конце.',
      explanation:
        'Сначала медленные биения и затихание, затем ритм ускоряется к 12 Гц и громкость немного растёт. ' +
        'Режим экспериментальный.',
      evidence: 'insufficient',
      refs: ['ingendoh2023'],
    },
    [
      S('Отдых', 15, [L('binaural', 'b', { carrierHz: 180, beatHz: 5, volume: 0.35 }), pink(0.3)]),
      S('Пробуждение', 5, [L('binaural', 'b', { carrierHz: 220, beatHz: 12, volume: 0.45 }), pink(0.3)], {
        transitionSec: 120,
      }),
    ],
  ),

  // ───────── Esoteric ─────────
  preset(
    'solfeggio-path',
    'Путь сольфеджио',
    'esoteric',
    {
      purpose: 'Последовательное звучание семи «частот сольфеджио» (по 3 минуты) для звуковой медитации.',
      explanation:
        'Эзотерическая практика. Значения частот и их трактовки не имеют научного подтверждения; режим ' +
        'предназначен для тех, кто практикует такие медитации.',
      evidence: 'esoteric',
      refs: ['horowitz1999'],
    },
    [396, 417, 528, 639, 741, 852, 963].map((hz, i) =>
      // distinct layer ids → each tone cross-fades into the next instead of gliding in pitch
      S(`${hz} Гц`, 3, [L('tone', `t${hz}`, { carrierHz: hz, volume: 0.35 }), pink(0.15)], { transitionSec: i ? 10 : 0 }),
    ),
  ),
  preset(
    'harmony',
    'Гармония (528 + 639)',
    'esoteric',
    {
      purpose: 'Медитация с частотами, которые в эзотерической традиции связывают с любовью и гармонией.',
      explanation: 'Два тона, расположенные в разных каналах, на тихом фоне. Свойства «любви и гармонии» — эзотерическая трактовка.',
      evidence: 'esoteric',
      refs: ['horowitz1999', 'akimoto2018'],
    },
    [
      S('Гармония', 20, [
        L('tone', 't1', { carrierHz: 528, volume: 0.3, pan: -0.35 }),
        L('tone', 't2', { carrierHz: 639, volume: 0.25, pan: 0.35 }),
        brown(0.2),
      ]),
    ],
  ),
  preset(
    'om',
    'Звуковая медитация «Ом»',
    'esoteric',
    {
      purpose: 'Тон 136,1 Гц («год Земли») с медленной пульсацией для медитации.',
      explanation:
        'Эзотерическая концепция «космической октавы»; амплитудная модуляция 0,1 Гц напоминает медленное дыхание. ' +
        'Научного подтверждения особых свойств тона нет.',
      evidence: 'esoteric',
      refs: [],
    },
    [S('Ом', 20, [L('am', 'o', { carrierHz: 136.1, beatHz: 0.1, depth: 0.6, volume: 0.45 }), brown(0.2)])],
    { loop: true },
  ),
  preset(
    'schumann',
    'Резонанс Шумана 7,83 Гц',
    'esoteric',
    {
      purpose: 'Медитативная практика «заземления».',
      explanation:
        'Резонанс Шумана — реальное электромагнитное явление, но звуковые биения 7,83 Гц с ним физически не связаны. ' +
        'Режим основан на эзотерической трактовке.',
      evidence: 'esoteric',
      refs: ['schumann1952'],
    },
    [S('Шуман', 20, [L('binaural', 'b', { carrierHz: 136.1, beatHz: 7.83, volume: 0.5 }), brown(0.25)])],
  ),
];

export const PRESET_DIRECTIONS: PresetDirection[] = ['mind', 'emotion', 'rest', 'esoteric'];
