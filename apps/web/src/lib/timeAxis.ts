// Time axis for timeline-v1 (pure, no DOM). Events are placed by the dates they state, at the precision they state:
// a year covers the whole year, a month the whole month, a day one day. One scale (pixels per day) is used across the
// whole axis, so gaps are drawn to scale; only an empty gap that is longer than everything else together is cut out,
// and a cut is drawn as a marked axis break that says how long it is. Dates come from the stored events only.

import type { DateLike } from './timeline.ts';

export type Precision = 'year' | 'month' | 'day';

const validMonth = (m: number): boolean => Number.isInteger(m) && m >= 1 && m <= 12;
const validDay = (d: number): boolean => Number.isInteger(d) && d >= 1 && d <= 31;

export function precisionOf(d: DateLike): Precision {
  if (!validMonth(d.month)) return 'year';
  return validDay(d.day) ? 'day' : 'month';
}

/** Historical year (…, -2 = 2 BCE, -1 = 1 BCE, 1 = 1 CE, …; there is no year 0) to astronomical year (1 BCE = 0). */
const astro = (year: number): number => (year < 0 ? year + 1 : year);
/** Astronomical year back to historical. */
const historical = (a: number): number => (a <= 0 ? a - 1 : a);

/** Days from 1970-01-01 in the proleptic Gregorian calendar (H. Hinnant's days_from_civil), historical year numbering. */
export function dayNumber(year: number, month: number, day: number): number {
  let y = astro(year);
  y -= month <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The (historical year, month) after the given one. */
function nextMonth(year: number, month: number): [number, number] {
  if (month < 12) return [year, month + 1];
  return [historical(astro(year) + 1), 1];
}

const daysInMonth = (year: number, month: number): number => {
  const [ny, nm] = nextMonth(year, month);
  return dayNumber(ny, nm, 1) - dayNumber(year, month, 1);
};

export interface DaySpan { start: number; end: number; precision: Precision }

/** The days a stated date can mean, as [start, end) in day numbers. */
export function eventSpan(d: DateLike): DaySpan {
  const precision = precisionOf(d);
  if (precision === 'year') return { start: dayNumber(d.year, 1, 1), end: dayNumber(historical(astro(d.year) + 1), 1, 1), precision };
  if (precision === 'month') {
    const [ny, nm] = nextMonth(d.year, d.month);
    return { start: dayNumber(d.year, d.month, 1), end: dayNumber(ny, nm, 1), precision };
  }
  const day = Math.min(d.day, daysInMonth(d.year, d.month));
  const start = dayNumber(d.year, d.month, day);
  return { start, end: start + 1, precision };
}

/** '1776', '500 BCE'; with `era`, CE years read '14 CE' (used when an axis crosses from BCE to CE). */
export function formatYear(year: number, era = false): string {
  if (year < 0) return `${-year} BCE`;
  return era ? `${year} CE` : String(year);
}

// ---- the axis --------------------------------------------------------------------------------------------------------

export interface AxisSegment { from: number; to: number; x0: number; x1: number }
export interface AxisBreak { x0: number; x1: number; gapDays: number; label: string }
export interface AxisTick { x: number; label: string }
export interface AxisMark { id: string; precision: Precision; start: number; end: number; x0: number; x1: number; x: number }
export type TickUnit = 'day' | 'month' | 'year';

export interface TimeAxis {
  width: number;
  segments: AxisSegment[];
  breaks: AxisBreak[];
  ticks: AxisTick[];
  marks: AxisMark[];
  unit: TickUnit;
  /** Days per tick step, roughly (1 for daily ticks, ~30 for monthly, ~365 per year step). */
  tickDays: number;
}

export interface AxisOptions {
  width: number;
  /** Space kept clear at each end. */
  padX?: number;
  /** Width of an axis break. */
  breakPx?: number;
  /** Smallest distance between two tick marks. */
  minTickPx?: number;
  /** At most this many breaks. */
  maxBreaks?: number;
}

const YEAR_DAYS = 365.2425;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Interval = { start: number; end: number };

/** Occupied stretches of time: every event's span, merged where they touch or overlap. */
function occupied(spans: readonly Interval[]): Interval[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Indices of the gaps (between occupied stretch i and i+1) to cut: only a gap clearly longer (x1.25) than everything else shown together. */
function gapsToCut(stretches: readonly Interval[], eventCount: number, maxBreaks: number): Set<number> {
  const cut = new Set<number>();
  if (eventCount < 3 || stretches.length < 2) return cut;
  const first = stretches[0] as Interval;
  const last = stretches[stretches.length - 1] as Interval;
  let shown = last.end - first.start;
  while (cut.size < maxBreaks) {
    let best = -1;
    let bestLen = 0;
    for (let i = 0; i + 1 < stretches.length; i++) {
      if (cut.has(i)) continue;
      const len = (stretches[i + 1] as Interval).start - (stretches[i] as Interval).end;
      if (len > bestLen) { bestLen = len; best = i; }
    }
    if (best < 0 || !(bestLen > 1.25 * (shown - bestLen))) break;
    cut.add(best);
    shown -= bestLen;
  }
  return cut;
}

interface TickCandidate { unit: TickUnit; step: number; days: number }
const TICK_STEPS: TickCandidate[] = [
  ...[1, 2, 5, 10].map((step) => ({ unit: 'day' as const, step, days: step })),
  ...[1, 2, 3, 6].map((step) => ({ unit: 'month' as const, step, days: step * 30.44 })),
  ...[1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].map((step) => ({ unit: 'year' as const, step, days: step * YEAR_DAYS })),
];

/** Rough rendered width of a tick label at the axis type size (12-13 px). */
const labelPx = (label: string): number => label.length * 7 + 4;

/** Candidate tick positions (day number + label) inside [from, to]. */
function tickDays(c: TickCandidate, from: number, to: number, era: boolean): { day: number; label: string }[] {
  const out: { day: number; label: string }[] = [];
  // walk months from the one containing `from`
  const startYear = (() => {
    // historical year containing day `from`: search near an estimate
    let a = Math.floor(from / YEAR_DAYS) + 1970;
    while (dayNumber(historical(a), 1, 1) > from) a--;
    while (dayNumber(historical(a + 1), 1, 1) <= from) a++;
    return a; // astronomical
  })();
  if (c.unit === 'year') {
    const lastA = startYear + Math.ceil((to - from) / YEAR_DAYS) + 1;
    const h0 = historical(startYear);
    const h1 = historical(lastA);
    for (let k = Math.floor(h0 / c.step); k * c.step <= h1; k++) {
      const y = k * c.step;
      if (y === 0) continue;
      const day = dayNumber(y, 1, 1);
      if (day >= from && day <= to) out.push({ day, label: formatYear(y, era) });
    }
    return out;
  }
  let y = historical(startYear);
  let m = 1;
  for (let guard = 0; guard < 2400; guard++) {
    const monthStart = dayNumber(y, m, 1);
    if (monthStart > to) break;
    if (c.unit === 'month') {
      if ((m - 1) % c.step === 0 && monthStart >= from) out.push({ day: monthStart, label: MONTHS_SHORT[m - 1] as string });
    } else {
      const dim = daysInMonth(y, m);
      for (let d = 1; d <= (c.step === 1 ? dim : 28); d += c.step) {
        const day = monthStart + d - 1;
        if (day >= from && day <= to) out.push({ day, label: `${MONTHS_SHORT[m - 1] as string} ${d}` });
      }
    }
    [y, m] = nextMonth(y, m);
  }
  return out;
}

/** Year of a day number (historical). */
function yearOf(day: number): number {
  let a = Math.floor(day / YEAR_DAYS) + 1970;
  while (dayNumber(historical(a), 1, 1) > day) a--;
  while (dayNumber(historical(a + 1), 1, 1) <= day) a++;
  return historical(a);
}

/**
 * Lay the events out on one horizontal axis `width` pixels wide. Every event gets a mark: [x0, x1] covers the time its
 * date can mean and x is its centre (a day mark is the middle of that day).
 */
export function buildTimeAxis(events: readonly (DateLike & { id: string })[], opts: AxisOptions): TimeAxis {
  const width = opts.width;
  const padX = opts.padX ?? 24;
  const breakPx = opts.breakPx ?? 40;
  const minTickPx = opts.minTickPx ?? 84;
  const spans = events.map((e) => ({ id: e.id, ...eventSpan(e) }));
  const stretches = occupied(spans.length > 0 ? spans : [{ start: 0, end: 1 }]);
  const cut = gapsToCut(stretches, events.length, opts.maxBreaks ?? 2);

  // segments: runs of stretches between cut gaps
  const cores: Interval[] = [];
  let cur: Interval = { ...(stretches[0] as Interval) };
  for (let i = 1; i < stretches.length; i++) {
    const s = stretches[i] as Interval;
    if (cut.has(i - 1)) { cores.push(cur); cur = { ...s }; } else cur.end = Math.max(cur.end, s.end);
  }
  cores.push(cur);
  const coreTotal = cores.reduce((acc, c) => acc + (c.end - c.start), 0);
  // padding on each side of every segment; a very short axis is widened to at least ten days so it has a scale
  const pad = Math.max(coreTotal * 0.04, (10 - coreTotal) / (2 * cores.length), 0.5);
  const domainTotal = cores.reduce((acc, c) => acc + (c.end - c.start) + 2 * pad, 0);
  const avail = Math.max(1, width - 2 * padX - (cores.length - 1) * breakPx);
  const scale = avail / domainTotal;

  const segments: AxisSegment[] = [];
  let x = padX;
  for (const c of cores) {
    const from = c.start - pad;
    const to = c.end + pad;
    const w = (to - from) * scale;
    segments.push({ from, to, x0: x, x1: x + w });
    x += w + breakPx;
  }
  const breaks: AxisBreak[] = [];
  for (let i = 0; i + 1 < segments.length; i++) {
    const a = segments[i] as AxisSegment;
    const b = segments[i + 1] as AxisSegment;
    const gapDays = (cores[i + 1] as Interval).start - (cores[i] as Interval).end;
    const years = Math.round(gapDays / YEAR_DAYS);
    breaks.push({ x0: a.x1, x1: b.x0, gapDays, label: years >= 2 ? `about ${years} years` : `about ${Math.max(1, Math.round(gapDays / 30.44))} months` });
  }
  const at = (day: number): number => {
    for (const s of segments) if (day >= s.from && day <= s.to) return s.x0 + (day - s.from) * scale;
    return Number.NaN;
  };

  const marks: AxisMark[] = spans.map((s) => {
    const x0 = at(s.start);
    const x1 = at(s.end);
    return { id: s.id, precision: s.precision, start: s.start, end: s.end, x0, x1, x: (x0 + x1) / 2 };
  });

  // ticks: the finest step that keeps marks apart, one unit across the whole axis (the scale is shared)
  const choice = TICK_STEPS.find((c) => c.days * scale >= minTickPx) ?? (TICK_STEPS[TICK_STEPS.length - 1] as TickCandidate);
  const era = (segments[0]?.from ?? 0) < dayNumber(1, 1, 1) && (segments[segments.length - 1]?.to ?? 0) > dayNumber(1, 1, 1);
  // day and month ticks name the year on the first visible tick and on every January
  const raw: { x: number; label: string; withYear: string }[] = [];
  for (const s of segments) {
    for (const t of tickDays(choice, s.from, s.to, era)) {
      const y = formatYear(yearOf(t.day), era);
      const withYear = choice.unit === 'month' ? `${t.label} ${y}` : choice.unit === 'day' ? `${t.label}, ${y}` : t.label;
      const jan = (choice.unit === 'month' && t.label === 'Jan') || (choice.unit === 'day' && t.label === 'Jan 1');
      raw.push({ x: s.x0 + (t.day - s.from) * scale, label: jan ? withYear : t.label, withYear });
    }
  }
  // keep ticks whose labels do not collide with each other, a break label or the edges
  const fixed = breaks.map((b) => ({ x: (b.x0 + b.x1) / 2, w: Math.max(labelPx(b.label), b.x1 - b.x0 + 40) }));
  const ticks: AxisTick[] = [];
  for (const r of raw) {
    const label = ticks.length === 0 ? r.withYear : r.label;
    const w = labelPx(label);
    if (r.x - w / 2 < 0 || r.x + w / 2 > width) continue;
    if (fixed.some((f) => Math.abs(f.x - r.x) < (f.w + w) / 2 + 8)) continue;
    const prev = ticks[ticks.length - 1];
    if (prev !== undefined && (r.x - prev.x < Math.max(56, (labelPx(prev.label) + w) / 2 + 12))) continue;
    ticks.push({ x: r.x, label });
  }
  return { width, segments, breaks, ticks, marks, unit: choice.unit, tickDays: choice.days };
}

/** Pixel position of a day on the axis; null when the day falls in a cut gap or off the axis. */
export function dayToX(axis: TimeAxis, day: number): number | null {
  for (const s of axis.segments) {
    if (day >= s.from && day <= s.to) return s.x0 + ((day - s.from) / (s.to - s.from)) * (s.x1 - s.x0);
  }
  return null;
}

// ---- how far apart two events are --------------------------------------------------------------------------------

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** How long after `a` the event `b` happened, at the precision both dates state ('32 days later', 'about 17 months later'). */
export function gapText(a: DateLike, b: DateLike): string {
  const pa = precisionOf(a);
  const pb = precisionOf(b);
  const years = astro(b.year) - astro(a.year);
  if (pa === 'year' || pb === 'year') return years === 0 ? 'the same year' : `about ${plural(Math.abs(years), 'year')} ${years > 0 ? 'later' : 'earlier'}`;
  const months = years * 12 + (b.month - a.month);
  if (pa === 'month' || pb === 'month' || Math.abs(months) >= 3) {
    if (months === 0) return 'the same month';
    if (Math.abs(months) >= 24) return `about ${plural(Math.abs(years), 'year')} ${years > 0 ? 'later' : 'earlier'}`;
    if (pa === 'day' && pb === 'day' && Math.abs(eventSpan(b).start - eventSpan(a).start) < 60) {
      // fall through to days
    } else return `about ${plural(Math.abs(months), 'month')} ${months > 0 ? 'later' : 'earlier'}`;
  }
  const days = eventSpan(b).start - eventSpan(a).start;
  if (days === 0) return 'the same day';
  return `${plural(Math.abs(days), 'day')} ${days > 0 ? 'later' : 'earlier'}`;
}

// ---- labels ------------------------------------------------------------------------------------------------------------

export interface LabelPlacement {
  id: string;
  side: 'above' | 'below';
  /** Left edge of the label box. */
  left: number;
  /** The mark's x. */
  anchorX: number;
  /** Where the leader line meets the label box (equals anchorX whenever the box could stay over its mark). */
  attachX: number;
}

export interface LabelLayout { labelWidth: number; placements: LabelPlacement[] }

export interface LabelOptions {
  width: number;
  maxLabelWidth?: number;
  minLabelWidth?: number;
  gap?: number;
  /** Labels stay inside [inset, width - inset]. */
  inset?: number;
  /** 'alternate' (default) spreads neighbours over both rows; 'below' keeps every label under the axis. */
  sides?: 'alternate' | 'below';
}

/**
 * Collision-free labels for marks on a horizontal axis: neighbours in date order alternate above and below the axis, so
 * a dense cluster spreads over two rows; on each row boxes keep date order and are pushed apart as little as possible
 * (overlapping groups are merged and centred on their marks). Leader lines run from each mark to its box and never cross
 * on a row. Null when even the narrowest labels do not fit.
 */
export function layoutLabels(anchors: readonly { id: string; x: number }[], opts: LabelOptions): LabelLayout | null {
  const gap = opts.gap ?? 8;
  const inset = opts.inset ?? 0;
  const lo = inset;
  const hi = opts.width - inset;
  const sorted = anchors.map((a, i) => ({ ...a, i })).sort((p, q) => p.x - q.x || p.i - q.i);
  const rows = opts.sides === 'below'
    ? { above: [], below: sorted }
    : { above: sorted.filter((_, k) => k % 2 === 0), below: sorted.filter((_, k) => k % 2 === 1) };
  const most = Math.max(rows.above.length, rows.below.length, 1);
  const fitWidth = Math.floor((hi - lo - (most - 1) * gap) / most);
  const w = Math.min(opts.maxLabelWidth ?? 184, fitWidth);
  if (w < (opts.minLabelWidth ?? 112)) return null;
  const step = w + gap;
  const placements: LabelPlacement[] = [];
  for (const side of ['above', 'below'] as const) {
    const row = rows[side];
    const desired = row.map((a) => Math.min(hi - w, Math.max(lo, a.x - w / 2)));
    type Group = { first: number; count: number; left: number };
    const groups: Group[] = [];
    const settle = (g: Group): void => {
      let sum = 0;
      for (let j = 0; j < g.count; j++) sum += (desired[g.first + j] as number) - j * step;
      g.left = Math.min(hi - (g.count * step - gap), Math.max(lo, sum / g.count));
    };
    row.forEach((_, j) => {
      groups.push({ first: j, count: 1, left: desired[j] as number });
      for (;;) {
        const g = groups[groups.length - 1] as Group;
        const p = groups[groups.length - 2];
        if (p === undefined || p.left + p.count * step <= g.left + 1e-9) break;
        p.count += g.count;
        groups.pop();
        settle(p);
      }
    });
    for (const g of groups) {
      for (let j = 0; j < g.count; j++) {
        const a = row[g.first + j] as { id: string; x: number };
        const left = g.left + j * step;
        placements.push({ id: a.id, side, left, anchorX: a.x, attachX: Math.min(left + w - 10, Math.max(left + 10, a.x)) });
      }
    }
  }
  // back in the caller's order
  const order = new Map(anchors.map((a, i) => [a.id, i] as const));
  placements.sort((p, q) => (order.get(p.id) ?? 0) - (order.get(q.id) ?? 0));
  return { labelWidth: w, placements };
}
