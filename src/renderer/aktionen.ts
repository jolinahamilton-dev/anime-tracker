import { useEffect } from 'react'
import { api } from './api'
import { bestaetigen, snackbar } from './meldungen'

// Seitenübergreifendes Signal „Daten haben sich geändert" – z. B. wenn „Rückgängig" in der
// Snackbar gedrückt wird, nachdem man die Seite schon verlassen hat
const EREIGNIS = 'tracker:daten-geaendert'
export function meldeAenderung() { window.dispatchEvent(new Event(EREIGNIS)) }
export function useBeiAenderung(f: () => void) {
  useEffect(() => {
    window.addEventListener(EREIGNIS, f)
    return () => window.removeEventListener(EREIGNIS, f)
  }, [f])
}

/**
 * „+1" bzw. „−1" (Liste, Weiterschauen, Tastenkürzel): zählt die passende Staffel bzw.
 * Folge/Kapitel weiter, zeigt „Rückgängig" an und bietet am Ende „Als Beendet markieren?" an.
 */
export async function aendereFortschritt(entryId: number, delta: 1 | -1) {
  const r = await api.aendereFortschritt(entryId, delta)
  if (!r) return
  if (r.keinZiel) {
    snackbar(delta > 0 ? 'Alles Verfügbare ist schon geschaut.' : 'Noch nichts geschaut.')
    return
  }
  meldeAenderung()
  const titel = r.entry.nickname || r.entry.title
  snackbar(`${titel}: ${r.beschreibung} ✓`, r.rueckgaengig ? {
    label: 'Rückgängig',
    ausfuehren: async () => { await api.rueckgaengig(r.rueckgaengig!); meldeAenderung() },
  } : undefined)

  if (r.fertigVorschlag) {
    const ja = await bestaetigen(`„${titel}" komplett geschaut`, {
      text: 'Als „Beendet" markieren?', ok: 'Beendet', abbrechen: 'Noch nicht',
    })
    if (ja) {
      await api.updateEntry(entryId, { status: 'completed' })
      snackbar(`„${titel}" ist jetzt beendet 🏆`)
      meldeAenderung()
    }
  }
}

/** Eintrag löschen – mit Rückfrage und „Rückgängig" */
export async function loescheEintrag(entryId: number, titel: string): Promise<boolean> {
  const ja = await bestaetigen(`„${titel}" löschen?`, {
    text: 'Fortschritt, Watch-Order und Listen-Zuordnung werden entfernt. Direkt danach kannst du es noch rückgängig machen.',
    ok: 'Löschen', gefahr: true,
  })
  if (!ja) return false
  const r = await api.deleteEntry(entryId)
  meldeAenderung()
  snackbar(`„${titel}" gelöscht`, r.rueckgaengig ? {
    label: 'Rückgängig',
    ausfuehren: async () => { await api.rueckgaengig(r.rueckgaengig!); meldeAenderung() },
  } : undefined, 8000)
  return true
}
