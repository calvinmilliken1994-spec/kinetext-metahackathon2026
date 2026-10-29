// Container-scoped scrolling. element.scrollIntoView() scrolls EVERY scrollable ancestor, including overflow:hidden
// ones and the document, which pushed the whole app window out of the viewport. These helpers only move the panels
// that are meant to scroll (the lesson column, the source text, the runs drawer, the stacked workspace).

export type ScrollBlock = 'start' | 'center' | 'nearest';

export interface ScrollBox {
  /** The container's visible top edge in viewport coordinates (getBoundingClientRect().top). */
  top: number;
  /** Visible height of the container (clientHeight). */
  height: number;
  scrollTop: number;
  scrollHeight: number;
}

export interface TargetBox {
  /** The target's top edge in viewport coordinates. */
  top: number;
  height: number;
}

/**
 * The scrollTop that brings `target` into view inside `container`, clamped to the scrollable range.
 * 'start' puts the target `margin` px below the container's top; 'center' centres it (a target taller than the
 * container is aligned to its start instead); 'nearest' moves only when the target is not fully visible.
 */
export function scrollTopToReveal(container: ScrollBox, target: TargetBox, block: ScrollBlock = 'start', margin = 12): number {
  const maxTop = Math.max(0, container.scrollHeight - container.height);
  // Target position measured from the top of the container's scrolled content.
  const offset = target.top - container.top + container.scrollTop;
  let next: number;
  if (block === 'center' && target.height < container.height) {
    next = offset - (container.height - target.height) / 2;
  } else if (block === 'nearest') {
    const visibleTop = container.scrollTop + margin;
    const visibleBottom = container.scrollTop + container.height - margin;
    if (offset >= visibleTop && offset + target.height <= visibleBottom) return clampTop(container.scrollTop, maxTop);
    next = offset < visibleTop || target.height > container.height - 2 * margin
      ? offset - margin
      : offset + target.height - container.height + margin;
  } else {
    next = offset - margin;
  }
  return clampTop(Math.round(next), maxTop);
}

function clampTop(value: number, maxTop: number): number {
  return Math.min(maxTop, Math.max(0, value));
}

/** True when an element with this computed overflow-y can scroll its content. */
export function isScrollableOverflow(overflowY: string): boolean {
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

// ---- DOM side (browser only) ----------------------------------------------------------------------------------

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The scroll containers between `el` and the app window, innermost first. Stops at `.app-window` (or the body), so
 * the window frame, the backdrop and the document are never scrolled.
 */
export function scrollContainersOf(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  let node = el.parentElement;
  while (node !== null && node !== document.body && !node.classList.contains('app-window')) {
    const style = window.getComputedStyle(node);
    if (isScrollableOverflow(style.overflowY) && node.scrollHeight > node.clientHeight) out.push(node);
    node = node.parentElement;
  }
  return out;
}

/** Scroll the panels that hold `el` (never the document) so it is visible; smooth unless reduced motion is on. */
export function revealInPanels(el: HTMLElement | null, block: ScrollBlock = 'start', margin = 12): void {
  if (el === null) return;
  const behavior: ScrollBehavior = reducedMotion() ? 'auto' : 'smooth';
  // Innermost first: each outer container measures the target after the inner one has been aimed at it. Rects are
  // read before any smooth scroll starts, so compute every container's goal from current geometry.
  const containers = scrollContainersOf(el);
  const goals = containers.map((c, i) => {
    const r = c.getBoundingClientRect();
    // For an outer container, aim at the inner container that holds the target (its own position is stable).
    const inner = i === 0 ? el : containers[i - 1] as HTMLElement;
    const t = inner.getBoundingClientRect();
    const box: ScrollBox = { top: r.top + c.clientTop, height: c.clientHeight, scrollTop: c.scrollTop, scrollHeight: c.scrollHeight };
    return scrollTopToReveal(box, { top: t.top, height: t.height }, i === 0 ? block : 'nearest', margin);
  });
  containers.forEach((c, i) => {
    const top = goals[i] as number;
    if (Math.abs(c.scrollTop - top) >= 1) c.scrollTo({ top, behavior });
  });
}

/** Scroll one container back to its top (smooth unless reduced motion is on). */
export function scrollPanelToTop(el: HTMLElement | null): void {
  if (el === null) return;
  el.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
}
