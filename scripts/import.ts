/**
 * Import script for OpenScriptures MorphHB (Hebrew Bible) data.
 *
 * Downloads individual book XML files from the MorphHB GitHub repository
 * and converts to JSON format.
 *
 * Usage: npx tsx scripts/import.ts
 */

import { XMLParser } from 'fast-xml-parser';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

const BASE_URL = 'https://raw.githubusercontent.com/openscriptures/morphhb/refs/heads/master/wlc/';

const BOOKS = [
  'Gen.xml', 'Exod.xml', 'Lev.xml', 'Num.xml', 'Deut.xml',
  'Josh.xml', 'Judg.xml', 'Ruth.xml',
  '1Sam.xml', '2Sam.xml', '1Kgs.xml', '2Kgs.xml',
  '1Chr.xml', '2Chr.xml', 'Ezra.xml', 'Neh.xml', 'Esth.xml',
  'Job.xml', 'Ps.xml', 'Prov.xml', 'Eccl.xml', 'Song.xml',
  'Isa.xml', 'Jer.xml', 'Lam.xml', 'Ezek.xml', 'Dan.xml',
  'Hos.xml', 'Joel.xml', 'Amos.xml', 'Obad.xml', 'Jonah.xml',
  'Mic.xml', 'Nah.xml', 'Hab.xml', 'Zeph.xml', 'Hag.xml',
  'Zech.xml', 'Mal.xml',
];

const SOURCE_DIR = join(ROOT_DIR, 'source');
const DATA_DIR = join(ROOT_DIR, 'data', 'openscriptures-OHB');

const STRONGS_RE = /(?:strongs?:)?([HGhg]?\d{1,5})/g;

interface WordEntry {
  position: number;
  text: string;
  lemma?: string | null;
  morph?: string | null;
  strongs?: string[];
  variant?: 'ketiv' | 'qere';
  metadata?: Record<string, unknown>;
  /** Raw source data preserved for reference */
  source?: {
    /** Original lemma attribute value */
    lemma?: string;
    /** Original morph attribute value */
    morph?: string;
    /** Original element type (e.g., x-ketiv, x-qere) */
    type?: string;
  };
}

interface VerseData {
  text: string;
  words: WordEntry[];
}

// Hebrew maqqef character (U+05BE) - used as a word connector like a hyphen
const MAQQEF = '\u05BE';

// Special-letter handling (litterae majusculae / minusculae / suspensae).
// The WLC encodes enlarged, small, and suspended letters as <seg> nested inside
// <w>. preserveOrder:false would detach or drop them, so before parsing we wrap
// each one in Private-Use sentinels that survive as plain text (START <typeCode>
// ...letter... END). During word building extractSpecialLetters() strips the
// sentinels, keeping the letter in place, and records which base consonant it is
// (type + 0-based index among the word's consonants) so the UI can render it
// large / small / raised.
const SPECIAL_START = '\uE000';
const SPECIAL_END = '\uE001';
const SPECIAL_TYPE_CODE: Record<string, string> = {
  large: 'L',
  small: 'S',
  suspended: 'U',
};
const SPECIAL_TYPE_BY_CODE: Record<string, 'large' | 'small' | 'suspended'> = {
  L: 'large',
  S: 'small',
  U: 'suspended',
};

interface SpecialLetter {
  type: 'large' | 'small' | 'suspended';
  /** The marked base consonant (with its own points/accents, if any). */
  char: string;
  /** 0-based index of the marked consonant among the word's base consonants. */
  index: number;
}

// A Hebrew base consonant (alef..tav, incl. final forms). Points, dagesh, and
// cantillation accents are combining marks and do not advance the consonant index.
function isHebrewConsonant(cp: number): boolean {
  return cp >= 0x05d0 && cp <= 0x05ea;
}

/**
 * Pull any special-letter sentinels out of a word piece, returning the clean
 * word text and the list of special letters found (with consonant index).
 */
