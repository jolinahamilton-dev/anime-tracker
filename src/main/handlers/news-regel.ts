import { dbGet } from '../../db/kern'

// ─────────────────────────────────────────────────────────────────────────────
// Eine gemeinsame Regel dafür, welche Staffeln/Teile einer abonnierten Serie in den News
// vorkommen: standardmäßig nur die Hauptlinie (MAIN/PREQUEL/SEQUEL) plus der Eintrag selbst.
// Side Stories, Spin-offs, Filme und Kurzserien (z. B. „Maomao no Hitorigoto" bei den
// Apothekerin-Tagebüchern) erscheinen nur mit der Einstellung „Nebengeschichten in den News"
// (app_meta 'newsNeben'). Gilt für Folgen-Liste, Zähler, nächste Folge, neue Staffeln und Hinweise.
// ─────────────────────────────────────────────────────────────────────────────

const HAUPTLINIE_ARTEN = ['MAIN', 'PREQUEL', 'SEQUEL']

/** Ist „Nebengeschichten in den News zeigen" eingeschaltet? */
export function nebenInNews(): boolean {
  return dbGet("SELECT value FROM app_meta WHERE key = 'newsNeben'")?.value === 'true'
}

/** Zählt eine Verknüpfung dieser Art für die News? (`neben` = Einstellung, sonst wird sie gelesen) */
export function newsRelationErlaubt(relationType: unknown, neben: boolean = nebenInNews()): boolean {
  return neben || HAUPTLINIE_ARTEN.includes(String(relationType))
}

/** SQL-Zusatzbedingung für watch_order-Zeilen (` AND alias.relation_type IN (…)`), leer bei „alle" */
export function newsWatchOrderBedingung(alias = 'w', neben: boolean = nebenInNews()): string {
  return neben ? '' : ` AND ${alias}.relation_type IN (${HAUPTLINIE_ARTEN.map(a => `'${a}'`).join(', ')})`
}

/** AniList-IDs aller abonnierten Anime samt der für die News zählenden Staffeln (Unterabfrage) */
export function aboIdsSql(neben: boolean = nebenInNews()): string {
  return `
  SELECT anilist_id FROM entries WHERE abonniert = 1 AND anilist_id IS NOT NULL
  UNION
  SELECT w.related_anilist_id FROM watch_order w JOIN entries e ON e.id = w.entry_id
    WHERE e.abonniert = 1${newsWatchOrderBedingung('w', neben)}`
}
