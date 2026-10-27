import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Entry, EntryStatus } from '../../types'
import Sterne from '../components/Sterne'
import WatchOrder, { WatchItem, istNeueStaffel } from '../components/WatchOrder'
import BildVergroesserung from '../components/BildVergroesserung'
import { sitzung } from '../listenZustand'
import './Page.css'
import './DetailPage.css'
import { api } from '../api'
import { aendereFortschritt, loescheEintrag, useBeiAenderung } from '../aktionen'
import { hinweis } from '../meldungen'
import { istTippen, overlayOffen, useTasten, useWischen } from '../tastatur'

const RELEVANTE_RELATIONEN = new Set(['MAIN', 'PREQUEL', 'SEQUEL', 'SIDE_STORY', 'SPIN_OFF', 'PARENT', 'ALTERNATIVE'])

function itemStatusAus(status: EntryStatus): WatchItem['item_status'] {
  return status === 'completed' ? 'completed' : status === 'started' || status === 'ongoing' ? 'started' : 'planned'
}

// Holt die Staffeln von AniList; die Hauptstaffel übernimmt Fortschritt/Status des Eintrags
async function holeWatchOrder(e: Entry): Promise<WatchItem[]> {
  let relationen: WatchItem[]
  try {
    relationen = await api.getAniListRelations(e.anilist_id!)
  } catch {
    return [] // AniList nicht erreichbar – Aufrufer behandeln leere Liste
  }
  const gesehen = new Set<number>()
  return relationen
    .filter(r => RELEVANTE_RELATIONEN.has(r.relation_type))
    .filter(r => { if (gesehen.has(r.related_anilist_id)) return false; gesehen.add(r.related_anilist_id); return true })
    .map(r => r.relation_type === 'MAIN'
      ? { ...r,
          // total_episodes aus DB nehmen falls AniList null liefert (z.B. Split-Cour)
          total_episodes: r.total_episodes ?? e.total_episodes ?? null,
          progress_episodes: e.progress_episodes,
          item_status: itemStatusAus(e.status),
        }
      : r)
}

interface CustomList {
  id: number
  name: string
  entries?: Array<{ entry_id: number }>
}

const STATUS_LABEL: Record<EntryStatus, string> = {
  planned: 'Geplant',
  started: 'Angefangen',
  ongoing: 'Laufend',
  completed: 'Beendet',
  paused: 'Pausiert',
  dropped: 'Abgebrochen',
}

