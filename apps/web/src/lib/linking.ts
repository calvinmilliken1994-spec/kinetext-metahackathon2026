// Two-way hover linking between the source page and the lesson (Stage 7 item 3, pure parts + a tiny store).
//
// Every quoted element — a source highlight, an explanation, an overview point, a quiz card, a compare cell, a timeline
// event, an equation — carries LINK KEYS. A link key identifies one quote on one source the same way the validator proves
// grounding: the source id plus the whitespace-normalised quote text (normalizeWhitespace, shared with highlight.ts).
// Hovering or focusing any element makes its keys active; every element carrying one of them lights up.

import { normalizeWhitespace } from './highlight.ts';
import type { CharRange } from './highlight.ts';

/** 32-bit FNV-1a, so a key is a short token that fits a space-separated data attribute. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The link key of one quote on one source; '' for a blank quote (it links to nothing). */
export function linkKey(sourceId: string, quote: string): string {
  const q = normalizeWhitespace(quote);
  if (q === '') return '';
  return `q${fnv1a(`${sourceId}\u0000${q}`).toString(36)}${q.length.toString(36)}`;
}

export interface QuoteLike { sourceId: string; quote: string }

/** Distinct link keys of a list of quotes, in order; blank quotes are skipped. */
export function linkKeysOf(quotes: readonly QuoteLike[]): string[] {
  const out: string[] = [];
  for (const q of quotes) {
    const k = linkKey(q.sourceId, q.quote);
    if (k !== '' && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Link keys of one highlighted source segment: its quote-ref keys mapped through their quotes on the shown source. */
export function markLinks(keys: readonly string[], quoteOf: (key: string) => string | undefined, sourceId: string): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const quote = quoteOf(key);
    if (quote === undefined) continue;
    const k = linkKey(sourceId, quote);
    if (k !== '' && !out.includes(k)) out.push(k);
  }
  return out;
}

/** One tab stop per quote: the segment where one of its quotes begins (overlaps split a quote into several marks). */
export function segmentIsTabStop(segment: { start: number; keys: readonly string[] }, ranges: Readonly<Record<string, CharRange>>): boolean {
  return segment.keys.some((k) => ranges[k]?.start === segment.start);
}

// ---- the engine equation's page quote ------------------------------------------------------------------------------

const compact = (s: string): string => normalizeWhitespace(s).toLowerCase().replace(/[\s_*·×]/g, '');

/**
 * The explanation quotes that state the engine's equation (spec.simulation.equation), compared with spacing, `*`, `·`
 * and `_` ignored ("y_max=V0^2/(2*g)" matches "ymax = V0^2 / (2 * g)"). When no quote states the whole equation, the
 * quotes that define its left-hand side ("L = …") are used; otherwise none.
 */
export function equationQuoteLinks(spec: {
  simulation: { equation?: unknown };
  explanations: readonly { id?: string; text?: string; evidence: readonly QuoteLike[] }[];
}): string[] {
  const equation = typeof spec.simulation.equation === 'string' ? spec.simulation.equation : '';
  const eqAt = equation.indexOf('=');
  if (eqAt <= 0) return [];
  const whole = compact(equation);
  const lhs = compact(equation.slice(0, eqAt));
  const quotes = spec.explanations.flatMap((e) => e.evidence);
  const full = quotes.filter((q) => compact(q.quote).includes(whole));
  if (full.length > 0) return linkKeysOf(full);
  // Word boundaries matter here ("the lift L =" must not read as "liftl="), so only symbols are dropped, not spaces.
  const light = (s: string): string => normalizeWhitespace(s).toLowerCase().replace(/[_*·×]/g, '');
  const lhsPattern = new RegExp(`(^|[^a-z0-9])${lhs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  return linkKeysOf(quotes.filter((q) => lhsPattern.test(light(q.quote))));
}

// ---- the active link (hover / keyboard focus) ----------------------------------------------------------------------

export type LinkOrigin = 'source' | 'lesson';

export interface ActiveLink {
  /** The element that set it (a stable per-element id). */
  owner: string;
  keys: readonly string[];
  origin: LinkOrigin;
}

/** True when any of `keys` is active. */
export function isLit(active: ActiveLink | null, keys: readonly string[]): boolean {
  if (active === null) return false;
  return keys.some((k) => k !== '' && active.keys.includes(k));
}

export interface LinkStore {
  /** The innermost hovered / focused element's keys, or null. */
  get: () => ActiveLink | null;
  /** An element is hovered or focused. Nested elements stack: the last one entered wins. */
  enter: (owner: string, keys: readonly string[], origin: LinkOrigin) => void;
  /** The element is left; the one it was nested in (if still entered) becomes active again. */
  leave: (owner: string) => void;
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
}

export function createLinkStore(): LinkStore {
  let stack: ActiveLink[] = [];
  let active: ActiveLink | null = null;
  const listeners = new Set<() => void>();
  const settle = (): void => {
    const top = stack[stack.length - 1] ?? null;
    if (top === active) return;
    active = top;
    for (const l of [...listeners]) l();
  };
  return {
    get: () => active,
    enter: (owner, keys, origin) => {
      const usable = keys.filter((k) => k !== '');
      stack = stack.filter((e) => e.owner !== owner);
      if (usable.length > 0) stack.push({ owner, keys: usable, origin });
      settle();
    },
    leave: (owner) => {
      if (!stack.some((e) => e.owner === owner)) return;
      stack = stack.filter((e) => e.owner !== owner);
      settle();
    },
    clear: () => { stack = []; settle(); },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The one store the source panel and the lesson share (they are siblings; no provider is needed). */
export const linkStore: LinkStore = createLinkStore();
