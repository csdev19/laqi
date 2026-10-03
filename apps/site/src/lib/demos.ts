// The page's one recording, declared here so that dropping a file in turns
// the slot on everywhere that depends on it — including the hero's second
// CTA, which must not exist while there is nothing to watch.
//
// There were three. The other two are gone because the page grew surfaces
// that already carry them: the flip chapter draws the panel with two
// scenario rows lit and the layer that chose each one, and the model chapter
// puts the model and the body it generates either side of an arrow, so the
// transformation is legible in a single frame. Neither has a hidden moment a
// recording would reveal.
//
// This one does. The claim it serves — a state changes and nothing restarts —
// is about what does NOT happen between two moments, and a still has no
// between. It is also the only artifact on the page that would prove
// something ran: every product surface here is drawn from the real
// stylesheets, which makes them accurate, not evidence.
//
// Put the files in apps/site/public/demos/ and set `src` to the public path.
// Until then the slot renders only under `astro dev` (see `isVisible`), so a
// visitor never meets an empty box: that was the defect this replaced.

export type Demo = {
  /** Public path to the recording, e.g. '/demos/hero-flip.mp4'. */
  src: string | null
  /** Poster frame shown before the video loads, e.g. '/demos/hero-flip.jpg'. */
  poster: string | null
  /** Caption a visitor reads under the video. Must describe what they just saw. */
  label: string
  /** Fake address bar above the frame, for a shot that includes the panel. */
  chrome?: string
  /**
   * What this recording has to show, and what would make it dishonest.
   * Rendered only in dev — it is a note to whoever holds the camera, and
   * shipping it as body text is exactly how the old placeholders failed.
   */
  brief: string
}

export const demos = {
  hero: {
    src: null,
    poster: null,
    chrome: '127.0.0.1:8000/__laqi',
    label: 'One click on “empty” and the list empties — no reload, no restart.',
    brief:
      '~20s, 16:9. The todo app beside the panel. Click `empty` on GET /todos — the list empties with no reload. Click `error` — the error state appears. Nothing is typed, no file is saved, no server restarts. Dishonest if it cuts between takes to hide a reload, speeds up the response, or uses an app that is not examples/todo-app.',
  },
} satisfies Record<string, Demo>

/**
 * A slot is published once it has a file. Before that it is visible only in
 * `astro dev`, so the layout can be worked on without shipping an empty frame.
 */
export function isVisible(demo: Demo): boolean {
  return demo.src !== null || import.meta.env.DEV
}
