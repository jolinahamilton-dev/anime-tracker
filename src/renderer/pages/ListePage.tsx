import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEntries } from '../hooks/useEntries'
import { Entry, EntryStatus, MediaType } from '../../types'
import EintragKarte from '../components/EintragKarte'
import BildVergroesserung from '../components/BildVergroesserung'
import StatusFilter from '../components/StatusFilter'
import Ladeindikator from '../components/Ladeindikator'
import Weiterschauen from '../components/Weiterschauen'
import BottomSheet from '../components/BottomSheet'
import {
  Ansicht, Ansichten, SortOption, STANDARD_FILTER,
  ladeFilter, speichereFilter, ansichtKey, ladeAnsichten, speichereAnsichten, sitzung,
} from '../listenZustand'
import { api, CustomListMitEintraegen as CustomList } from '../api'
import { aendereFortschritt, useBeiAenderung } from '../aktionen'
import { bestaetigen } from '../meldungen'
import { istTippen, overlayOffen, useIstHandy, useTasten } from '../tastatur'
import './Page.css'
import './ListePage.css'

const ANSICHTEN: Array<{ key: Ansicht; icon: string; label: string }> = [
  { key: 'liste', icon: '☰', label: 'Liste' },
  { key: 'kacheln', icon: '▦', label: 'Kacheln' },
  { key: 'gross', icon: '⬛', label: 'Große Symbole' },
]

const SORTIERUNGEN: Array<{ key: SortOption; label: string }> = [
  { key: 'zuletzt', label: 'Zuletzt bearbeitet' },
  { key: 'alphabetisch', label: 'Alphabetisch' },
  { key: 'bewertung', label: 'Bewertung' },
]

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
  const [sortierung, setSortierung] = useState<SortOption>(gespeichert.sortierung)
  const [aktiveListe, setAktiveListe] = useState<number | null>(gespeichert.aktiveListe)
  const [ansichten, setAnsichten] = useState<Ansichten>(ladeAnsichten)
  const ansicht: Ansicht = ansichten[ansichtKey(aktiveListe)] ?? (istHandy ? 'liste' : 'kacheln')
  const [verwaltenModus, setVerwaltenModus] = useState(false)
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
    speichereFilter({ filterTyp, filterStatus, filterFavorit, filterAbo, sortierung, aktiveListe })
  }, [filterTyp, filterStatus, filterFavorit, filterAbo, sortierung, aktiveListe])

  async function aboUmschalten(entry: Entry) {
    await api.setAbo(entry.id, !entry.abonniert)
    await stillAktualisieren()
  }

  useEffect(() => { sitzung.suche = suche }, [suche])

  // Tastenkürzel: Strg+F oder / = Suche, Esc im Suchfeld = leeren
  useTasten(e => {
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
  }

  // Scrollposition wiederherstellen, sobald die Einträge gerendert sind
  useLayoutEffect(() => {
    if (!laden && inhaltRef.current) inhaltRef.current.scrollTop = sitzung.scrollPosition
  }, [laden])

  const anzahlFilter = (filterTyp !== STANDARD_FILTER.filterTyp ? 1 : 0) + (filterStatus.length > 0 ? 1 : 0) +
    (filterFavorit ? 1 : 0) + (filterAbo ? 1 : 0)
  const filterAktiv = suche !== '' || anzahlFilter > 0

  function filterZuruecksetzen() {
    setSuche('')
    setFilterTyp(STANDARD_FILTER.filterTyp)
    setFilterStatus([])
    setFilterFavorit(false)
    setFilterAbo(false)
  }

  useEffect(() => {
    if (neuEingabeOffen) setTimeout(() => neuInputRef.current?.focus(), 50)
  }, [neuEingabeOffen])

  // Verwalten-Modus nur bei custom Liste sinnvoll
  useEffect(() => {
    if (aktiveListe === null) setVerwaltenModus(false)
    setUmbenennen(null)
  }, [aktiveListe])

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
      const treffer = e.title.toLowerCase().includes(q) || (e.nickname ?? '').toLowerCase().includes(q)
      if (!treffer) return false
    }
    if (filterTyp !== 'ALLE' && e.type !== filterTyp) return false
    if (filterFavorit && !e.is_favorite) return false
    if (filterAbo && !e.abonniert) return false
    return true
  })
  const anzahlJeStatus: Record<string, number> = {}
  for (const e of ohneStatusFilter) anzahlJeStatus[e.status] = (anzahlJeStatus[e.status] ?? 0) + 1

  const gefiltert = ohneStatusFilter
    .filter(e => filterStatus.length === 0 || filterStatus.includes(e.status))
    .sort((a, b) => {
      if (sortierung === 'alphabetisch') return a.title.localeCompare(b.title)
      if (sortierung === 'bewertung') return (b.rating ?? 0) - (a.rating ?? 0)
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })

  function oeffneEintrag(id: number) {
    sitzung.blaetterIds = gefiltert.map(e => e.id)
    navigate(`/detail/${id}`)
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
          title={a.label}
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
              <div className="beendet-counter" title="Beendete Titel">
                🏆 <span>{entries.filter(e => e.status === 'completed').length}</span>
              </div>
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
            <StatusFilter ausgewaehlt={filterStatus} anzahl={anzahlJeStatus} onAendern={setFilterStatus} />
            {filterAktiv && (
              <button className="filter-reset" onClick={filterZuruecksetzen} title="Suche und Filter zurücksetzen">
                ✕ Filter zurücksetzen
              </button>
            )}
            <select
              className="sortierung-select"
              aria-label="Sortierung"
              value={sortierung}
              onChange={e => setSortierung(e.target.value as SortOption)}
            >
              {SORTIERUNGEN.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
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

        {!laden && aktiveListe === null && !verwaltenModus && !suche && <Weiterschauen onOeffnen={id => navigate(`/detail/${id}`)} />}

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
              return (
                <EintragKarte
                  key={entry.id}
                  entry={entry}
                  ansicht={ansicht}
                  onClick={() => oeffneEintrag(entry.id)}
                  onVergroessern={() => setVergroessert(entry)}
                  onAboUmschalten={() => aboUmschalten(entry)}
                  onPlusEins={() => aendereFortschritt(entry.id, 1)}
                />
              )
            })}
          </div>
        )}
      </div>

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
            </div>
          </div>
          <div className="sheet-gruppe">
            <span className="sheet-gruppe-titel">Sortierung</span>
            <div className="sheet-chips">
              {SORTIERUNGEN.map(s => (
                <button key={s.key} className={sortierung === s.key ? 'filter-btn active' : 'filter-btn'} aria-pressed={sortierung === s.key} onClick={() => setSortierung(s.key)}>{s.label}</button>
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
          alt={vergroessert.title}
          onSchliessen={() => setVergroessert(null)}
        />
      )}
    </div>
  )
}
