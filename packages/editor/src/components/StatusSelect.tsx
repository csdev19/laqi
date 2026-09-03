import { filterStatusCodes, statusClass, type StatusCode } from '@laqi/schema'
import { useState } from 'react'

/**
 * The status field. A combobox and not a `<select>`, because a mock server
 * has to be able to return a code nobody named — and not a `<datalist>`,
 * because that filters on the option's value only, so "not found" would
 * match nothing.
 *
 * The keys are the command palette's: ↑/↓ move, ↵ picks, esc closes. One
 * search behaviour across the panel, learned once.
 */
export function StatusSelect(props: {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  // Focusing shows the whole catalogue; only typing narrows it. Filtering by
  // the value already in the field would open a field reading `200` onto a
  // list containing only `200 OK`, which is the one row you do not need.
  const [typed, setTyped] = useState(false)

  const matches = filterStatusCodes(typed ? props.value : '')

  const pick = (code: number) => {
    props.onChange(String(code))
    setOpen(false)
  }

  return (
    <div className="status-select">
      <input
        id={props.id}
        className="create-input create-status"
        role="combobox"
        aria-label={props.label}
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        inputMode="numeric"
        value={props.value}
        onFocus={() => {
          setOpen(true)
          setHighlight(0)
          setTyped(false)
        }}
        // `blur` and not a document listener: the option rows fire on
        // mouseDown, which lands before blur, so the click still registers.
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          props.onChange(event.target.value)
          setOpen(true)
          setHighlight(0)
          setTyped(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            // Not stopped: Escape also cancels the create row, and a closed
            // dropdown should not eat the second press.
            return
          }
          if (!open || matches.length === 0) {
            // Nothing to pick. Enter belongs to the form, which is what
            // submits a free-text code like 599.
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setHighlight((index) => Math.min(index + 1, matches.length - 1))
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setHighlight((index) => Math.max(index - 1, 0))
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            pick(matches[highlight]!.code)
          }
        }}
      />

      {open ? (
        matches.length === 0 ? (
          <div className="status-empty micro">
            {props.value.trim()} is not a named code — it will be used as typed
          </div>
        ) : (
          <ul className="status-list" role="listbox" aria-label={`${props.label} options`}>
            {groupRows(matches).map((row) =>
              row.kind === 'group' ? (
                <li key={`group-${row.group}`} className="status-group micro" role="presentation">
                  {row.group}
                </li>
              ) : (
                <li
                  key={row.entry.code}
                  role="option"
                  aria-selected={row.index === highlight}
                  className={
                    row.index === highlight ? 'status-option is-highlighted' : 'status-option'
                  }
                  // mouseDown, not click: click fires after blur, by which
                  // point the list is gone and the pick never happens.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    pick(row.entry.code)
                  }}
                >
                  <span className={`chip-status status-${statusClass(row.entry.code)}`}>
                    {row.entry.code}
                  </span>
                  <span className="status-label">{row.entry.label}</span>
                </li>
              ),
            )}
          </ul>
        )
      ) : null}
    </div>
  )
}

type Row = { kind: 'group'; group: string } | { kind: 'option'; entry: StatusCode; index: number }

/**
 * Flattens the matches into rows with a group heading inserted whenever the
 * class changes. The option's `index` is its position among OPTIONS, not
 * among rows — the highlight has to skip headings.
 */
function groupRows(matches: readonly StatusCode[]): Row[] {
  const rows: Row[] = []
  let current: string | null = null

  matches.forEach((entry, index) => {
    if (entry.group !== current) {
      current = entry.group
      rows.push({ kind: 'group', group: entry.group })
    }
    rows.push({ kind: 'option', entry, index })
  })

  return rows
}
