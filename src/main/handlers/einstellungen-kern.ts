import { dbGet } from '../../db/database'

// Lesezugriff auf Einstellungen der Oberfläche, die auch die Main-Handler brauchen (Meta-Schlüssel in app_meta)

export const TITEL_SPRACHEN = ['englisch', 'romaji', 'japanisch'] as const
export type TitelSprache = typeof TITEL_SPRACHEN[number]

function meta(key: string): string | null {
  const v = dbGet('SELECT value FROM app_meta WHERE key = ?', [key])?.value
  return typeof v === 'string' ? v : null
}

/** „18+-Titel anzeigen“: ohne gespeicherten Wert an (es wird nichts herausgefiltert) */
export function adultAnzeigen(): boolean {
  return meta('adultAnzeigen') !== 'false'
}

/** Sprache der angezeigten Titel: ohne gültigen Wert Englisch */
export function titelSprache(): TitelSprache {
  const v = meta('titelSprache')
  return (TITEL_SPRACHEN as readonly string[]).includes(v ?? '') ? (v as TitelSprache) : 'englisch'
}

/** Variablen für AniList-Abfragen mit `isAdult: $adult`. Bei „18+ anzeigen“ MUSS die Variable ganz fehlen:
 *  ein ausdrückliches `adult: null` filtert bei AniList auf „isAdult = null“ und liefert gar keine Treffer. */
export function adultFilter(): { adult?: false } {
  return adultAnzeigen() ? {} : { adult: false }
}
