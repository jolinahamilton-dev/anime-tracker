// Tests für die kleinen Anzeige-Regeln (Welle 1): „neu“/„offen“, doppelte Staffelzeile, Manga ohne Kapitelzahl
// und den Takt des Handy-Abgleichs.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const BUILD = process.env.ANIME_TRACKER_TEST_BUILD
const { offenText, staffelZeile, kapitelStand } = require(path.join(BUILD, 'renderer/anzeige.js'))
const r = require(path.join(BUILD, 'sync/rhythmus.js'))

test('offenText: „neu“ nur bei laufender Staffel', () => {
  assert.equal(offenText(165, true), '165 neu')
  assert.equal(offenText(165, false), '165 offen')
})

test('staffelZeile: gleicher Name (auch anders geschrieben) entfällt', () => {
  assert.equal(staffelZeile('InuYasha', 'InuYasha', 'InuYasha'), null)
  assert.equal(staffelZeile('Inu-Yasha', 'InuYasha'), null)
  assert.equal(staffelZeile('Inuyasha: The Final Act', 'InuYasha', 'InuYasha'), 'Inuyasha: The Final Act')
  assert.equal(staffelZeile('Staffel 2', null, undefined), 'Staffel 2')
  assert.equal(staffelZeile(null, 'x'), null)
  assert.equal(staffelZeile('Titel', 'Anderer', 'titel'), null) // gleich dem angezeigten Titel
})

test('kapitelStand: ohne Gesamtzahl „läuft noch“, nie „von ?“', () => {
  assert.equal(kapitelStand(247, null, true), 'Kapitel 247 · läuft noch')
  assert.equal(kapitelStand(247, 300, true), 'Kapitel 247/300')
  assert.equal(kapitelStand(12, null, false), 'Kapitel 12')
})

test('Handy-Takt: 5 min, nach 3 ruhigen Läufen 15 min, Änderung setzt zurück', () => {
  const t = r.erstelleRhythmus()
  assert.equal(t.wartezeit(), r.TAKT)
  assert.equal(t.nachLauf(false), r.TAKT)
  assert.equal(t.nachLauf(false), r.TAKT)
  assert.equal(t.nachLauf(false), r.TAKT_RUHE)
  assert.equal(t.nachLauf(false), r.TAKT_RUHE)
  assert.equal(t.nachLauf(true), r.TAKT)
  assert.equal(t.nachLauf(false), r.TAKT)
  for (let i = 0; i < 5; i++) t.nachLauf(false)
  assert.equal(t.aktivitaet(), 10 * 1000) // zurück in der App / eigene Änderung: 10 s, Zähler zurück
  assert.equal(t.wartezeit(), r.TAKT)
})
