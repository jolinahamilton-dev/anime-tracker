import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { AniListSearchResult } from '../../types'
import './AniListSuche.css'
import { api } from '../api'
import { einpflegenSitzung, MediaFilter } from '../einpflegenZustand'

interface Props {
  onAuswaehlen: (result: AniListSearchResult) => void
}

export default function AniListSuche({ onAuswaehlen }: Props) {
  // Startwerte aus der Sitzung → nach „← Zurück“ aus der Vorschau ist alles wie vorher
  const [suchbegriff, setSuchbegriff] = useState(einpflegenSitzung.suchbegriff)
  const [filter, setFilter] = useState<MediaFilter>(einpflegenSitzung.filter)
  const [ergebnisse, setErgebnisse] = useState<AniListSearchResult[]>(einpflegenSitzung.ergebnisse)
  const [laden, setLaden] = useState(false)
  const [fehler, setFehler] = useState('')
  const listeRef = useRef<HTMLDivElement>(null)

  useEffect(() => { einpflegenSitzung.suchbegriff = suchbegriff }, [suchbegriff])
  useEffect(() => { einpflegenSitzung.filter = filter }, [filter])
  useEffect(() => { einpflegenSitzung.ergebnisse = ergebnisse }, [ergebnisse])

  // Scrollposition der Trefferliste wiederherstellen (nur beim Einblenden)
  useLayoutEffect(() => {
    if (listeRef.current) listeRef.current.scrollTop = einpflegenSitzung.scrollPosition
  }, [])

  const suchen = useCallback(async () => {
    const q = suchbegriff.trim()
    if (!q) return
    setLaden(true)
    setFehler('')
    try {
      const typen: Array<'ANIME' | 'MANGA'> = filter === 'ALLE' ? ['ANIME', 'MANGA'] : [filter]
      const [ergebnisArrays, vorhandene] = await Promise.all([
        Promise.all(typen.map(t => api.searchAniList(q, t))),
        api.getEntries(),
      ])
      const vorhandeneIds = new Set((vorhandene as Array<{ anilist_id: number | null }>).map(e => e.anilist_id).filter(Boolean))
      // Einträge ohne AniList-ID (CSV-Import, manuell) über Titel + Typ erkennen
      const vorhandeneTitel = new Set(
        (vorhandene as Array<{ anilist_id: number | null; title: string; type: string }>)
          .filter(e => !e.anilist_id)
          .map(e => `${e.type}|${e.title.trim().toLowerCase()}`)
      )
      const istVorhanden = (item: any) =>
        vorhandeneIds.has(item.id) ||
        [item.title?.romaji, item.title?.english].some(
          (t: string | null) => t && vorhandeneTitel.has(`${item.type}|${t.trim().toLowerCase()}`)
        )
      const alleErgebnisse: any[] = ergebnisArrays.flat()
      const alleIds = new Set(alleErgebnisse.map((r: any) => r.id))

      // Formate, die typischerweise Nebenwerke sind (OVA, Special, Music-Video, ONA) –
      // nur DIESE werden bei einer PARENT-Beziehung ausgeblendet. TV/MOVIE/MANGA-Formate
      // bleiben immer sichtbar, damit eine gezielte Suche nach einem solchen Titel nicht
      // grundlos verschwindet, nur weil er zufällig eine PARENT-Relation zu einem anderen
      // Treffer hat.
      const NEBENWERK_FORMATE = new Set(['OVA', 'SPECIAL', 'MUSIC', 'ONA'])

      // Sammle IDs, die als SEQUEL eines anderen Suchergebnisses vorkommen, oder die
      // selbst ein Nebenwerk mit PARENT-Beziehung zu einem anderen Ergebnis sind (= OVA/
      // Side-Story einer bereits vorhandenen Hauptserie) → diese werden ausgeblendet,
      // damit die Hauptserie nicht von Nebenwerken verdrängt wird
      const ausgeblendet = new Set<number>()
      for (const result of alleErgebnisse) {
        for (const edge of result.relations?.edges ?? []) {
          if (edge.relationType === 'SEQUEL' && alleIds.has(edge.node.id)) {
            ausgeblendet.add(edge.node.id)
          }
          if (
            edge.relationType === 'PARENT' &&
            edge.node.type === result.type &&
            alleIds.has(edge.node.id) &&
            NEBENWERK_FORMATE.has(result.format)
          ) {
            ausgeblendet.add(result.id)
          }
        }
      }

      const merged = alleErgebnisse
        .filter((item: any) => !ausgeblendet.has(item.id))
        .map((item: any) => ({
          ...item,
          bereitsVorhanden: istVorhanden(item),
        }))
      setErgebnisse(merged)
      // Neue Treffer beginnen oben
      if (listeRef.current) listeRef.current.scrollTop = 0
      einpflegenSitzung.scrollPosition = 0
    } catch (e: any) {
      // IPC verpackt die Meldung als „Error invoking remote method …: Error: <Meldung>"
      const grund = String(e?.message ?? '').split('Error: ').pop()
      setFehler(`Suche fehlgeschlagen${grund ? ` (${grund})` : ''}. Internetverbindung prüfen.`)
    } finally {
      setLaden(false)
    }
  }, [suchbegriff, filter])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') suchen()
  }

  return (
    <div className="anilist-suche">
      <div className="suche-bar">
        <input
          type="text"
          placeholder="Anime oder Manga suchen..."
          value={suchbegriff}
          onChange={e => setSuchbegriff(e.target.value)}
          onKeyDown={onKeyDown}
          className="suche-input"
          // Bei wiederhergestellten Treffern nicht fokussieren – sonst springt am Handy die Tastatur auf
          autoFocus={einpflegenSitzung.ergebnisse.length === 0}
        />
        <div className="filter-buttons">
          {(['ALLE', 'ANIME', 'MANGA'] as MediaFilter[]).map(f => (
            <button
              key={f}
              className={filter === f ? 'filter-btn active' : 'filter-btn'}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <button className="suche-btn" onClick={suchen} disabled={laden}>
          {laden ? '...' : '🔍 Suchen'}
        </button>
      </div>

      {fehler && <p className="fehler-text">{fehler}</p>}

      <div
        className="ergebnisse-liste"
        ref={listeRef}
        onScroll={e => { einpflegenSitzung.scrollPosition = e.currentTarget.scrollTop }}
      >
        {ergebnisse.length === 0 && !laden && suchbegriff && (
          <p className="keine-ergebnisse">Keine Ergebnisse gefunden.</p>
        )}
        {ergebnisse.map(item => (
          <button
            key={`${item.type}-${item.id}`}
            className={(item as any).bereitsVorhanden ? 'ergebnis-karte vorhanden' : 'ergebnis-karte'}
            onClick={() => onAuswaehlen(item)}
          >
            <img
              src={item.coverImage.large}
              alt={item.title.romaji}
              className="ergebnis-cover"
            />
            <div className="ergebnis-info">
              <span className={`ergebnis-typ typ-${item.type.toLowerCase()}`}>{item.type}</span>
              <h3 className="ergebnis-titel">{item.title.romaji}</h3>
              {item.title.english && item.title.english !== item.title.romaji && (
                <p className="ergebnis-titel-en">{item.title.english}</p>
              )}
              <div className="ergebnis-genres">
                {item.genres.slice(0, 3).map(g => (
                  <span key={g} className="genre-tag">{g}</span>
                ))}
              </div>
              <p className="ergebnis-meta">
                {item.type === 'ANIME'
                  ? item.episodes ? `${item.episodes} Folgen` : 'Folgenanzahl unbekannt'
                  : item.chapters ? `${item.chapters} Kapitel` : 'Kapitelanzahl unbekannt'}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
