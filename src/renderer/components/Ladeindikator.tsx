import './Ladeindikator.css'

export default function Ladeindikator({ text = 'Wird geladen…' }: { text?: string }) {
  return (
    <div className="ladeindikator">
      <div className="lade-spinner" />
      <p>{text}</p>
    </div>
  )
}
