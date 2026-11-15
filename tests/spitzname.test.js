// Spitzname-Vorschlag aus dem Suchtext (src/renderer/spitzname.ts)
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const { spitznameAusSuche, normalisiere } = require(path.join(process.env.ANIME_TRACKER_TEST_BUILD, 'renderer', 'spitzname.js'))

const KUSURIYA = ['Kusuriya no Hitorigoto', 'The Apothecary Diaries', '薬屋のひとりごと']
const AOT = ['Shingeki no Kyojin', 'Attack on Titan', '進撃の巨人']

test('Normalisierung: Akzente, Groß/Klein, Satzzeichen', () => {
  assert.equal(normalisiere('Tagebücher der Apothekerin!'), 'tagebucherderapothekerin')
  assert.equal(normalisiere('Re:Zero − Starting Life'), 'rezerostartinglife')
})

test('eigener Name wird übernommen', () => {
  assert.equal(spitznameAusSuche('Tagebücher der Apothekerin', KUSURIYA), 'Tagebücher der Apothekerin')
  assert.equal(spitznameAusSuche('  AoT ', AOT), 'AoT')
  assert.equal(spitznameAusSuche('Apothekerin', KUSURIYA), 'Apothekerin')
})

test('Teil- oder Schreibvarianten des Titels nicht', () => {
  assert.equal(spitznameAusSuche('naruto', ['NARUTO', 'Naruto']), '')
  assert.equal(spitznameAusSuche('kusuriya', KUSURIYA), '')
  assert.equal(spitznameAusSuche('Kusuriya no Hitorigoto', KUSURIYA), '')
  assert.equal(spitznameAusSuche('attack on titans', AOT), '')
  assert.equal(spitznameAusSuche('Shingeki no Kyojn', AOT), '')
  assert.equal(spitznameAusSuche('one', ['One Piece']), '')
})

test('zu kurz oder leer', () => {
  assert.equal(spitznameAusSuche('', AOT), '')
  assert.equal(spitznameAusSuche('ab', AOT), '')
  assert.equal(spitznameAusSuche('  a ', AOT), '')
  assert.equal(spitznameAusSuche('--', AOT), '')
})

test('fehlende Titel (null) stören nicht', () => {
  assert.equal(spitznameAusSuche('Mein Lieblingsanime', ['Bleach', null, undefined]), 'Mein Lieblingsanime')
})
