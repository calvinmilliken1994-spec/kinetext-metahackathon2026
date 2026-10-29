// Concept map (concept-map-v1) view model (pure): a radial layout by node index, arrows clipped to node borders with
// the relation word as a label, and the gap-fill helpers. Only links with both endpoints present are ever drawn.

import type { ConceptMapRelation, ConceptMapSpec, MapLinkGen } from '../../../../packages/contracts/kit.ts';
import { CONCEPT_MAP_RELATIONS } from '../../../../packages/contracts/kit.ts';
import { seededOrder } from './seeded.ts';

export const MAP_WIDTH = 760;
export const MAP_HEIGHT = 460;
const CHAR_W = 7.4;
const LINE_H = 17;
const LABEL_CHAR_W = 6.6;
const LABEL_H = 20;

export interface PlacedNode { id: string; label: string; lines: string[]; x: number; y: number; w: number; h: number }
export interface PlacedLink {
  id: string;
  fromId: string;
  toId: string;
  relation: ConceptMapRelation;
  sourceId: string;
  quote: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
  labelW: number;
  labelH: number;
}
export interface MapLayout { width: number; height: number; nodes: PlacedNode[]; links: PlacedLink[] }

/** Greedy word wrap; a word longer than `maxChars` stays whole. */
export function wrapLabel(label: string, maxChars: number): string[] {
  const words = label.trim().split(/\s+/).filter((w) => w !== '');
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + w.length <= maxChars) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  return lines.length === 0 ? [''] : lines;
}

interface Box { x: number; y: number; w: number; h: number }
const boxesOverlap = (a: Box, b: Box, pad = 0): boolean =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad;

/** Distance along (dx, dy) from point p until it leaves the rectangle `r` (p is inside r). */
function exitDistance(px: number, py: number, dx: number, dy: number, r: Box): number {
  const tx = dx === 0 ? Infinity : ((dx > 0 ? r.x + r.w / 2 : r.x - r.w / 2) - px) / dx;
  const ty = dy === 0 ? Infinity : ((dy > 0 ? r.y + r.h / 2 : r.y - r.h / 2) - py) / dy;
  return Math.max(0, Math.min(tx, ty));
}

const LABEL_FRACTIONS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74];

export function layoutConceptMap(spec: ConceptMapSpec): MapLayout {
  const n = spec.nodes.length;
  const sized = spec.nodes.map((node) => {
    const lines = wrapLabel(node.label, 14);
    return { id: node.id, label: node.label, lines, w: Math.max(...lines.map((l) => l.length)) * CHAR_W + 26, h: lines.length * LINE_H + 14 };
  });
  const maxW = Math.max(0, ...sized.map((s) => s.w));
  const maxH = Math.max(0, ...sized.map((s) => s.h));
  const cx = MAP_WIDTH / 2;
  const cy = MAP_HEIGHT / 2;
  const rx = Math.max(0, cx - maxW / 2 - 18);
  const ry = Math.max(0, cy - maxH / 2 - 18);
  const nodes: PlacedNode[] = sized.map((s, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
    return { ...s, x: round(cx + rx * Math.cos(angle)), y: round(cy + ry * Math.sin(angle)) };
  });
  const byId = new Map(nodes.map((nd) => [nd.id, nd] as const));

  const drawable = spec.links.filter((l) => l.fromId !== l.toId && byId.has(l.fromId) && byId.has(l.toId));
  const pairKey = (l: MapLinkGen): string => (l.fromId < l.toId ? `${l.fromId}|${l.toId}` : `${l.toId}|${l.fromId}`);
  const groups = new Map<string, MapLinkGen[]>();
  for (const l of drawable) groups.set(pairKey(l), [...(groups.get(pairKey(l)) ?? []), l]);

  const placedLabels: Box[] = [];
  const nodeBoxes: Box[] = nodes.map((nd) => ({ x: nd.x, y: nd.y, w: nd.w, h: nd.h }));
  const links: PlacedLink[] = drawable.map((l) => {
    const a = byId.get(l.fromId) as PlacedNode;
    const b = byId.get(l.toId) as PlacedNode;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const group = groups.get(pairKey(l)) as MapLinkGen[];
    const k = group.indexOf(l);
    const shift = group.length === 1 ? 0 : (k - (group.length - 1) / 2) * 22;
    // Offset perpendicular to the A->B direction, so a reverse link (B->A) gets the opposite side of the same pair.
    const sign = l.fromId < l.toId ? 1 : -1;
    const ox = -dy * shift * sign;
    const oy = dx * shift * sign;
    const sx = a.x + ox;
    const sy = a.y + oy;
    const ex = b.x + ox;
    const ey = b.y + oy;
    const s0 = exitDistance(sx, sy, dx, dy, a);
    const e0 = exitDistance(ex, ey, -dx, -dy, b);
    const x1 = sx + dx * s0;
    const y1 = sy + dy * s0;
    const x2 = ex - dx * e0;
    const y2 = ey - dy * e0;
    const labelW = l.relation.length * LABEL_CHAR_W + 14;
    let best: Box | null = null;
    let bestScore = Infinity;
    for (const f of LABEL_FRACTIONS) {
      const box: Box = { x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f, w: labelW, h: LABEL_H };
      const score = nodeBoxes.filter((nb) => boxesOverlap(box, nb, 2)).length * 2 + placedLabels.filter((pb) => boxesOverlap(box, pb, 2)).length;
      if (score < bestScore) { best = box; bestScore = score; }
      if (score === 0) break;
    }
    const label = best as Box;
    placedLabels.push(label);
    return {
      id: l.id, fromId: l.fromId, toId: l.toId, relation: l.relation, sourceId: l.sourceId, quote: l.quote,
      x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2),
      labelX: round(label.x), labelY: round(label.y), labelW: round(labelW), labelH: LABEL_H,
    };
  });
  return { width: MAP_WIDTH, height: MAP_HEIGHT, nodes, links };
}

const round = (v: number): number => Math.round(v * 100) / 100;

// ---- gap-fill (optional second step) ----------------------------------------------------------------------------

/** The link whose relation word is hidden: the longest quote, lowest id on a tie. */
export function pickGapLink(spec: ConceptMapSpec): MapLinkGen | null {
  const sorted = [...spec.links].sort((a, b) => b.quote.length - a.quote.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sorted[0] ?? null;
}

/** Three distinct relation words in a seeded order; the right one is never first. */
export function gapOptions(spec: ConceptMapSpec, link: MapLinkGen): ConceptMapRelation[] {
  const seed = `${spec.seed}:${link.id}`;
  const others = seededOrder(CONCEPT_MAP_RELATIONS.filter((r) => r !== link.relation), seed).slice(0, 2);
  return seededOrder([link.relation, ...others], `${seed}:options`, { avoidFirst: link.relation });
}

export function gradeGap(link: MapLinkGen, picked: string): boolean {
  return picked === link.relation;
}

/** 'drag uses density' */
export function relationSentence(spec: ConceptMapSpec, link: MapLinkGen): string {
  const name = (id: string): string => spec.nodes.find((nd) => nd.id === id)?.label ?? id;
  return `${name(link.fromId)} ${link.relation} ${name(link.toId)}`;
}
