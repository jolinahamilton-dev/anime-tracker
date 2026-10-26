import { useEffect, useRef, useState } from 'react'
import { abonniereMeldungen, schliesseSnackbar, Rueckfrage, Snack } from '../meldungen'
import './Meldungen.css'

export default function Meldungen() {
  const [rueckfrage, setRueckfrage] = useState<Rueckfrage | null>(null)
  const [snack, setSnack] = useState<Snack | null>(null)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => abonniereMeldungen(z => { setRueckfrage(z.rueckfrage); setSnack(z.snack) }), [])

  // Rückfrage: Enter = OK, Esc = Abbrechen; Fokus auf den OK-Knopf
  useEffect(() => {
    if (!rueckfrage) return
    okRef.current?.focus()
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); rueckfrage.antwort(false) }
    }
    window.addEventListener('keydown', taste, true)
    return () => window.removeEventListener('keydown', taste, true)
  }, [rueckfrage])

  useEffect(() => {
    if (!snack) return
    const t = setTimeout(() => schliesseSnackbar(snack.id), snack.dauer)
    return () => clearTimeout(t)
  }, [snack])

  return (
    <>
      {rueckfrage && (
        <div className="dialog-hintergrund" onClick={() => rueckfrage.antwort(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-titel" onClick={e => e.stopPropagation()}>
            <h3 id="dialog-titel" className="dialog-titel">{rueckfrage.titel}</h3>
            {rueckfrage.text && <p className="dialog-text">{rueckfrage.text}</p>}
            <div className="dialog-knoepfe">
              {rueckfrage.abbrechen !== null && (
                <button className="dialog-btn" onClick={() => rueckfrage.antwort(false)}>{rueckfrage.abbrechen ?? 'Abbrechen'}</button>
              )}
              <button
                ref={okRef}
                className={rueckfrage.gefahr ? 'dialog-btn dialog-btn--gefahr' : 'dialog-btn dialog-btn--ok'}
                onClick={() => rueckfrage.antwort(true)}
              >{rueckfrage.ok ?? 'OK'}</button>
            </div>
          </div>
        </div>
      )}
      {snack && (
        <div className="snackbar" role="status" key={snack.id}>
          <span className="snackbar-text">{snack.text}</span>
          {snack.aktion && (
            <button className="snackbar-aktion" onClick={() => { snack.aktion!.ausfuehren(); schliesseSnackbar(snack.id) }}>
              {snack.aktion.label}
            </button>
          )}
          <button className="snackbar-zu" aria-label="Hinweis schließen" onClick={() => schliesseSnackbar(snack.id)}>✕</button>
        </div>
      )}
    </>
  )
}
