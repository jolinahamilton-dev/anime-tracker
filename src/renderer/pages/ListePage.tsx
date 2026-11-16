import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEntries } from '../hooks/useEntries'
import { Entry, EntryStatus, MediaType, MehrfachAktion } from '../../types'
import EintragKarte from '../components/EintragKarte'
import BildVergroesserung from '../components/BildVergroesserung'
import StatusFilter from '../components/StatusFilter'
import Ladeindikator from '../components/Ladeindikator'
import Weiterschauen from '../components/Weiterschauen'
import BottomSheet from '../components/BottomSheet'
import MehrFilter from '../components/MehrFilter'
import Auswahlleiste from '../components/Auswahlleiste'
import {
  FilterWerte, SORT_OPTIONEN, STANDARD_RICHTUNG, STANDARD_NEUE_FILTER, SortRichtung, alleGenres, anzahlNeueFilter, passtZuNeuenFiltern, sortiere,
} from '../listenLogik'
import {
  Ansicht, Ansichten, SortOption, STANDARD_FILTER,
  ladeFilter, speichereFilter, ansichtKey, ladeAnsichten, speichereAnsichten, sitzung,
} from '../listenZustand'
import { api, CustomListMitEintraegen as CustomList } from '../api'
import { aendereFortschritt, meldeAenderung, useBeiAenderung } from '../aktionen'
import { bestaetigen, snackbar } from '../meldungen'
import { anzahlBaende } from '../baende'
import { setzeAnsichtGlobal } from '../ansichtGlobal'
import { istTippen, overlayOffen, useIstHandy, useTasten } from '../tastatur'
import { anzeigeTitel } from '../titel'
import './Page.css'
import './ListePage.css'

const ANSICHTEN: Array<{ key: Ansicht; icon: string; label: string }> = [
  { key: 'liste', icon: '☰', label: 'Liste' },
  { key: 'kacheln', icon: '▦', label: 'Kacheln' },
  { key: 'gross', icon: '⬛', label: 'Große Symbole' },
]

const STATUS_NAME: Record<string, string> = { ongoing: 'Laufend', completed: 'Beendet', planned: 'Geplant', paused: 'Pausiert', dropped: 'Abgebrochen' }
const SORT_TEXT: Record<SortOption, string> = {
  zuletzt: 'Zuletzt bearbeitet', alphabetisch: 'Alphabetisch', bewertung: 'Bewertung', hinzugefuegt: 'Hinzugefügt',
  fortschritt: 'Fortschritt', naechste: 'Nächste Folge', geschaut: 'Zuletzt geschaut',
}
const SORTIERUNGEN = SORT_OPTIONEN.map(key => ({ key, label: SORT_TEXT[key] }))
// Beschriftung der Richtung je Sortierung („Neueste zuerst“ statt nur Pfeil); Index 0 = aufsteigend, 1 = absteigend
const RICHTUNG_TEXT: Record<SortOption, [string, string]> = {
  zuletzt: ['Älteste zuerst', 'Neueste zuerst'], hinzugefuegt: ['Älteste zuerst', 'Neueste zuerst'], geschaut: ['Älteste zuerst', 'Neueste zuerst'],
  alphabetisch: ['A bis Z', 'Z bis A'], bewertung: ['Niedrigste zuerst', 'Höchste zuerst'],
  fortschritt: ['Wenigste zuerst', 'Meiste zuerst'], naechste: ['Bald zuerst', 'Spät zuerst'],
}

