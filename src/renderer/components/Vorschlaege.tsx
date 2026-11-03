import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { NavigateFunction, useNavigate } from 'react-router-dom'
import { AniListSearchResult, Entry, GeplantVorschlag, Vorschlag, VorschlagAntwort } from '../../types'
import { api } from '../api'
import { snackbar } from '../meldungen'
import { MediaFilter, VorschlagBereich, vorschlagSitzung } from '../einpflegenZustand'
import { eintragAusAniList } from './EintragVorschau'
import Ladeindikator from './Ladeindikator'
import './Vorschlaege.css'

interface Props {
  /** Öffnet die Vorschau (wie ein Klick auf einen Suchtreffer) */
  onAuswaehlen: (media: AniListSearchResult) => void
}

const BEREICHE: Array<{ key: VorschlagBereich; kurz: string; titel: string }> = [
  { key: 'empfehlungen', kurz: 'Empfehlungen', titel: 'Weil dir … gefallen hat' },
  { key: 'adaptionen', kurz: 'Manga ↔ Anime', titel: 'Manga ↔ Anime' },
  { key: 'saison', kurz: 'Diese Saison', titel: 'Diese Saison' },
  { key: 'geplant', kurz: 'Geplant-Liste', titel: 'Aus deiner Geplant-Liste' },
]

const FORMAT_LABEL: Record<string, string> = {
  TV: 'TV', TV_SHORT: 'TV-Kurzserie', MOVIE: 'Film', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA',
  MUSIC: 'Musikvideo', MANGA: 'Manga', NOVEL: 'Light Novel', ONE_SHOT: 'One-Shot',
}

const STATUS_TEXT: Partial<Record<Entry['status'], string>> = {
  planned: 'Geplant', started: 'Angefangen', ongoing: 'Ongoing', completed: 'Beendet',
}

const schluesselA = (anilistId: number) => `a${anilistId}`
const schluesselE = (entryId: number) => `e${entryId}`

/** „heute 14:20“, „gestern 09:05“ oder „1.11. 14:20“ */
function formatStand(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const tag = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((tag(new Date()) - tag(d)) / 86_400_000)
  if (diff === 0) return `heute ${uhr}`
  if (diff === 1) return `gestern ${uhr}`
  return `${d.getDate()}.${d.getMonth() + 1}. ${uhr}`
}

function umfangText(typ: 'ANIME' | 'MANGA', folgen: number | null, kapitel: number | null): string | null {
  if (typ === 'ANIME') return folgen ? `${folgen} ${folgen === 1 ? 'Folge' : 'Folgen'}` : null
  return kapitel ? `${kapitel} Kapitel` : null
}

/** Fehlermeldung aus IPC („Error invoking remote method …: Error: <Meldung>“) herausschälen */
const grundAus = (e: any) => String(e?.message ?? e ?? '').split('Error: ').pop() || 'unbekannter Fehler'

/** Snackbar nach dem Hinzufügen (auch aus der Vorschau) – mit Sprung zum Eintrag */
export function meldeHinzugefuegt(entry: Entry, schonVorhanden: boolean, navigate: NavigateFunction, zusatz = '') {
  const oeffnen = { label: 'Öffnen', ausfuehren: () => navigate(`/detail/${entry.id}`, { state: { zurueck: 1 } }) }
  if (schonVorhanden) snackbar(`„${entry.title}“ ist schon in deiner Liste${zusatz}`, oeffnen)
  else snackbar(`„${entry.title}“ hinzugefügt (${STATUS_TEXT[entry.status] ?? entry.status})${zusatz}`, oeffnen)
}

/** Nach dem Hinzufügen über die Vorschau: Karte verschwindet auch nach dem Neuladen */
export function vorschlagErledigt(anilistId: number) {
  vorschlagSitzung.entfernt.add(schluesselA(anilistId))
}

