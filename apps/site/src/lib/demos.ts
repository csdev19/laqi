// The page's three recordings, declared in one place so that dropping a file
// in turns the slot on everywhere that depends on it — including the hero's
// second CTA, which must not exist while there is nothing to watch.
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
  scenarios: {
    src: null,
    poster: null,
    label: 'The “offline” scenario moves all four todo endpoints in one click.',
    brief:
      '~30s. Activate the `offline` scenario and show several endpoints moving together, visible in more than one place in the UI at once. The panel shows which endpoints it covers. Dishonest if it implies scenarios stack — only one is active at a time, and the panel says so.',
  },
  generate: {
    src: null,
    poster: null,
    label: 'A pasted TypeScript model becomes seeded data the app can render.',
    brief:
      '~30s. Paste a TypeScript interface into the panel; generate seeded data from it — emails in email fields, dates in createdAt; write the body to a response; show the app rendering it. Dishonest if it implies the model is stored as a schema that stays in sync with the body. It is not — see ADR-0013.',
  },
} satisfies Record<string, Demo>

/**
 * A slot is published once it has a file. Before that it is visible only in
 * `astro dev`, so the layout can be worked on without shipping an empty frame.
 */
export function isVisible(demo: Demo): boolean {
  return demo.src !== null || import.meta.env.DEV
}
