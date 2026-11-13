'use strict';

/**
 * Stemmer leggero per l'italiano.
 *
 * FTS5 non include uno stemming linguistico: `unicode61` sa solo normalizzare
 * maiuscole e segni diacritici. Per rendere cercabili le forme flesse
 * (cellula/cellule, respirare/respirazione) indicizziamo una seconda copia del
 * testo con questa riduzione dei suffissi. Non è uno stemmer linguistico
 * completo: è volutamente conservativo, deterministico e senza dipendenze.
 *
 * Regole:
 *  - gli accenti vengono rimossi (coerente con `remove_diacritics 2`);
 *  - si toglie il suffisso derivativo più lungo tra quelli noti;
 *  - si toglie la vocale finale di genere/numero se resta una radice utile.
 */

const TOKEN_RE = /[\p{L}\p{N}]+/gu;

// Suffissi derivativi e verbali frequenti, dal più lungo al più corto.
// La radice deve restare lunga almeno MIN_STEM caratteri.
const SUFFIXES = [
  'erebbero',
  'arrebbero',
  'irebbero',
  'amente',
  'amenti',
  'amento',
  'azioni',
  'azione',
  'atrici',
  'atrice',
  'atori',
  'atore',
  'mente',
  'zioni',
  'zione',
  'sioni',
  'sione',
  'logie',
  'logia',
  'grafie',
  'grafia',
  'issime',
  'issimi',
  'issimo',
  'issima',
  'eranno',
  'iranno',
  'eremmo',
  'iremmo',
  'ereste',
  'ireste',
  'eremo',
  'iremo',
  'erete',
  'irete',
  'avano',
  'avamo',
  'avate',
  'evano',
  'evamo',
  'evate',
  'ivano',
  'ivamo',
  'ivate',
  'arono',
  'erono',
  'irono',
  'ando',
  'endo',
  'iamo',
  'iate',
  'ano',
  'ono',
  'are',
  'ere',
  'ire',
  'ato',
  'ata',
  'ati',
  'ate',
  'ito',
  'ita',
  'iti',
  'ite',
  'uto',
  'uta',
  'uti',
  'ute',
  'avo',
  'avi',
  'ava',
  'evi',
  'eva',
  'ivo',
  'ivi',
  'iva',
  'eta',
];

const MIN_STEM = 3;

function foldAccents(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function tokenize(value) {
  const matches = String(value ?? '').toLowerCase().match(TOKEN_RE);
  return matches || [];
}

function stemItalian(value) {
  let word = foldAccents(value).replace(/[^a-z0-9]/g, '');
  if (word.length <= MIN_STEM) return word;

  for (const suffix of SUFFIXES) {
    if (!word.endsWith(suffix)) continue;
    const candidate = word.slice(0, -suffix.length);
    if (candidate.length >= MIN_STEM) {
      word = candidate;
      break;
    }
  }

  // Desinenza di genere/numero: cellula/cellule -> cellul.
  if (word.length > MIN_STEM && /[aeio]$/.test(word)) {
    word = word.slice(0, -1);
  }

  return word;
}

function stemText(value) {
  return tokenize(value).map(stemItalian).join(' ');
}

module.exports = {
  foldAccents,
  stemItalian,
  stemText,
  tokenize,
};
