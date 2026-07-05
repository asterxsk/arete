export function clampScroll(
  current: number,
  delta: number,
  totalLines: number,
  visibleHeight: number,
): number {
  const maxOffset = Math.max(0, totalLines - visibleHeight);
  const next = current + delta;
  if (next < 0) return 0;
  if (next > maxOffset) return maxOffset;
  return next;
}
