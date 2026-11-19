// How the panel writes a category's share of the changed lines. Pure: no DOM.

/**
 * `lines` out of `total` as a whole percent. A real share never reads as 0% or 100%: it shows
 * "<1%" or ">99%" instead, so the shares on screen never contradict each other.
 */
export function formatShare(lines: number, total: number): string {
  if (lines === 0 || total === 0) return '0%'
  const percent = Math.round((lines / total) * 100)
  if (percent === 0) return '<1%'
  if (percent === 100 && lines < total) return '>99%'
  return `${percent}%`
}