export default function ListePage() {
  const { entries, laden, stillAktualisieren } = useEntries()
  const navigate = useNavigate()
  const istHandy = useIstHandy()

  const [gespeichert] = useState(ladeFilter)
  const [suche, setSuche] = useState(sitzung.suche)
  const [filterTyp, setFilterTyp] = useState<MediaType | 'ALLE'>(gespeichert.filterTyp)
  const [filterStatus, setFilterStatus] = useState<EntryStatus[]>(gespeichert.filterStatus)
  const [filterFavorit, setFilterFavorit] = useState(gespeichert.filterFavorit)
  const [filterAbo, setFilterAbo] = useState(gespeichert.filterAbo)
  const [filterRegal, setFilterRegal] = useState(gespeichert.filterRegal)
  const [sortierung, setSortierung] = useState<SortOption>(gespeichert.sortierung)
  const [sortRichtung, setSortRichtung] = useState<SortRichtung>(gespeichert.sortRichtung)
  const [neueFilter, setNeueFilter] = useState<FilterWerte>({
    filterGenres: gespeichert.filterGenres, filterMinBewertung: gespeichert.filterMinBewertung, filterOhneBewertung: gespeichert.filterOhneBewertung,
    filterSpitzname: gespeichert.filterSpitzname, filterLaenge: gespeichert.filterLaenge, filterOhneAnilist: gespeichert.filterOhneAnilist,
  })
  const aendereNeueFilter = (teil: Partial<FilterWerte>) => setNeueFilter(f => ({ ...f, ...teil }))
  const waehleSortierung = (s: SortOption) => { setSortierung(s); setSortRichtung(STANDARD_RICHTUNG[s]) }
  const richtungUmschalten = () => setSortRichtung(r => (r === 'auf' ? 'ab' : 'auf'))
  const [aktiveListe, setAktiveListe] = useState<number | null>(gespeichert.aktiveListe)
  const [ansichten, setAnsichten] = useState<Ansichten>(ladeAnsichten)
  const ansicht: Ansicht = ansichten[ansichtKey(aktiveListe)] ?? (istHandy ? 'liste' : 'kacheln')
  const [verwaltenModus, setVerwaltenModus] = useState(false)
  // Mehrfachauswahl: Modus, gewählte IDs und der zuletzt angeklickte Eintrag (Anker für Umschalt+Klick)
  const [auswahlModus, setAuswahlModus] = useState(false)
  const [auswahl, setAuswahl] = useState<Set<number>>(new Set())
  const [auswahlLaeuft, setAuswahlLaeuft] = useState(false)
  const anker = useRef<number | null>(null)
  const [vergroessert, setVergroessert] = useState<Entry | null>(null)
  const [filterOffen, setFilterOffen] = useState(false)

  const [listen, setListen] = useState<CustomList[]>([])
  const [neuerName, setNeuerName] = useState('')
  const [neuEingabeOffen, setNeuEingabeOffen] = useState(false)
  const [umbenennen, setUmbenennen] = useState<{ id: number; name: string } | null>(null)
  const neuInputRef = useRef<HTMLInputElement>(null)
  const sucheRef = useRef<HTMLInputElement>(null)
  const inhaltRef = useRef<HTMLDivElement>(null)

  const ladeListen = useCallback(async () => {
    const l = await api.getLists()
    setListen(l)
    // Gemerkte Liste wurde inzwischen gelöscht → zurück auf „Alle"
    setAktiveListe(aktiv => (aktiv !== null && !l.some(x => x.id === aktiv) ? null : aktiv))
  }, [])

  useEffect(() => { ladeListen() }, [ladeListen])

  // Serien-Abgleich hat Status/Folgen geändert → Liste still neu laden
  useEffect(() => api.onSerienAktualisiert(() => stillAktualisieren()), [stillAktualisieren])
  // +1, Löschen, Rückgängig … → still neu laden (Scrollposition bleibt)
  useBeiAenderung(useCallback(() => { stillAktualisieren(); ladeListen() }, [stillAktualisieren, ladeListen]))

  useEffect(() => {
    speichereFilter({ filterTyp, filterStatus, filterFavorit, filterAbo, filterRegal, sortierung, sortRichtung, aktiveListe, ...neueFilter })
  }, [filterTyp, filterStatus, filterFavorit, filterAbo, filterRegal, sortierung, sortRichtung, aktiveListe, neueFilter])

  async function aboUmschalten(entry: Entry) {
    await api.setAbo(entry.id, !entry.abonniert)
    await stillAktualisieren()
  }

  useEffect(() => { sitzung.suche = suche }, [suche])

  // Tastenkürzel: Strg+F oder / = Suche, Esc im Suchfeld = leeren
  useTasten(e => {
    if (auswahlModus && !overlayOffen() && !istTippen(e)) {
      if (e.key === 'Escape') { auswahlBeenden(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); alleWaehlen(); return }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      sucheRef.current?.focus()
      sucheRef.current?.select()
    } else if (e.key === 'Escape' && e.target === sucheRef.current && !overlayOffen()) {
      if (suche) setSuche(''); else sucheRef.current?.blur()
    } else if (e.key === '/' && !istTippen(e) && !overlayOffen()) {
      e.preventDefault()
      sucheRef.current?.focus()
    }
  })

  // Jede Liste hat ihre eigene Ansicht
  function waehleAnsicht(a: Ansicht) {
    const neu = { ...ansichten, [ansichtKey(aktiveListe)]: a }
    setAnsichten(neu)
    speichereAnsichten(neu)
    setzeAnsichtGlobal(a) // gilt auch für die Titelgröße auf Einpflegen, News und Statistik
  }

  // Scrollposition wiederherstellen, sobald die Einträge gerendert sind
  useLayoutEffect(() => {
    if (!laden && inhaltRef.current) inhaltRef.current.scrollTop = sitzung.scrollPosition
  }, [laden])

  const anzahlFilter = (filterTyp !== STANDARD_FILTER.filterTyp ? 1 : 0) + (filterStatus.length > 0 ? 1 : 0) +
    (filterFavorit ? 1 : 0) + (filterAbo ? 1 : 0) + (filterRegal ? 1 : 0) + anzahlNeueFilter(neueFilter)
  const filterAktiv = suche !== '' || anzahlFilter > 0

  function filterZuruecksetzen() {
    setSuche('')
    setFilterTyp(STANDARD_FILTER.filterTyp)
    setFilterStatus([])
    setFilterFavorit(false)
    setFilterAbo(false)
    setFilterRegal(false)
    setNeueFilter({ ...STANDARD_NEUE_FILTER })
  }

  useEffect(() => {
    if (neuEingabeOffen) setTimeout(() => neuInputRef.current?.focus(), 50)
  }, [neuEingabeOffen])

  // Verwalten-Modus nur bei custom Liste sinnvoll
  useEffect(() => {
    if (aktiveListe === null) setVerwaltenModus(false)
    setUmbenennen(null)
  }, [aktiveListe])
  useEffect(() => { if (verwaltenModus) auswahlBeenden() }, [verwaltenModus])

  async function erstelleListe() {
    const name = neuerName.trim()
    if (!name) return
    await api.createList(name)
    setNeuerName('')
    setNeuEingabeOffen(false)
    await ladeListen()
  }

  async function benenneUm() {
    if (!umbenennen) return
    const name = umbenennen.name.trim()
    if (name) await api.renameList(umbenennen.id, name)
    setUmbenennen(null)
    await ladeListen()
  }

  async function loescheListe(liste: CustomList) {
    const ja = await bestaetigen(`Liste „${liste.name}" löschen?`, {
      text: 'Die Einträge selbst bleiben erhalten – nur die Liste wird entfernt.', ok: 'Löschen', gefahr: true,
    })
    if (!ja) return
    await api.deleteList(liste.id)
    if (aktiveListe === liste.id) setAktiveListe(null)
    await ladeListen()
  }

  async function toggleEintragInListe(entryId: number) {
    if (aktiveListe === null) return
    const liste = listen.find(l => l.id === aktiveListe)
    const istDrin = (liste?.entries ?? []).some(e => e.entry_id === entryId)
    if (istDrin) {
      await api.removeFromList(aktiveListe, entryId)
    } else {
      await api.addToList(aktiveListe, entryId)
    }
    await ladeListen()
  }

  const aktivListeIds = aktiveListe !== null
    ? new Set((listen.find(l => l.id === aktiveListe)?.entries ?? []).map(e => e.entry_id))
    : null

  // Alle Filter außer Status (Basis für die Anzahl je Status im Dropdown).
  // Im Verwalten-Modus: alle Einträge zeigen (ungefiltert nach Liste)
  const ohneStatusFilter = entries.filter(e => {
    if (!verwaltenModus && aktivListeIds !== null && !aktivListeIds.has(e.id)) return false
    if (suche) {
      const q = suche.toLowerCase()
      // Spitzname, Originaltitel, Anzeigetitel und alle bekannten Titel (englisch/japanisch) – egal welche Sprache eingestellt ist
      const treffer = e.title.toLowerCase().includes(q) || (e.nickname ?? '').toLowerCase().includes(q) ||
        anzeigeTitel(e).toLowerCase().includes(q) || (e.titel_alle ?? '').includes(q)
      if (!treffer) return false
    }
    if (filterTyp !== 'ALLE' && e.type !== filterTyp) return false
    if (filterFavorit && !e.is_favorite) return false
    if (filterAbo && !e.abonniert) return false
    if (filterRegal && anzahlBaende(e.baende_besitz) === 0) return false
    if (!passtZuNeuenFiltern(e, neueFilter)) return false
    return true
  })
  const anzahlJeStatus: Record<string, number> = {}
  for (const e of ohneStatusFilter) anzahlJeStatus[e.status] = (anzahlJeStatus[e.status] ?? 0) + 1

  const gefiltert = sortiere(
    ohneStatusFilter.filter(e => filterStatus.length === 0 || filterStatus.includes(e.status)),
    sortierung, sortRichtung, anzeigeTitel)
  const genreListe = alleGenres(entries)

  // 🏆 schaltet einfach den Status-Filter auf „Beendet" (und zurück) – so bleiben beide im Einklang
  const nurBeendete = filterStatus.length === 1 && filterStatus[0] === 'completed'
  // Zählt passend zum Typ-Filter (ALLE/ANIME/MANGA), aber unabhängig vom Status-Filter, den 🏆 ja umschaltet
  const anzahlBeendet = entries.filter(e => e.status === 'completed' && (filterTyp === 'ALLE' || e.type === filterTyp)).length
  // 📚 Im Regal: Manga mit mindestens einem besessenen Band (Zahl passend zum Typ-Filter)
  const anzahlImRegal = entries.filter(e => e.type === 'MANGA' && anzahlBaende(e.baende_besitz) > 0 && (filterTyp === 'ALLE' || e.type === filterTyp)).length
  const sammlungKnopf = filterTyp === 'MANGA' && (
    <button className="filter-btn sammlung-link" onClick={() => navigate('/sammlung')}>📚 Sammlung</button>
  )
  const beendeteUmschalten = () => setFilterStatus(nurBeendete ? [] : ['completed'])

  function oeffneEintrag(id: number) {
    sitzung.blaetterIds = gefiltert.map(e => e.id)
    navigate(`/detail/${id}`)
  }

  // ── Mehrfachauswahl ──
  // Es zählt nur, was gerade sichtbar ist: ein Filter, der Einträge ausblendet, nimmt sie auch aus der Auswahl
  const sichtbarAusgewaehlt = gefiltert.filter(e => auswahl.has(e.id))
  function auswahlBeenden() { setAuswahlModus(false); setAuswahl(new Set()); anker.current = null }
  function auswahlStarten(id?: number) {
    setVerwaltenModus(false)
    setAuswahlModus(true)
    if (id !== undefined) { setAuswahl(new Set([id])); anker.current = id }
  }
  function alleWaehlen() { setAuswahl(new Set(gefiltert.map(e => e.id))) }
  function umschaltenAuswahl(id: number, modus: 'einzeln' | 'bereich' = 'einzeln') {
    setAuswahl(alt => {
      const neu = new Set(alt)
      if (modus === 'bereich' && anker.current !== null) {
        const a = gefiltert.findIndex(e => e.id === anker.current), b = gefiltert.findIndex(e => e.id === id)
        if (a >= 0 && b >= 0) {
          for (const e of gefiltert.slice(Math.min(a, b), Math.max(a, b) + 1)) neu.add(e.id)
          return neu
        }
      }
      if (neu.has(id)) neu.delete(id); else neu.add(id)
      return neu
    })
    if (modus === 'einzeln') anker.current = id
  }
  // Klick auf eine Karte: in der Auswahl umschalten; am Laptop starten Strg/Umschalt+Klick die Auswahl
  function karteGeklickt(entry: Entry, e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    if (!auswahlModus && e && (e.ctrlKey || e.metaKey || e.shiftKey) && !istHandy) {
      auswahlStarten(entry.id)
      return
    }
    if (auswahlModus) umschaltenAuswahl(entry.id, e?.shiftKey ? 'bereich' : 'einzeln')
    else oeffneEintrag(entry.id)
  }

  async function fuehreAuswahlAus(aktion: MehrfachAktion) {
    const ids = sichtbarAusgewaehlt.map(e => e.id)
    if (ids.length === 0 || auswahlLaeuft) return
    const n = ids.length
    const eintraege = n === 1 ? '1 Eintrag' : `${n} Einträge`
    if (aktion.art === 'loeschen') {
      const ja = await bestaetigen(`${eintraege} löschen – sicher?`, {
        text: 'Fortschritt, Watch-Order und Listen-Zuordnung werden entfernt. Direkt danach kannst du es noch rückgängig machen.',
        ok: 'Löschen', gefahr: true,
      })
      if (!ja) return
    } else if (aktion.art === 'status' && aktion.status === 'completed') {
      const ja = await bestaetigen(`${eintraege} auf „Beendet“ setzen?`, {
        text: 'Wie bei jedem einzelnen Eintrag wird der Fortschritt auf das Maximum aufgefüllt, wo die Gesamtzahl bekannt ist. Das lässt sich rückgängig machen.',
        ok: 'Beendet',
      })
      if (!ja) return
    }
    setAuswahlLaeuft(true)
    try {
      const r = await api.mehrere(ids, aktion)
      if (!r.success) { snackbar(r.fehler ?? 'Das hat nicht geklappt.'); return }
      if (aktion.art === 'loeschen') setAuswahl(new Set())
      meldeAenderung()
      const wort = r.geaendert === 1 ? '1 Eintrag' : `${r.geaendert} Einträge`
      const rest = r.uebersprungen > 0 ? ` (${r.uebersprungen} ${aktion.art === 'abo' ? 'übersprungen – nur Anime oder schon so' : 'schon so'})` : ''
      const text = r.geaendert === 0 ? `Nichts zu ändern${rest}`
        : aktion.art === 'loeschen' ? `${wort} gelöscht`
        : aktion.art === 'status' ? `${wort}: Status „${STATUS_NAME[aktion.status]}“ ✓${rest}`
        : aktion.art === 'favorit' ? `${wort}: Favorit ${aktion.wert ? 'gesetzt' : 'entfernt'} ✓${rest}`
        : aktion.art === 'abo' ? `${wort}: Abo ${aktion.wert ? 'an' : 'aus'} ✓${rest}`
        : `${wort} ${aktion.hinzu ? 'zur Liste hinzugefügt' : 'aus der Liste entfernt'} ✓${rest}`
      snackbar(text, r.token ? {
        label: 'Rückgängig',
        ausfuehren: async () => { await api.rueckgaengig(r.token!); meldeAenderung() },
      } : undefined, aktion.art === 'loeschen' ? 10000 : 7000)
    } finally {
      setAuswahlLaeuft(false)
    }
  }

  const typKnoepfe = (
    <div className="filter-gruppe" role="group" aria-label="Typ">
      {(['ALLE', 'ANIME', 'MANGA'] as const).map(t => (
        <button key={t} className={filterTyp === t ? 'filter-btn active' : 'filter-btn'} aria-pressed={filterTyp === t} onClick={() => setFilterTyp(t)}>
          {t}
        </button>
      ))}
    </div>
  )

  const ansichtKnoepfe = (
    <div className="ansicht-umschalter" role="group" aria-label="Ansicht">
      {ANSICHTEN.map(a => (
        <button
          key={a.key}
          className={ansicht === a.key ? 'ansicht-btn aktiv' : 'ansicht-btn'}
          onClick={() => waehleAnsicht(a.key)}
          title={`${a.label} – gilt auch für Einpflegen, News und Statistik`}
          aria-label={a.label}
          aria-pressed={ansicht === a.key}
        >
          {a.icon}
        </button>
      ))}
    </div>
  )

  return (
    <div className="page">
      <div className="liste-header">
        {/* Suche */}
        <div className="suche-zeile">
          <input
            ref={sucheRef}
            type="search"
            placeholder={istHandy ? '🔍  Suchen…' : '🔍  In Liste suchen…  (Strg+F)'}
            aria-label="In Liste suchen"
            value={suche}
            onChange={e => setSuche(e.target.value)}
            className="liste-suche"
          />
          {istHandy ? (
            <button
              className={anzahlFilter ? 'filter-oeffnen aktiv' : 'filter-oeffnen'}
              onClick={() => setFilterOffen(true)}
              aria-label={`Filter${anzahlFilter ? ` (${anzahlFilter} aktiv)` : ''}`}
            >
              ⚙︎ Filter{anzahlFilter > 0 && <span className="filter-zahl">{anzahlFilter}</span>}
            </button>
          ) : (
            <>
              <button
                className={filterFavorit ? 'favorit-filter aktiv' : 'favorit-filter'}
                onClick={() => setFilterFavorit(!filterFavorit)}
                title="Nur Favoriten"
                aria-label="Nur Favoriten"
                aria-pressed={filterFavorit}
              >
                ⭐
              </button>
              <button
                className={filterAbo ? 'favorit-filter aktiv abo-filter' : 'favorit-filter abo-filter'}
                onClick={() => setFilterAbo(!filterAbo)}
                title={`Nur abonnierte Anime (${entries.filter(e => e.abonniert).length})`}
                aria-label="Nur abonnierte Anime"
                aria-pressed={filterAbo}
              >
                🔔
              </button>
              <button
                className={nurBeendete ? 'beendet-counter aktiv' : 'beendet-counter'}
                onClick={beendeteUmschalten}
                title={nurBeendete ? 'Wieder alle Status anzeigen' : `Beendete Titel anzeigen (${anzahlBeendet})`}
                aria-label={`Beendete Titel anzeigen (${anzahlBeendet})`}
                aria-pressed={nurBeendete}
              >
                🏆 <span>{anzahlBeendet}</span>
              </button>
              <button
                className={filterRegal ? 'beendet-counter regal-filter aktiv' : 'beendet-counter regal-filter'}
                onClick={() => setFilterRegal(!filterRegal)}
                title={filterRegal ? 'Wieder alle anzeigen' : `Manga mit Bänden im Regal anzeigen (${anzahlImRegal})`}
                aria-label={`Im Regal: Manga mit Bänden im Regal anzeigen (${anzahlImRegal})`}
                aria-pressed={filterRegal}
              >
                📚 <span>{anzahlImRegal}</span>
              </button>
            </>
          )}
        </div>

        {/* Benutzerdefinierte Listen */}
        <div className="listen-tabs">
          <button
            className={aktiveListe === null ? 'listen-tab aktiv' : 'listen-tab'}
            onClick={() => setAktiveListe(null)}
          >
            Alle
            <span className="listen-tab-count">{entries.length}</span>
          </button>
          {listen.map(l => (
            <div key={l.id} className="listen-tab-wrap">
              {umbenennen?.id === l.id ? (
                <div className="listen-neu-eingabe">
                  <input
                    autoFocus
                    type="text"
                    aria-label="Neuer Listenname"
                    value={umbenennen.name}
                    onChange={e => setUmbenennen({ id: l.id, name: e.target.value })}
                    onKeyDown={e => {
                      if (e.key === 'Enter') benenneUm()
                      if (e.key === 'Escape') setUmbenennen(null)
                    }}
                    className="listen-neu-input"
                  />
                  <button className="listen-neu-ok" aria-label="Speichern" onClick={benenneUm}>✓</button>
                  <button className="listen-neu-ab" aria-label="Abbrechen" onClick={() => setUmbenennen(null)}>✕</button>
                </div>
              ) : (
                <>
                  <button
                    className={aktiveListe === l.id ? 'listen-tab aktiv' : 'listen-tab'}
                    onClick={() => setAktiveListe(l.id)}
                    onDoubleClick={() => setUmbenennen({ id: l.id, name: l.name })}
                    title="Doppelklick zum Umbenennen"
                  >
                    {l.name}
                    <span className="listen-tab-count">
                      {(l.entries ?? []).length}
                    </span>
                  </button>
                  {aktiveListe === l.id && (
                    <>
                      <button
                        className="listen-tab-del listen-tab-umbenennen"
                        onClick={() => setUmbenennen({ id: l.id, name: l.name })}
                        title="Liste umbenennen"
                        aria-label={`Liste „${l.name}" umbenennen`}
                      >✎</button>
                      <button
                        className="listen-tab-del"
                        onClick={() => loescheListe(l)}
                        title="Liste löschen"
                        aria-label={`Liste „${l.name}" löschen`}
                      >×</button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}

          {/* Neue Liste */}
          {neuEingabeOffen ? (
            <div className="listen-neu-eingabe">
              <input
                ref={neuInputRef}
                type="text"
                placeholder="Listenname…"
                aria-label="Name der neuen Liste"
                value={neuerName}
                onChange={e => setNeuerName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') erstelleListe()
                  if (e.key === 'Escape') { setNeuEingabeOffen(false); setNeuerName('') }
                }}
                className="listen-neu-input"
              />
              <button className="listen-neu-ok" aria-label="Liste anlegen" onClick={erstelleListe}>✓</button>
              <button className="listen-neu-ab" aria-label="Abbrechen" onClick={() => { setNeuEingabeOffen(false); setNeuerName('') }}>✕</button>
            </div>
          ) : (
            <button
              className="listen-tab listen-tab-neu"
              onClick={() => setNeuEingabeOffen(true)}
              title="Neue Liste erstellen"
            >
              + Neu
            </button>
          )}

          <button
            className={auswahlModus ? 'listen-tab listen-tab-auswaehlen aktiv' : 'listen-tab listen-tab-auswaehlen'}
            onClick={() => (auswahlModus ? auswahlBeenden() : auswahlStarten())}
            aria-pressed={auswahlModus}
            title={istHandy ? 'Mehrere Einträge auswählen (oder eine Karte lange drücken)' : 'Mehrere Einträge auswählen (oder Strg/Umschalt + Klick)'}
          >
            {auswahlModus ? '✓ Auswahl beenden' : '☑ Auswählen'}
          </button>

          {/* Verwalten-Modus Button (nur bei aktiver custom Liste) */}
          {aktiveListe !== null && (
            <button
              className={verwaltenModus ? 'listen-tab listen-tab-verwalten aktiv' : 'listen-tab listen-tab-verwalten'}
              onClick={() => setVerwaltenModus(v => !v)}
              title="Einträge hinzufügen / entfernen"
            >
              {verwaltenModus ? '✓ Fertig' : '+ Bearbeiten'}
            </button>
          )}
        </div>

        {/* Filter (am Handy im Filter-Fenster) */}
        {!istHandy && (
          <div className="filter-zeile">
            {typKnoepfe}
            {sammlungKnopf}
            <StatusFilter ausgewaehlt={filterStatus} anzahl={anzahlJeStatus} onAendern={setFilterStatus} />
            <MehrFilter {...neueFilter} genres={genreListe} onAendern={aendereNeueFilter} />
            {filterAktiv && (
              <button className="filter-reset" onClick={filterZuruecksetzen} title="Suche und Filter zurücksetzen">
                ✕ Filter zurücksetzen
              </button>
            )}
            <select
              className="sortierung-select"
              aria-label="Sortierung"
              value={sortierung}
              onChange={e => waehleSortierung(e.target.value as SortOption)}
            >
              {SORTIERUNGEN.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button
              className="richtung-btn"
              onClick={richtungUmschalten}
              title={`${RICHTUNG_TEXT[sortierung][sortRichtung === 'auf' ? 0 : 1]} – Richtung umschalten`}
              aria-label={`Sortierrichtung: ${RICHTUNG_TEXT[sortierung][sortRichtung === 'auf' ? 0 : 1]}. Umschalten`}
            >
              {sortRichtung === 'auf' ? '↑' : '↓'}
            </button>
            {ansichtKnoepfe}
          </div>
        )}
      </div>

      <div
        className="listen-inhalt"
        ref={inhaltRef}
        onScroll={e => { sitzung.scrollPosition = e.currentTarget.scrollTop }}
      >
        {verwaltenModus && aktiveListe !== null && (
          <p className="verwalten-hinweis">
            Klicke auf eine Karte, um sie zur Liste hinzuzufügen oder zu entfernen.
          </p>
        )}

        {/* Weiterschauen/-lesen nur ohne Suche und wenn der Status-Filter Laufende zeigt */}
        {!laden && aktiveListe === null && !verwaltenModus && !auswahlModus && !suche &&
          (filterStatus.length === 0 || filterStatus.includes('ongoing')) && (
          <Weiterschauen onOeffnen={oeffneEintrag} entries={entries} filterTyp={filterTyp} />
        )}

        {laden ? (
          <Ladeindikator />
        ) : gefiltert.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <p>
              {aktiveListe !== null && !verwaltenModus
                ? 'Diese Liste ist leer. Klicke auf „+ Bearbeiten" um Einträge hinzuzufügen.'
                : entries.length === 0
                  ? 'Noch keine Einträge vorhanden.'
                  : 'Keine Einträge gefunden.'
              }
            </p>
            {entries.length > 0 && filterAktiv && (
              <p className="empty-hint">Mit diesen Filtern passt nichts – lockere einen Filter oder setze alle zurück.</p>
            )}
            {entries.length > 0 && filterAktiv && (
              <button className="dialog-btn" onClick={filterZuruecksetzen}>Filter zurücksetzen</button>
            )}
            {entries.length === 0 && <p className="empty-hint">Füge Anime & Manga über „Einpflegen" hinzu.</p>}
          </div>
        ) : (
          <div className={`karten-grid karten-grid--${ansicht}`}>
            {gefiltert.map(entry => {
              if (verwaltenModus && aktiveListe !== null) {
                const istDrin = aktivListeIds?.has(entry.id) ?? false
                return (
                  <div
                    key={entry.id}
                    className={istDrin ? 'karte-verwalten karte-verwalten--drin' : 'karte-verwalten'}
                    onClick={() => toggleEintragInListe(entry.id)}
                  >
                    <EintragKarte entry={entry} ansicht={ansicht} onClick={() => {}} />
                    <div className="karte-verwalten-overlay">
                      {istDrin ? '✓ In Liste' : '+ Hinzufügen'}
                    </div>
                  </div>
                )
              }
              if (auswahlModus) {
                // In der Auswahl keine Knöpfe auf der Karte (nichts aus Versehen auslösen)
                return (
                  <EintragKarte
                    key={entry.id}
                    entry={entry}
                    ansicht={ansicht}
                    auswahlModus
                    ausgewaehlt={auswahl.has(entry.id)}
                    onClick={e => karteGeklickt(entry, e)}
                  />
                )
              }
              return (
                <EintragKarte
                  key={entry.id}
                  entry={entry}
                  ansicht={ansicht}
                  onClick={e => karteGeklickt(entry, e)}
                  onLangDruck={() => auswahlStarten(entry.id)}
                  onVergroessern={() => setVergroessert(entry)}
                  onAboUmschalten={() => aboUmschalten(entry)}
                  onPlusEins={() => aendereFortschritt(entry.id, 1)}
                />
              )
            })}
          </div>
        )}
      </div>

      {auswahlModus && (
        <Auswahlleiste
          anzahl={sichtbarAusgewaehlt.length}
          sichtbar={gefiltert.length}
          listen={listen}
          beschaeftigt={auswahlLaeuft}
          onAktion={fuehreAuswahlAus}
          onAlle={alleWaehlen}
          onKeine={() => setAuswahl(new Set())}
          onFertig={auswahlBeenden}
        />
      )}

      {filterOffen && (
        <BottomSheet
          titel="Filter & Ansicht"
          onSchliessen={() => setFilterOffen(false)}
          fuss={<>
            <button className="dialog-btn" onClick={filterZuruecksetzen} disabled={!filterAktiv}>Zurücksetzen</button>
            <button className="dialog-btn dialog-btn--ok" onClick={() => setFilterOffen(false)}>{gefiltert.length} anzeigen</button>
          </>}
        >
          <div className="sheet-gruppe">
            <span className="sheet-gruppe-titel">Typ</span>
            {typKnoepfe}
            {sammlungKnopf}
          </div>
          <div className="sheet-gruppe">
            <span className="sheet-gruppe-titel">Status</span>
            <StatusFilter variante="chips" ausgewaehlt={filterStatus} anzahl={anzahlJeStatus} onAendern={setFilterStatus} />
          </div>
          <div className="sheet-gruppe">
            <span className="sheet-gruppe-titel">Nur</span>
            <div className="sheet-chips">
              <button className={filterFavorit ? 'filter-btn active' : 'filter-btn'} aria-pressed={filterFavorit} onClick={() => setFilterFavorit(!filterFavorit)}>⭐ Favoriten</button>
              <button className={filterAbo ? 'filter-btn active' : 'filter-btn'} aria-pressed={filterAbo} onClick={() => setFilterAbo(!filterAbo)}>🔔 Abonnierte</button>
              <button className={nurBeendete ? 'filter-btn active' : 'filter-btn'} aria-pressed={nurBeendete} onClick={beendeteUmschalten}>🏆 Beendete</button>
              <button className={filterRegal ? 'filter-btn active' : 'filter-btn'} aria-pressed={filterRegal} onClick={() => setFilterRegal(!filterRegal)}>📚 Im Regal</button>
            </div>
          </div>
          <div className="sheet-gruppe">
            <span className="sheet-gruppe-titel">Weitere Filter</span>
            <MehrFilter variante="chips" {...neueFilter} genres={genreListe} onAendern={aendereNeueFilter} />
          </div>
          <div className="sheet-gruppe">
            <span className="sheet-gruppe-titel">Sortierung</span>
            <div className="sheet-chips">
              {SORTIERUNGEN.map(s => (
                <button key={s.key} className={sortierung === s.key ? 'filter-btn active' : 'filter-btn'} aria-pressed={sortierung === s.key} onClick={() => waehleSortierung(s.key)}>{s.label}</button>
              ))}
            </div>
            <div className="sheet-chips">
              {([['ab', 1], ['auf', 0]] as const).map(([r, i]) => (
                <button key={r} className={sortRichtung === r ? 'filter-btn active' : 'filter-btn'} aria-pressed={sortRichtung === r} onClick={() => setSortRichtung(r)}>
                  {r === 'auf' ? '↑' : '↓'} {RICHTUNG_TEXT[sortierung][i]}
                </button>
              ))}
            </div>
          </div>
          <div className="sheet-gruppe">
            <span className="sheet-gruppe-titel">Ansicht</span>
            {ansichtKnoepfe}
          </div>
        </BottomSheet>
      )}

      {vergroessert?.cover_url && (
        <BildVergroesserung
          url={vergroessert.cover_url}
          alt={anzeigeTitel(vergroessert)}
          onSchliessen={() => setVergroessert(null)}
          bilder={gefiltert.filter(e => e.cover_url).map(e => ({ id: e.id, url: e.cover_url!, titel: e.nickname || anzeigeTitel(e) }))}
          startId={vergroessert.id}
          onOeffnen={id => { setVergroessert(null); oeffneEintrag(id) }}
        />
      )}
    </div>
  )
}
