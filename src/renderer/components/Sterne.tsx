import './Sterne.css'

interface Props {
  wert: number | null
  onChange: (wert: number | null) => void
  readonly?: boolean
}

export default function Sterne({ wert, onChange, readonly }: Props) {
  return (
    <div className="sterne-row">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          className={`stern ${wert !== null && n <= wert ? 'aktiv' : ''}`}
          onClick={() => !readonly && onChange(wert === n ? null : n)}
          disabled={readonly}
          title={`${n} Stern${n > 1 ? 'e' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}