function extractSpecialLetters(piece: string): {
  clean: string;
  specials: SpecialLetter[];
} {
  if (!piece.includes(SPECIAL_START)) return { clean: piece, specials: [] };

  const specials: SpecialLetter[] = [];
  let clean = '';
  let consonantIdx = -1;
  let current: { type: 'large' | 'small' | 'suspended'; index: number; char: string } | null = null;

  const chars = [...piece];
  for (let k = 0; k < chars.length; k++) {
    const ch = chars[k];
    if (ch === SPECIAL_START) {
      const code = chars[++k];
      current = { type: SPECIAL_TYPE_BY_CODE[code], index: -1, char: '' };
      continue;
    }
    if (ch === SPECIAL_END) {
      if (current && current.index >= 0) {
        specials.push({ type: current.type, char: current.char, index: current.index });
      }
      current = null;
      continue;
    }
    if (isHebrewConsonant(ch.codePointAt(0)!)) {
      consonantIdx++;
      if (current && current.index < 0) current.index = consonantIdx;
    }
    if (current) current.char += ch;
    clean += ch;
  }

  return { clean, specials };
}

function extractStrongs(value: string | null, wordText?: string): string[] {
  if (!value) return [];

  const results: string[] = [];
  let match;
  STRONGS_RE.lastIndex = 0;

  while ((match = STRONGS_RE.exec(value)) !== null) {
    const token = match[1];
    let prefix = '';
    if (token[0] && 'HGhg'.includes(token[0])) {
      prefix = token[0].toUpperCase();
    }
    const digits = token.match(/\d{1,5}/);
    if (!digits) continue;

    // Default to Hebrew for this source
    if (!prefix) prefix = 'H';

    results.push(`${prefix}${parseInt(digits[0], 10)}`);
  }

  return results;
}

async function downloadBook(bookName: string): Promise<string> {
  const xmlPath = join(SOURCE_DIR, bookName);

  if (existsSync(xmlPath)) {
    return await readFile(xmlPath, 'utf-8');
  }

  const url = `${BASE_URL}${bookName}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${bookName}: ${response.status}`);
  }

  const xml = await response.text();
  await writeFile(xmlPath, xml, 'utf-8');

  return xml;
}

interface ParsedVerse {
  book: string;
  chapter: number;
  number: number;
  text: string;
  words: Array<{
    position: number;
    text: string;
    lemma?: string | null;
    morph?: string | null;
    strongs?: string[];
    variant?: 'ketiv' | 'qere';
    metadata?: Record<string, unknown>;
    source?: {
      lemma?: string;
      morph?: string;
      type?: string;
    };
  }>;
}

