/**
 * The nine sections the home page is built from, in page order.
 *
 * One list feeds three consumers: the rail on the right, the four chips in
 * the "four moments" section, and the sections themselves. A chapter
 * therefore cannot exist in the navigation and not on the page, or drift in
 * colour between the two.
 *
 * `tint` names a token in @laqi/tokens rather than carrying a hex, so the
 * colour stays in the one file that is allowed to hold hexes. The tints are
 * not decorative: they follow the panel's semantics, where violet is the
 * scenario layer, magenta is "I changed this", and mint is a healthy GET.
 */
export const CHAPTERS = [
  { id: 'intro', label: 'Top', number: null, tint: null },
  { id: 'why', label: 'Why it works', number: null, tint: 'mint' },
  { id: 'contract', label: 'Contract', number: '01', tint: 'vio' },
  { id: 'flip', label: 'Flip', number: '02', tint: 'mag' },
  { id: 'watch', label: 'Watch', number: '03', tint: 'mint' },
  { id: 'share', label: 'Share', number: '04', tint: 'warn' },
  { id: 'files', label: 'Your files', number: null, tint: 'palev' },
  { id: 'start', label: 'Start', number: null, tint: 'vio' },
] as const

export type Chapter = (typeof CHAPTERS)[number]
export type ChapterId = Chapter['id']

/** The four numbered chapters only — what the "why" section lists as chips. */
export const MOMENTS = CHAPTERS.filter(
  (c): c is Extract<Chapter, { number: string }> => c.number !== null,
)

/** The rail prints this as its lower bound: "01 … 09". */
export const TOTAL = String(CHAPTERS.length).padStart(2, '0')
