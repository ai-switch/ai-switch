// 全部来源能放下时无需“更多”；实际溢出才给触发按钮留出空间。
export function computeVisibleSourceFilterCount(
  availableWidth: number,
  chipWidths: number[],
  moreWidth = 64,
  gap = 0,
): number {
  if (availableWidth <= 0) return chipWidths.length;
  const total = chipWidths.reduce((sum, width) => sum + width, 0)
    + Math.max(0, chipWidths.length - 1) * gap;
  if (total <= availableWidth) return chipWidths.length;

  let used = 0;
  for (let index = 0; index < chipWidths.length; index += 1) {
    used += chipWidths[index] + (index > 0 ? gap : 0);
    if (used + gap + moreWidth > availableWidth) return index;
  }
  return chipWidths.length;
}
