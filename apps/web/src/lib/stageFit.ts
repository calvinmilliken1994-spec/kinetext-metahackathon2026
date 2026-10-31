/** Keep the current stage scale unless the new fit differs by at least 0.5%: sub-pixel measuring noise must not rescale. */
export function settleZoom(prev: number, next: number): number {
  return Math.abs(next - prev) < 0.005 * prev ? prev : next;
}