function parseOsis(xml: string): ParsedVerse[] {
  // Inline "special letter" segments (litterae majusculae / minusculae /
  // suspensae) before parsing. In the WLC source these mark enlarged, small,
  // and suspended letters that are an integral part of the surrounding word
  // (e.g. the large ayin of שְׁמַע and the large dalet of אֶחָד in Deut 6:4, or
  // the large vav in the middle of גָּחוֹן, the center letter of the Torah, in
  // Lev 11:42). They are nested *inside* <w> elements, so the
  // non-order-preserving XML parse would otherwise either drop them (they match
  // the "skip x-* seg" rule below) or detach them from their word. Wrap each in
  // Private-Use sentinels that survive parsing as plain text, keeping the letter
  // in its correct position; extractSpecialLetters() later strips the sentinels
  // and records the letter's type + consonant index for the UI.
  xml = xml.replace(
    /<seg type="x-(large|small|suspended)">([\s\S]*?)<\/seg>/g,
    (_m, type: string, inner: string) =>
      `${SPECIAL_START}${SPECIAL_TYPE_CODE[type]}${inner}${SPECIAL_END}`
  );

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    preserveOrder: false,
    trimValues: false, // Preserve whitespace for Hebrew
  });

  const doc = parser.parse(xml);
  const verses: ParsedVerse[] = [];

  function findVerses(obj: unknown, results: ParsedVerse[]): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        findVerses(item, results);
      }
      return;
    }

    const record = obj as Record<string, unknown>;

    // Check if this is a verse element
    if (record['@_osisID'] && typeof record['@_osisID'] === 'string') {
      const osisId = record['@_osisID'];
      const parts = osisId.split('.');
      if (parts.length === 3) {
        const [book, chap, num] = parts;
        const words: ParsedVerse['words'] = [];
        let pos = 1;
        let isInsideQere = false;

        function extractWords(content: unknown): void {
          if (!content) return;

          if (typeof content === 'string') {
            const cleanText = content.replace(/\//g, '').trim();
            if (cleanText) {
              for (const rawWord of cleanText.split(/\s+/).filter(Boolean)) {
                const { clean: word, specials } = extractSpecialLetters(rawWord);
                // Skip maqqef-only entries (punctuation, not words)
                if (word === MAQQEF) continue;
                words.push({
                  position: pos++,
                  text: word,
                  lemma: null,
                  morph: null,
                  metadata: specials.length > 0 ? { specialLetters: specials } : {},
                  source: {},
                });
              }
            }
            return;
          }

          if (Array.isArray(content)) {
            for (const item of content) {
              extractWords(item);
            }
            return;
          }

          if (typeof content === 'object') {
            const elem = content as Record<string, unknown>;

            if (elem['#text']) {
              const elemType = elem['@_type'] as string | undefined;

              // Skip <seg> elements with specific types (paragraph markers and punctuation)
              // But do NOT skip word/reading elements: x-ketiv, x-qere
              if (elemType && elemType.startsWith('x-')) {
                // Allow ketiv and qere types through - they contain valid word data
                if (elemType !== 'x-ketiv' && elemType !== 'x-qere') {
                  return;
                }
              }

              const rawText = String(elem['#text']);
              const text = rawText.replace(/\//g, '').trim();
              const lemma = elem['@_lemma'] as string | undefined;
              const morph = elem['@_morph'] as string | undefined;

              if (text) {
                const strongs = extractStrongs(lemma || null, text);
                for (const rawPiece of text.split(/\s+/).filter(Boolean)) {
                  const { clean: piece, specials } = extractSpecialLetters(rawPiece);
                  // Skip maqqef-only entries (punctuation, not words)
                  if (piece === MAQQEF) continue;

                  // Determine variant type for Qere/Ketiv
                  let variant: 'ketiv' | 'qere' | undefined;
                  if (elemType === 'x-ketiv') {
                    variant = 'ketiv';
                  } else if (isInsideQere) {
                    variant = 'qere';
                  }

                  // Build source object to preserve raw attributes
                  const source: { lemma?: string; morph?: string; type?: string } = {};
                  if (lemma) source.lemma = lemma;
                  if (morph) source.morph = morph;
                  if (elemType) source.type = elemType;

                  words.push({
                    position: pos++,
                    text: piece,
                    lemma: lemma || null,
                    morph: morph || null,
                    strongs: strongs.length > 0 ? strongs : undefined,
                    variant,
                    metadata: specials.length > 0 ? { specialLetters: specials } : undefined,
                    source: Object.keys(source).length > 0 ? source : undefined,
                  });
                }
              }
            }

            for (const [key, value] of Object.entries(elem)) {
              // Skip catchWord (redundant copy of ketiv text)
              if (key === 'catchWord') {
                continue;
              }
              // Handle rdg elements specially - only process x-qere, skip x-accent
              if (key === 'rdg') {
                const rdgValue = value as Record<string, unknown> | Record<string, unknown>[];
                const rdgArray = Array.isArray(rdgValue) ? rdgValue : [rdgValue];
                for (const rdg of rdgArray) {
                  if (rdg && typeof rdg === 'object') {
                    const rdgType = (rdg as Record<string, unknown>)['@_type'] as string | undefined;
                    // Only process x-qere readings (skip x-accent which are just accent variants)
                    if (rdgType === 'x-qere') {
                      const prevIsInsideQere = isInsideQere;
                      isInsideQere = true;
                      extractWords(rdg);
                      isInsideQere = prevIsInsideQere;
                    }
                  }
                }
                continue;
              }
              // Skip note elements but process their rdg children above
              if (key === 'note') {
                const noteValue = value as Record<string, unknown> | Record<string, unknown>[];
                const noteArray = Array.isArray(noteValue) ? noteValue : [noteValue];
                for (const note of noteArray) {
                  if (note && typeof note === 'object') {
                    // Process rdg inside note
                    const noteObj = note as Record<string, unknown>;
                    if (noteObj['rdg']) {
                      const rdgValue = noteObj['rdg'] as Record<string, unknown> | Record<string, unknown>[];
                      const rdgArray = Array.isArray(rdgValue) ? rdgValue : [rdgValue];
                      for (const rdg of rdgArray) {
                        if (rdg && typeof rdg === 'object') {
                          const rdgType = (rdg as Record<string, unknown>)['@_type'] as string | undefined;
                          if (rdgType === 'x-qere') {
                            const prevIsInsideQere = isInsideQere;
                            isInsideQere = true;
                            extractWords(rdg);
                            isInsideQere = prevIsInsideQere;
                          }
                        }
                      }
                    }
                  }
                }
                continue;
              }
              if (!key.startsWith('@_') && key !== '#text') {
                extractWords(value);
              }
            }
          }
        }

        for (const [key, value] of Object.entries(record)) {
          if (!key.startsWith('@_')) {
            extractWords(value);
          }
        }

        if (words.length > 0) {
          const text = words.map(w => w.text).join(' ');

          results.push({
            book,
            chapter: parseInt(chap, 10),
            number: parseInt(num, 10),
            text,
            words,
          });
        }
      }
    }

    for (const value of Object.values(record)) {
      findVerses(value, results);
    }
  }

  findVerses(doc, verses);
  return verses;
}