export default function DetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const entryId = Number(id)

  const [entry, setEntry] = useState<Entry | null>(null)
  const [rezension, setRezension] = useState('')
  const [rezBearbeiten, setRezBearbeiten] = useState(false)
  const [nickname, setNickname] = useState('')
  const [nickBearbeiten, setNickBearbeiten] = useState(false)
  const [watchItems, setWatchItems] = useState<WatchItem[]>([])
  const [listen, setListen] = useState<CustomList[]>([])
  const [listenOffen, setListenOffen] = useState(false)
  const [alleIds, setAlleIds] = useState<number[]>([])

  const [coverGross, setCoverGross] = useState(false)

  const ladeNeu = useCallback(async () => {
    const e = await api.getEntry(entryId)
    if (!e) return // gerade gelöscht
    setEntry(e)
    const items: WatchItem[] = await api.getWatchOrder(entryId)
    setWatchItems([...items].sort((a, b) => a.position - b.position))
  }, [entryId])

  // Hintergrund-Abgleich hat diesen Eintrag geändert (neue Folge/Staffel, Status) → neu laden,
  // damit ein späteres Speichern nicht den alten Stand zurückschreibt
  useEffect(() => api.onSerienAktualisiert((d: { geaendert: number[] }) => {
    if (d.geaendert.includes(entryId)) ladeNeu()
  }), [entryId, ladeNeu])
  // +1/−1 per Taste, Rückgängig aus der Snackbar
  useBeiAenderung(ladeNeu)

  // Pfeile blättern durch die zuletzt gefilterte Liste; ohne (z. B. aus der Statistik) durch alle
  useEffect(() => {
    if (sitzung.blaetterIds?.includes(entryId)) {
      setAlleIds(sitzung.blaetterIds)
      return
    }
    api.getEntries().then((all: Entry[]) => {
      setAlleIds(all.map((e: Entry) => e.id))
    })
  }, [entryId])

  useEffect(() => {
    if (!id) return
    ;(async () => {
      const e: Entry = await api.getEntry(entryId)
      setEntry(e)
      setRezension(e.review ?? '')
      setNickname(e.nickname ?? '')
      api.getLists().then(setListen)

      const items: WatchItem[] = await api.getWatchOrder(entryId)
      const sorted = [...items].sort((a, b) => a.position - b.position)

      if (sorted.length === 0 && e.anilist_id && e.type === 'ANIME') {
        // Watch-Order noch nie generiert → hier holen und speichern
        const gefiltert = await holeWatchOrder(e)
        setWatchItems(gefiltert)
        if (gefiltert.length > 0) {
          await api.saveWatchOrder(entryId, gefiltert)
        }
      } else if (sorted.length > 0 && e.anilist_id && !sorted.some(it => it.relation_type === 'MAIN')) {
        // Alte DB-Einträge ohne MAIN-Eintrag reparieren
        const main: WatchItem = {
          related_anilist_id: e.anilist_id,
          relation_type: 'MAIN',
          title: e.title,
          total_episodes: e.total_episodes ?? null,
          progress_episodes: e.progress_episodes,
          item_status: itemStatusAus(e.status),
          position: 0,
        }
        const repaired = [main, ...sorted.map((it, i) => ({ ...it, position: i + 1 }))]
        setWatchItems(repaired)
        await api.saveWatchOrder(entryId, repaired)
      } else {
        setWatchItems(sorted)
      }
    })()
  }, [id])

  const aktuellerIdx = alleIds.indexOf(entryId)
  const vorherige = aktuellerIdx > 0 ? alleIds[aktuellerIdx - 1] : null
  const naechste = aktuellerIdx >= 0 && aktuellerIdx < alleIds.length - 1 ? alleIds[aktuellerIdx + 1] : null
  const blaettern = (ziel: number | null) => { if (ziel !== null) navigate(`/detail/${ziel}`) }

  // Tastenkürzel: ← → blättern, + − Fortschritt, Esc zurück zur Liste
  useTasten(e => {
    if (istTippen(e) || overlayOffen() || e.ctrlKey || e.metaKey || e.altKey || !entry) return
    if (e.key === 'ArrowLeft') blaettern(vorherige)
    else if (e.key === 'ArrowRight') blaettern(naechste)
    else if (e.key === '+' || e.key === 'Add') aendereFortschritt(entryId, 1)
    else if (e.key === '-' || e.key === 'Subtract') aendereFortschritt(entryId, -1)
    else if (e.key === 'Escape') navigate('/')
    else return
    e.preventDefault()
  })
  // Am Handy: nach links/rechts wischen = blättern
  const wischen = useWischen(() => blaettern(naechste), () => blaettern(vorherige))

  if (!entry) return <div className="page"><div className="empty-state"><p>Wird geladen…</p></div></div>

  const isAnime = entry.type === 'ANIME'
  let genres: string[] = []
  try { genres = JSON.parse(entry.genres || '[]') } catch { genres = [] }

  async function update(data: Partial<Entry>) {
    const updated = await api.updateEntry(entry!.id, data)
    setEntry(updated)

    // Bei „Beendet" auch alle Staffel-Counter auf Maximum setzen –
    // Staffeln mit unbekannter Folgenzahl (total_episodes null, z.B. noch laufend
    // bei AniList) werden NICHT als „completed" markiert, da der Fortschritt sonst
    // fälschlich als fertig erscheint, ohne dass die Folgenzahl angepasst wurde
    if (data.status === 'completed' && watchItems.length > 0) {
      await speichereWatchItems(watchItems.map(item => {
        // Läuft noch: nur bis zur zuletzt ausgestrahlten Folge – sonst gälten künftige
        // Folgen als geschaut und der Abgleich könnte nichts Neues mehr erkennen
        if (item.media_status === 'RELEASING' && item.aired_episodes != null) {
          return { ...item, progress_episodes: Math.max(item.progress_episodes, item.aired_episodes), item_status: 'started' as const }
        }
        return item.total_episodes != null
          ? { ...item, progress_episodes: item.total_episodes, item_status: 'completed' as const }
          : item
      }))
    }
  }

  // Einzige Stelle, die die Watch-Order speichert (Fortschritt-Sektion UND Watch-Order-Sektion)
  async function speichereWatchItems(neu: WatchItem[]) {
    const mitPosition = neu.map((it, i) => ({ ...it, position: i }))
    setWatchItems(mitPosition)
    const antwort = await api.saveWatchOrder(entryId, mitPosition)
    // Gespeicherten Stand übernehmen (enthält ggf. vom Abgleich ergänzte Staffeln/Folgenzahlen)
    if (antwort?.items) setWatchItems(antwort.items)
    // Automatisch auf „Ongoing" gesetzt und jetzt alles geschaut → App hat zurück auf „Beendet" gestellt
    const zurueckAuf = antwort?.status
    if (zurueckAuf) setEntry(e => e ? { ...e, status: zurueckAuf } : e)
    // Hauptstaffel mit entry.progress_episodes synchron halten, damit die Listenkarte
    // stimmt – über den Typ, nicht die Position (Reihenfolge ist per Drag änderbar)
    const main = mitPosition.find(it => it.relation_type === 'MAIN')
    if (main && main.progress_episodes !== entry!.progress_episodes) {
      await api.updateEntry(entry!.id, { progress_episodes: main.progress_episodes })
      setEntry(e => e ? { ...e, progress_episodes: main.progress_episodes } : e)
    }
  }

  async function resetWatchOrder() {
    // Erst neu holen – nur ersetzen, wenn AniList auch etwas geliefert hat
    const vonAniList = await holeWatchOrder(entry!)
    if (vonAniList.length === 0) {
      await hinweis('AniList ist gerade nicht erreichbar', 'Die Watch-Order bleibt unverändert.')
      return
    }
    // Reset = nur die Reihenfolge neu berechnen. Fortschritt, Status und Abgleich-Daten
    // vorhandener Staffeln bleiben; vom Abgleich ergänzte Staffeln (z. B. S3 über die Kette)
    // kommen ans Ende statt zu verschwinden.
    const vorhanden = new Map(watchItems.map(w => [w.related_anilist_id, w]))
    const neu = vonAniList.map(r => {
      const alt = vorhanden.get(r.related_anilist_id)
      return alt ? { ...r, progress_episodes: alt.progress_episodes, item_status: alt.item_status,
        aired_episodes: alt.aired_episodes, media_status: alt.media_status, neu_seit: alt.neu_seit } : r
    })
    const ids = new Set(neu.map(r => r.related_anilist_id))
    await speichereWatchItems([...neu, ...watchItems.filter(w => !ids.has(w.related_anilist_id))].map(w => ({ ...w, is_custom: 0 })))
  }

  async function aendereProgress(feld: string, wert: number) {
    await update({ [feld]: Math.max(0, wert) } as any)
  }

  async function speichereRezension() {
    await update({ review: rezension })
    setRezBearbeiten(false)
  }

  async function speichereNickname() {
    await update({ nickname: nickname.trim() || null } as any)
    setNickBearbeiten(false)
  }

  async function loeschen() {
    if (await loescheEintrag(entry!.id, entry!.title)) navigate('/')
  }

  // Zahlenfeld erst beim Verlassen/Enter speichern, nicht bei jedem Tastendruck
  const zahlenFeld = (wert: number, speichern: (n: number) => void, max?: number | null) => (
    <input
      type="number"
      inputMode="numeric"
      className="zaehler-input"
      key={wert}
      defaultValue={wert}
      min={0}
      max={max || undefined}
      onBlur={e => { const n = Number(e.target.value); if (!Number.isNaN(n) && n !== wert) speichern(n) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )

  // Watch-Item-Progress direkt aus Fortschritt-Sektion bearbeiten
  async function updateWatchItemProgress(idx: number, progress: number) {
    const clamped = Math.max(0, progress)
    await speichereWatchItems(watchItems.map((item, i) => {
      if (i !== idx) return item
      // Bis zur letzten Folge gezählt → „fertig" (Rahmen); unter das Maximum verringert → nicht mehr
      // „fertig" (sonst setzt der Speicher-Handler den Fortschritt wieder auf das Maximum zurück)
      const total = item.total_episodes
      const status: WatchItem['item_status'] = total && clamped >= total ? 'completed'
        : item.item_status === 'completed' && total != null ? 'started'
        : item.item_status === 'planned' && clamped > 0 ? 'started'
        : item.item_status
      return { ...item, progress_episodes: clamped, item_status: status }
    }))
  }

  // Listen-Zugehörigkeit togglen
  async function toggleListe(listeId: number, istDrin: boolean) {
    if (istDrin) {
      await api.removeFromList(listeId, entryId)
    } else {
      await api.addToList(listeId, entryId)
    }
    const aktualisiert: CustomList[] = await api.getLists()
    setListen(aktualisiert)
  }

  const entryListenIds = new Set(
    listen.filter(l => (l.entries ?? []).some(e => e.entry_id === entryId)).map(l => l.id)
  )

  return (
    <div className="page detail-seite" {...wischen}>
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate('/')}>← Zurück</button>
        <div className="detail-nav">
          <button
            className="detail-nav-btn"
            onClick={() => vorherige && navigate(`/detail/${vorherige}`)}
            disabled={vorherige === null}
            title="Vorheriger Eintrag (←)"
            aria-label="Vorheriger Eintrag"
          >‹</button>
          {aktuellerIdx >= 0 && <span className="detail-nav-pos">{aktuellerIdx + 1} / {alleIds.length}</span>}
          <button
            className="detail-nav-btn"
            onClick={() => naechste && navigate(`/detail/${naechste}`)}
            disabled={naechste === null}
            title="Nächster Eintrag (→)"
            aria-label="Nächster Eintrag"
          >›</button>
        </div>
        <button className="loeschen-btn" onClick={loeschen} aria-label="Eintrag löschen">🗑<span className="loeschen-text"> Löschen</span></button>
      </div>

      <div className="detail-inhalt">
        {/* Hero */}
        <div className="detail-hero">
          {entry.cover_url ? (
            <img
              src={entry.cover_url}
              alt={entry.title}
              className="detail-cover detail-cover--zoombar"
              onClick={() => setCoverGross(true)}
              title="Bild vergrößern"
            />
          ) : (
            <div className="detail-cover detail-cover--placeholder">
              {isAnime ? '🎬' : '📚'}
            </div>
          )}
          <div className="detail-meta">
            <span className={`ergebnis-typ typ-${entry.type.toLowerCase()}`}>{entry.type}</span>
            <h2 className="detail-titel">{entry.title}</h2>
            {nickBearbeiten ? (
              <div className="nickname-edit">
                <input
                  type="text"
                  className="nickname-input"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  placeholder="Spitzname…"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') speichereNickname(); if (e.key === 'Escape') { setNickname(entry.nickname ?? ''); setNickBearbeiten(false) } }}
                />
                <button className="listen-neu-ok" onClick={speichereNickname}>✓</button>
                <button className="listen-neu-ab" onClick={() => { setNickname(entry.nickname ?? ''); setNickBearbeiten(false) }}>✕</button>
              </div>
            ) : (
              <button className="nickname-anzeige" onClick={() => setNickBearbeiten(true)}>
                {entry.nickname ? `„${entry.nickname}"` : '+ Spitzname hinzufügen'}
              </button>
            )}
            {genres.length > 0 && (
              <div className="ergebnis-genres">
                {genres.map(g => <span key={g} className="genre-tag">{g}</span>)}
              </div>
            )}
            <div className="detail-aktionen">
              <button
                className={entry.is_favorite ? 'favorit-btn aktiv' : 'favorit-btn'}
                onClick={() => update({ is_favorite: entry.is_favorite ? 0 : 1 } as any)}
              >
                {entry.is_favorite ? '⭐ Favorit' : '☆ Favorit'}
              </button>
              {isAnime && entry.anilist_id && (
                <button
                  className={entry.abonniert ? 'favorit-btn abo-btn aktiv' : 'favorit-btn abo-btn'}
                  onClick={async () => setEntry(await api.setAbo(entry.id, !entry.abonniert))}
                  title={entry.abonniert
                    ? 'Abonniert: News, neue Folgen und Staffeln werden geprüft'
                    : 'Nicht abonniert: keine News, keine Prüfung auf neue Folgen/Staffeln'}
                >
                  {entry.abonniert ? '🔔 Abonniert' : '🔕 Abonnieren'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="detail-section">
          <h3 className="section-titel">Status</h3>
          <div className="status-buttons">
            {(['planned', 'started', 'ongoing', 'completed', 'paused', 'dropped'] as EntryStatus[]).map(s => (
              <button
                key={s}
                className={entry.status === s ? 'filter-btn active' : 'filter-btn'}
                onClick={() => update({ status: s })}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Fortschritt */}
        <div className="detail-section">
          <h3 className="section-titel">Fortschritt</h3>

          {isAnime && watchItems.length > 0 ? (
            // Staffel-Counter: eine Zeile pro Staffel/Teil
            <div className="staffel-counter-liste">
              {watchItems.map((item, i) => {
                const rel = item.relation_type ?? ''
                const relFarbe = ['MAIN','SEQUEL','PREQUEL','PARENT'].includes(rel) ? 'gruen'
                  : rel === 'SIDE_STORY' || rel === 'SPIN_OFF' ? 'lila' : 'grau'
                const relLabel = ({ MAIN:'Hauptstaffel', PREQUEL:'Prequel', SEQUEL:'Sequel',
                  SIDE_STORY:'Side Story', SPIN_OFF:'Spin-off', ALTERNATIVE:'Alternativ',
                  PARENT:'Hauptserie', SUMMARY:'Zusammenfassung', CHARACTER:'Charakter', OTHER:'Sonstiges' } as Record<string,string>)[rel] ?? rel
                return (
                <div key={item.related_anilist_id} className={`staffel-counter-zeile ${item.item_status === 'completed' ? 'staffel-counter-fertig' : ''}`}>
                  <div className="staffel-counter-info">
                    <span className="staffel-counter-titel">
                      {item.title ?? `Teil ${i + 1}`}
                    </span>
                    <span className={`staffel-relation-label staffel-relation-${relFarbe}`}>
                      {relLabel}
                      {istNeueStaffel(item) && <span className="staffel-badge staffel-badge--neu">NEU</span>}
                      {item.media_status === 'NOT_YET_RELEASED' && <span className="staffel-badge">Angekündigt</span>}
                    </span>
                  </div>
                  <div className="staffel-counter-steuer">
                    <button
                      className="zaehler-btn"
                      onClick={() => updateWatchItemProgress(i, item.progress_episodes - 1)}
                    >−</button>
                    <input
                      type="number"
                      className="zaehler-input"
                      key={`${item.related_anilist_id}-${item.progress_episodes}`}
                      defaultValue={item.progress_episodes}
                      min={0}
                      max={item.total_episodes || undefined}
                      onBlur={e => updateWatchItemProgress(i, Number(e.target.value))}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    />
                    <button
                      className="zaehler-btn"
                      onClick={() => updateWatchItemProgress(i, Math.min(item.total_episodes || 9999, item.progress_episodes + 1))}
                    >+</button>
                    <span className="zaehler-von">von {item.total_episodes || '?'}</span>
                    {item.item_status === 'completed' && <span className="staffel-counter-check">✓</span>}
                  </div>
                </div>
                )
              })}
            </div>
          ) : isAnime ? (
            <div className="fortschritt-zeile">
              <span className="fortschritt-label">Folge</span>
              <button className="zaehler-btn" aria-label="Eine Folge zurück" onClick={() => aendereProgress('progress_episodes', entry.progress_episodes - 1)}>−</button>
              {zahlenFeld(entry.progress_episodes, n => aendereProgress('progress_episodes', n), entry.total_episodes)}
              <span className="zaehler-von">von {entry.total_episodes ?? '?'}</span>
              <button className="zaehler-btn" aria-label="Eine Folge weiter" onClick={() => aendereProgress('progress_episodes', entry.progress_episodes + 1)}>+</button>
            </div>
          ) : (
            <>
              <div className="fortschritt-zeile">
                <span className="fortschritt-label">Kapitel</span>
                <button className="zaehler-btn" aria-label="Ein Kapitel zurück" onClick={() => aendereProgress('progress_chapters', entry.progress_chapters - 1)}>−</button>
                {zahlenFeld(entry.progress_chapters, n => aendereProgress('progress_chapters', n), entry.total_chapters)}
                <span className="zaehler-von">von {entry.total_chapters ?? '?'}</span>
                <button className="zaehler-btn" aria-label="Ein Kapitel weiter" onClick={() => aendereProgress('progress_chapters', entry.progress_chapters + 1)}>+</button>
              </div>
              <div className="fortschritt-zeile">
                <span className="fortschritt-label">Band</span>
                <button className="zaehler-btn" aria-label="Einen Band zurück" onClick={() => aendereProgress('progress_volumes', entry.progress_volumes - 1)}>−</button>
                {zahlenFeld(entry.progress_volumes, n => aendereProgress('progress_volumes', n), entry.total_volumes)}
                <span className="zaehler-von">von {entry.total_volumes ?? '?'}</span>
                <button className="zaehler-btn" aria-label="Einen Band weiter" onClick={() => aendereProgress('progress_volumes', entry.progress_volumes + 1)}>+</button>
              </div>
            </>
          )}

          {/* Wiederholungen – von Hand gezählt */}
          <div className="fortschritt-zeile rewatch-zeile">
            <span className="fortschritt-label" title={isAnime ? 'Wie oft komplett erneut geschaut' : 'Wie oft komplett erneut gelesen'}>
              ↻ Wiederholt
            </span>
            <button className="zaehler-btn" aria-label="Wiederholung abziehen" disabled={!entry.rewatch_count}
              onClick={() => update({ rewatch_count: Math.max(0, entry.rewatch_count - 1) })}>−</button>
            <span className="rewatch-zahl">{entry.rewatch_count}×</span>
            <button className="zaehler-btn" aria-label="Wiederholung hinzufügen"
              onClick={() => update({ rewatch_count: entry.rewatch_count + 1 })}>+</button>
          </div>
        </div>

        {/* Listen */}
        {listen.length > 0 && (
          <div className="detail-section">
            <div className="section-header">
              <h3 className="section-titel">Listen</h3>
              <button className="edit-btn" onClick={() => setListenOffen(o => !o)}>
                {listenOffen ? 'Fertig' : '✎ Bearbeiten'}
              </button>
            </div>
            {listenOffen ? (
              <div className="listen-toggle-grid">
                {listen.map(l => {
                  const istDrin = entryListenIds.has(l.id)
                  return (
                    <button
                      key={l.id}
                      className={istDrin ? 'listen-toggle-btn aktiv' : 'listen-toggle-btn'}
                      onClick={() => toggleListe(l.id, istDrin)}
                    >
                      {istDrin ? '✓ ' : '+ '}{l.name}
                    </button>
                  )
                })}
              </div>
            ) : (
              entryListenIds.size > 0 ? (
                <div className="listen-chips">
                  {listen.filter(l => entryListenIds.has(l.id)).map(l => (
                    <span key={l.id} className="listen-chip">{l.name}</span>
                  ))}
                </div>
              ) : (
                <p className="empty-hint">Noch keiner Liste zugeordnet.</p>
              )
            )}
          </div>
        )}

        {/* Bewertung */}
        <div className="detail-section">
          <h3 className="section-titel">Bewertung</h3>
          <Sterne wert={entry.rating} onChange={r => update({ rating: r } as any)} />
        </div>

        {/* Beschreibung */}
        {entry.description && (
          <div className="detail-section">
            <h3 className="section-titel">Beschreibung</h3>
            <p className="detail-beschreibung">{entry.description}</p>
          </div>
        )}

        {/* Rezension */}
        <div className="detail-section">
          <div className="section-header">
            <h3 className="section-titel">Meine Rezension</h3>
            {!rezBearbeiten && (
              <button className="edit-btn" onClick={() => setRezBearbeiten(true)}>✏️ Bearbeiten</button>
            )}
          </div>
          {rezBearbeiten ? (
            <div className="rezension-edit">
              <textarea
                value={rezension}
                onChange={e => setRezension(e.target.value)}
                className="rezension-textarea"
                placeholder="Deine private Rezension…"
                rows={5}
                autoFocus
              />
              <div className="rezension-aktionen">
                <button className="btn-primary" onClick={speichereRezension}>Speichern</button>
                <button className="abbrechen-btn" onClick={() => { setRezension(entry.review ?? ''); setRezBearbeiten(false) }}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <p className="rezension-text">
              {entry.review || <span className="empty-hint">Noch keine Rezension geschrieben.</span>}
            </p>
          )}
        </div>

        {/* Watch Order – nur für Anime, Manga werden separat behandelt */}
        {isAnime && entry.anilist_id && (
          <WatchOrder items={watchItems} onAendern={speichereWatchItems} onReset={resetWatchOrder} />
        )}
      </div>

      {coverGross && entry.cover_url && (
        <BildVergroesserung url={entry.cover_url} alt={entry.title} onSchliessen={() => setCoverGross(false)} />
      )}
    </div>
  )
}