export default function Vorschlaege({ onAuswaehlen }: Props) {
  const navigate = useNavigate()
  const [antwort, setAntwort] = useState<VorschlagAntwort | null>(vorschlagSitzung.antwort)
  const [laden, setLaden] = useState(!vorschlagSitzung.antwort)
  const [berechnen, setBerechnen] = useState(false)
  const [ladeFehler, setLadeFehler] = useState('')
  const [entfernt, setEntfernt] = useState<Set<string>>(() => new Set(vorschlagSitzung.entfernt))
  const [gewaehlt, setGewaehlt] = useState<VorschlagBereich | null>(vorschlagSitzung.bereich)
  const [beschaeftigt, setBeschaeftigt] = useState<Set<number>>(new Set())
  const [geplantTyp, setGeplantTyp] = useState<MediaFilter>(vorschlagSitzung.geplantTyp)
  const [geplantKurz, setGeplantKurz] = useState(vorschlagSitzung.geplantKurz)
  const [hervorgehoben, setHervorgehoben] = useState<number | null>(null)
  const listeRef = useRef<HTMLDivElement>(null)
  const aktiv = useRef(true)

  useEffect(() => () => { aktiv.current = false }, [])
  useEffect(() => { vorschlagSitzung.geplantTyp = geplantTyp }, [geplantTyp])
  useEffect(() => { vorschlagSitzung.geplantKurz = geplantKurz }, [geplantKurz])

  const lade = useCallback(async (neu: boolean, still = false) => {
    if (neu) setBerechnen(true)
    else if (!still) setLaden(true)
    setLadeFehler('')
    try {
      const a = await api.getVorschlaege(neu)
      if (!aktiv.current) return
      vorschlagSitzung.antwort = a
      setAntwort(a)
    } catch (e) {
      if (!aktiv.current || still) return
      setLadeFehler(grundAus(e))
    } finally {
      if (aktiv.current) { setLaden(false); setBerechnen(false) }
    }
  }, [])

  // Beim Öffnen laden; ein Stand aus dieser Sitzung wird sofort gezeigt und still aufgefrischt
  // (z. B. wenn auf der Detailseite inzwischen ein Geplant-Titel angefangen wurde)
  useEffect(() => { lade(false, !!vorschlagSitzung.antwort) }, [lade])

  // Scrollposition nach „← Zurück“ wiederherstellen (nur beim Einblenden)
  useLayoutEffect(() => {
    if (listeRef.current) listeRef.current.scrollTop = vorschlagSitzung.scrollPosition
  }, [])

  const listen = useMemo(() => {
    const ohne = (l: Vorschlag[] | undefined) => (l ?? []).filter(v => !entfernt.has(schluesselA(v.media.id)))
    return {
      empfehlungen: ohne(antwort?.empfehlungen),
      adaptionen: ohne(antwort?.adaptionen),
      saison: ohne(antwort?.saison),
      geplant: (antwort?.geplant ?? []).filter(g => !entfernt.has(schluesselE(g.entry_id))),
    }
  }, [antwort, entfernt])

  const vorhandene = BEREICHE.filter(b => listen[b.key].length > 0)
  // Gewählter Bereich leer (z. B. letzte Karte hinzugefügt) → der erste mit Inhalt
  const bereich = vorhandene.find(b => b.key === gewaehlt)?.key ?? vorhandene[0]?.key ?? null

  function waehleBereich(b: VorschlagBereich) {
    setGewaehlt(b)
    vorschlagSitzung.bereich = b
    vorschlagSitzung.scrollPosition = 0
    setHervorgehoben(null)
    if (listeRef.current) listeRef.current.scrollTop = 0
  }

  function entferne(schluessel: string) {
    // Tastatur: Lag der Fokus in der Karte, wandert er zur nächsten (statt ins Leere zu fallen)
    const karten = Array.from(listeRef.current?.querySelectorAll<HTMLElement>('.vorschlag-karte') ?? [])
    const nr = karten.findIndex(k => k.dataset.key === schluessel && k.contains(document.activeElement))
    vorschlagSitzung.entfernt.add(schluessel)
    setEntfernt(new Set(vorschlagSitzung.entfernt))
    if (nr >= 0) requestAnimationFrame(() => {
      const rest = listeRef.current?.querySelectorAll<HTMLElement>('.vorschlag-kopf')
      if (rest?.length) rest[Math.min(nr, rest.length - 1)].focus()
    })
  }

  async function mitSperre(id: number, f: () => Promise<void>) {
    setBeschaeftigt(s => new Set(s).add(id))
    try {
      await f()
    } catch (e) {
      snackbar(`Das hat nicht geklappt (${grundAus(e)})`)
    } finally {
      if (aktiv.current) setBeschaeftigt(s => { const n = new Set(s); n.delete(id); return n })
    }
  }

  const schnellGeplant = (v: Vorschlag) => mitSperre(v.media.id, async () => {
    const e = await api.createEntry(eintragAusAniList(v.media, 'planned'))
    entferne(schluesselA(v.media.id))
    meldeHinzugefuegt(e, !!e.schonVorhanden, navigate)
  })

  const abonnieren = (v: Vorschlag) => mitSperre(v.media.id, async () => {
    const e = await api.createEntry({ ...eintragAusAniList(v.media, 'planned'), abonniert: 1 })
    // Schon vorhanden: das Abo trotzdem einschalten (dafür ist der Knopf ja da)
    if (e.schonVorhanden && !e.abonniert) await api.setAbo(e.id, true)
    entferne(schluesselA(v.media.id))
    meldeHinzugefuegt(e, !!e.schonVorhanden, navigate, ' – abonniert')
  })

  const keinInteresse = (v: Vorschlag) => mitSperre(v.media.id, async () => {
    await api.vorschlagAusblenden(v.media.id)
    entferne(schluesselA(v.media.id))
    snackbar(`„${v.media.title.romaji}“ wird nicht mehr vorgeschlagen`)
  })

  // ── Geplant-Liste: Filter und Zufallsauswahl ──
  const geplantGefiltert = listen.geplant.filter(g =>
    (geplantTyp === 'ALLE' || g.type === geplantTyp) &&
    (!geplantKurz || (g.type === 'ANIME' && g.folgen != null && g.folgen <= 13)))

  function zufall() {
    if (geplantGefiltert.length === 0) return
    // Gewichtet nach „passt“ – gut Passendes kommt öfter dran, alles andere bleibt möglich
    const gewichte = geplantGefiltert.map(g => 5 + Math.max(0, g.passt))
    let r = Math.random() * gewichte.reduce((a, b) => a + b, 0)
    let wahl = geplantGefiltert[geplantGefiltert.length - 1]
    for (let i = 0; i < gewichte.length; i++) {
      r -= gewichte[i]
      if (r < 0) { wahl = geplantGefiltert[i]; break }
    }
    setHervorgehoben(wahl.entry_id)
  }

  // Ausgewählten Titel in die Mitte holen und fokussieren (Tastatur: Enter öffnet ihn dann)
  useEffect(() => {
    if (hervorgehoben == null) return
    const el = listeRef.current?.querySelector<HTMLElement>(`[data-entry="${hervorgehoben}"]`)
    if (!el) return
    // Erst fokussieren, dann scrollen – ein focus() danach bricht das sanfte Scrollen in Chromium ab
    el.focus({ preventScroll: true })
    const sanft = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: sanft ? 'smooth' : 'auto' })
  }, [hervorgehoben])

  const oeffneEintrag = (g: GeplantVorschlag) => navigate(`/detail/${g.entry_id}`, { state: { zurueck: 1 } })

  const stand = formatStand(antwort?.stand ?? null)
  const bereichInfo = BEREICHE.find(b => b.key === bereich)

  if (laden && !antwort) return <div className="vorschlaege"><Ladeindikator text="Vorschläge werden gesucht…" /></div>

  return (
    <div className="vorschlaege">
      <div className="vorschlaege-kopf">
        <span className="vorschlaege-stand" aria-live="polite">
          {berechnen ? 'Wird neu berechnet…' : stand ? `Stand: ${stand}` : ''}
        </span>
        <button
          className="vorschlaege-neu"
          onClick={() => lade(true)}
          disabled={berechnen || laden}
          title="Vorschläge jetzt neu von AniList berechnen"
        >
          <span className={berechnen ? 'dreht' : undefined} aria-hidden="true">↻</span> Neu berechnen
        </button>
      </div>

      {(antwort?.fehler || ladeFehler) && (
        <p className="vorschlaege-hinweis" role="status">
          ⚠ {ladeFehler
            ? `Vorschläge konnten nicht ${antwort ? 'aktualisiert' : 'geladen'} werden (${ladeFehler}).`
            : `Nicht alles ließ sich neu berechnen${antwort?.stand ? ' – teils siehst du den letzten Stand' : ''} (${antwort!.fehler}).`}
        </p>
      )}

      {vorhandene.length > 0 && (
        <div className="vorschlaege-bereiche" role="group" aria-label="Art der Vorschläge">
          {vorhandene.map(b => (
            <button
              key={b.key}
              className={bereich === b.key ? 'filter-btn active' : 'filter-btn'}
              aria-pressed={bereich === b.key}
              aria-label={`${b.titel}: ${listen[b.key].length}`}
              onClick={() => waehleBereich(b.key)}
            >
              {b.kurz} <span className="bereich-anzahl">{listen[b.key].length}</span>
            </button>
          ))}
        </div>
      )}

      <div
        className="vorschlaege-liste"
        ref={listeRef}
        onScroll={e => { vorschlagSitzung.scrollPosition = e.currentTarget.scrollTop }}
      >
        {!bereich ? (
          !antwort ? (
            ladeFehler && (
              <div className="empty-state vorschlaege-leer">
                <div className="empty-icon" aria-hidden="true">📡</div>
                <p>Gerade gibt es keine Vorschläge.</p>
                <button className="vorschlaege-neu" onClick={() => lade(false)}>Nochmal versuchen</button>
              </div>
            )
          ) : (
            <div className="empty-state vorschlaege-leer">
              <div className="empty-icon" aria-hidden="true">✨</div>
              <p>Bewerte ein paar Titel, dann gibt es hier Vorschläge.</p>
              <p className="empty-hint">Je mehr Sterne du vergibst, desto besser passen sie.</p>
            </div>
          )
        ) : (
          <>
            <div className="bereich-kopf">
              <h3 className="bereich-titel">{bereichInfo!.titel}</h3>
              {bereich === 'geplant' && (
                <button className="zufall-btn" onClick={zufall} disabled={geplantGefiltert.length === 0}>
                  <span aria-hidden="true">🎲</span> Zufällig
                </button>
              )}
            </div>

            {bereich === 'geplant' ? (
              <>
                <div className="geplant-filter" role="group" aria-label="Geplant-Liste filtern">
                  {(['ALLE', 'ANIME', 'MANGA'] as MediaFilter[]).map(f => (
                    <button
                      key={f}
                      className={geplantTyp === f ? 'filter-btn active' : 'filter-btn'}
                      aria-pressed={geplantTyp === f}
                      onClick={() => { setGeplantTyp(f); setHervorgehoben(null) }}
                    >
                      {f === 'ALLE' ? 'Alle' : f === 'ANIME' ? 'Anime' : 'Manga'}
                    </button>
                  ))}
                  <button
                    className={geplantKurz ? 'filter-btn active' : 'filter-btn'}
                    aria-pressed={geplantKurz}
                    onClick={() => { setGeplantKurz(k => !k); setHervorgehoben(null) }}
                  >
                    Kurz (≤ 13 Folgen)
                  </button>
                </div>
                {geplantGefiltert.length === 0 ? (
                  <p className="vorschlaege-keine">Kein geplanter Titel passt zu diesem Filter.</p>
                ) : (
                  <div className="vorschlag-raster">
                    {geplantGefiltert.map(g => (
                      <GeplantKarte
                        key={g.entry_id}
                        g={g}
                        hervorgehoben={hervorgehoben === g.entry_id}
                        onOeffnen={() => oeffneEintrag(g)}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="vorschlag-raster">
                {listen[bereich].map(v => (
                  <VorschlagKarte
                    key={v.media.id}
                    v={v}
                    beschaeftigt={beschaeftigt.has(v.media.id)}
                    onAnsehen={() => onAuswaehlen(v.media)}
                    onGeplant={() => schnellGeplant(v)}
                    onAbo={() => abonnieren(v)}
                    onKeinInteresse={() => keinInteresse(v)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function VorschlagKarte({ v, beschaeftigt, onAnsehen, onGeplant, onAbo, onKeinInteresse }: {
  v: Vorschlag
  beschaeftigt: boolean
  onAnsehen: () => void
  onGeplant: () => void
  onAbo: () => void
  onKeinInteresse: () => void
}) {
  const m = v.media
  const laeuft = m.status === 'RELEASING'
  const aboMoeglich = v.quelle === 'saison' && m.type === 'ANIME' && (laeuft || m.status === 'NOT_YET_RELEASED')
  const umfang = umfangText(m.type, m.episodes, m.chapters)
  const format = m.format ? FORMAT_LABEL[m.format] ?? m.format : null
  const titel = m.title.romaji

  return (
    <article className="vorschlag-karte" aria-label={titel} data-key={schluesselA(m.id)}>
      <button className="vorschlag-kopf" onClick={onAnsehen} title="Ansehen und mit Status hinzufügen">
        <img src={m.coverImage.large} alt="" className="vorschlag-cover" loading="lazy" />
        <div className="vorschlag-info">
          <span className="vorschlag-typ">
            <span className={`vorschlag-typ-art typ-${m.type.toLowerCase()}`}>{m.type === 'ANIME' ? 'Anime' : 'Manga'}</span>
            {format && format.toLowerCase() !== m.type.toLowerCase() && <span>· {format}</span>}
            {laeuft && <span className="vorschlag-laeuft">· läuft</span>}
            {m.status === 'NOT_YET_RELEASED' && <span className="vorschlag-laeuft">· demnächst</span>}
          </span>
          <h4 className="vorschlag-titel">{titel}</h4>
          <p className="vorschlag-meta">
            {[umfang, v.score != null ? `★ ${v.score} %` : null, v.zeitraum].filter(Boolean).join(' · ')}
          </p>
          <p className="vorschlag-grund">{v.grund}</p>
        </div>
      </button>
      <div className="vorschlag-aktionen">
        <button
          className="vorschlag-btn vorschlag-btn--haupt"
          onClick={onGeplant}
          disabled={beschaeftigt}
          aria-label={`„${titel}“ als geplant hinzufügen`}
        >
          + Geplant
        </button>
        {aboMoeglich && (
          <button
            className="vorschlag-btn"
            onClick={onAbo}
            disabled={beschaeftigt}
            aria-label={`„${titel}“ hinzufügen und abonnieren`}
            title="Als geplant hinzufügen und auf neue Folgen prüfen"
          >
            <span aria-hidden="true">🔔</span> Abonnieren
          </button>
        )}
        <button
          className="vorschlag-btn vorschlag-btn--leise"
          onClick={onKeinInteresse}
          disabled={beschaeftigt}
          aria-label={`„${titel}“: kein Interesse, nicht mehr vorschlagen`}
        >
          Kein Interesse
        </button>
      </div>
    </article>
  )
}

function GeplantKarte({ g, hervorgehoben, onOeffnen }: { g: GeplantVorschlag; hervorgehoben: boolean; onOeffnen: () => void }) {
  const umfang = umfangText(g.type, g.folgen, g.kapitel)
  const passt = Math.max(0, Math.min(100, Math.round(g.passt)))
  return (
    <button
      className={hervorgehoben ? 'vorschlag-karte geplant-karte hervorgehoben' : 'vorschlag-karte geplant-karte'}
      data-entry={g.entry_id}
      onClick={onOeffnen}
      aria-label={`${g.title} öffnen – passt zu ${passt} %${hervorgehoben ? ' (zufällig ausgewählt)' : ''}`}
    >
      <div className="vorschlag-kopf">
        {g.cover_url
          ? <img src={g.cover_url} alt="" className="vorschlag-cover" loading="lazy" />
          : <div className="vorschlag-cover vorschlag-cover--leer" aria-hidden="true">?</div>}
        <div className="vorschlag-info">
          <span className="vorschlag-typ">
            <span className={`vorschlag-typ-art typ-${g.type.toLowerCase()}`}>{g.type === 'ANIME' ? 'Anime' : 'Manga'}</span>
            {umfang && <span>· {umfang}</span>}
            {hervorgehoben && <span className="zufall-marke">🎲 Heute dran</span>}
          </span>
          <h4 className="vorschlag-titel">{g.title}</h4>
          <div className="passt" aria-hidden="true">
            <div className="passt-balken"><div style={{ width: `${passt}%` }} /></div>
            <span>passt {passt} %</span>
          </div>
          <p className="vorschlag-grund">{g.grund}</p>
          {g.genres.length > 0 && (
            <div className="vorschlag-genres">
              {g.genres.slice(0, 3).map(x => <span key={x} className="genre-tag">{x}</span>)}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