/**
 * Check if a word is a textual critical note rather than actual scripture.
 * These notes compare manuscript variants and have no lemma, no morphology,
 * and no Hebrew letters (non-Hebrew text like "We read one or more accents in L differently than BHS").
 */
function isTextualCriticalNote(w: ParsedVerse['words'][0]): boolean {
  if (w.lemma || w.morph) return false;
  // Check if text contains Hebrew letters (U+0590-U+05FF range)
  const hasHebrew = /[\u0590-\u05FF]/.test(w.text);
  return !hasHebrew;
}

/**
 * Check if a word is a paragraph marker (parashah marker) rather than actual scripture.
 * פ (pe) = petuchah (open paragraph), ס (samekh) = setumah (closed paragraph)
 */
function isParagraphMarker(w: ParsedVerse['words'][0]): boolean {
  return !w.lemma && !w.morph && (w.text === 'פ' || w.text === 'ס');
}

async function saveVerse(verse: ParsedVerse): Promise<void> {
  const verseDir = join(DATA_DIR, verse.book, String(verse.chapter));
  await mkdir(verseDir, { recursive: true });

  // Filter out textual critical notes and paragraph markers, renumber positions
  const filteredWords: WordEntry[] = [];
  let position = 1;
  for (const w of verse.words) {
    if (isTextualCriticalNote(w)) continue;
    if (isParagraphMarker(w)) continue;

    const metadata: Record<string, unknown> = { ...w.metadata };
    if (w.lemma && !/\d/.test(w.lemma)) {
      metadata.isPrefixOnly = true;
    }

    filteredWords.push({
      position: position++,
      text: w.text,
      lemma: w.lemma,
      morph: w.morph,
      strongs: w.strongs,
      variant: w.variant,
      metadata,
      source: w.source,
    });
  }
  const wordEntries = filteredWords;

  // Rebuild text from filtered words (excludes textual critical notes)
  const text = wordEntries.map(w => w.text).join(' ');

  const data: VerseData = {
    text,
    words: wordEntries,
  };

  const filePath = join(verseDir, `${verse.number}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function saveMetadata(): Promise<void> {
  const metadata = {
    abbreviation: 'OHB',
    name: 'Open Scriptures Hebrew Bible',
    language: 'Hebrew',
    license: 'CC BY 4.0',
    source: 'Open Scriptures',
    urls: ['https://github.com/openscriptures/morphhb'],
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    join(DATA_DIR, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8'
  );
}

async function main(): Promise<void> {
  console.log('OpenScriptures MorphHB Importer');
  console.log('===============================\n');

  try {
    await mkdir(SOURCE_DIR, { recursive: true });

    console.log(`  → Downloading ${BOOKS.length} books...`);
    let totalVerses = 0;

    for (let i = 0; i < BOOKS.length; i++) {
      const bookName = BOOKS[i];
      const bookId = bookName.replace('.xml', '');

      if ((i + 1) % 5 === 1 || i === BOOKS.length - 1) {
        console.log(`  → Processing ${i + 1}/${BOOKS.length}: ${bookId}`);
      }

      const xml = await downloadBook(bookName);
      const verses = parseOsis(xml);

      for (const verse of verses) {
        await saveVerse(verse);
        totalVerses++;
      }
    }

    await saveMetadata();

    console.log(`\n✓ Successfully imported ${totalVerses} verses to ${DATA_DIR}`);
  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  }
}

main();
