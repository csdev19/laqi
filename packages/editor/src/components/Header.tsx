import type { Status } from '../types'

export function Header(props: {
  status: Status | null
  endpointCount: number
  failedFiles: number
  overridden: number
  onOpenPalette: () => void
}) {
  const { status, endpointCount, failedFiles, overridden, onOpenPalette } = props

  return (
    <header className="header">
      <span className="brand">
        <span className="brand-bolt">↯</span> laqi
      </span>

      <div className="header-facts">
        <Fact label="watching" value={status?.watching ?? '…'} />
        <Fact
          label="endpoints"
          // El contador nunca miente en silencio: si un archivo no cargó,
          // lo dice acá mismo en vez de mostrar un total más chico a secas.
          value={
            failedFiles > 0
              ? `${endpointCount} (+${failedFiles} file failed)`
              : String(endpointCount)
          }
        />
        <Fact label="local" value={status?.address ?? '…'} />
        <Fact label="overridden" value={String(overridden)} accent={overridden > 0} />
      </div>

      <div className="header-actions">
        <button type="button" className="btn" onClick={onOpenPalette}>
          Jump to… ⌘K
        </button>
      </div>
    </header>
  )
}

function Fact(props: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="fact">
      <span className="micro">{props.label}</span>
      <span className={props.accent ? 'fact-value is-overridden' : 'fact-value'}>
        {props.value}
      </span>
    </span>
  )
}
