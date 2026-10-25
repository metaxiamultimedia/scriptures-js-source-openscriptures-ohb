/**
 * Import script for OpenScriptures MorphHB (Hebrew Bible) data.
 *
 * Downloads individual book XML files from the MorphHB GitHub repository at
 * MORPHHB_COMMIT and converts to JSON format.
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

// openscriptures/morphhb commit the data is imported from (master head since
// 2024-08-27, "Merge pull request #92 from Clear-Bible/earlier-requests").
const MORPHHB_COMMIT = '3d15126fb1ef74867fc1434be1942e837932691f';
const BASE_URL = `https://raw.githubusercontent.com/openscriptures/morphhb/${MORPHHB_COMMIT}/wlc/`;

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

// Downloads are cached per commit, so a cache never outlives a pin change.
const SOURCE_DIR = join(ROOT_DIR, 'source', MORPHHB_COMMIT);
const DATA_DIR = join(ROOT_DIR, 'data', 'openscriptures-OHB');

// Special letters and extraordinary points come only from the WLC's own markup
// (<seg type="x-large|x-small|x-suspended"> inside a <w>; U+05C4/U+05C5 in the
// word text). Marks of the Masoretic tradition that the WLC does not carry are
// not part of this package; @metaxia/scriptures has cited tables of them
// (data/masoretic-marks/).

const STRONGS_RE =/(?:strongs?:)?([HGhg]?\d{1,5})/g;

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

/**
 * The marks the WLC writes between words, each a <seg> outside any <w>:
 * maqaf (־ x-maqqef), paseq (׀ x-paseq), sof pasuq (׃ x-sof-pasuq), the
 * paragraph divisions petuchah (פ x-pe) and setumah (ס x-samekh), and the
 * reversed nun (׆ x-reversednun).
 */
type MarkType = 'maqaf' | 'paseq' | 'sof-pasuq' | 'petuchah' | 'setumah' | 'reversed-nun';

const MARK_BY_SEG: Record<string, MarkType> = {
  'x-maqqef': 'maqaf',
  'x-paseq': 'paseq',
  'x-sof-pasuq': 'sof-pasuq',
  'x-pe': 'petuchah',
  'x-samekh': 'setumah',
  'x-reversednun': 'reversed-nun',
};

/**
 * One item of `metadata.sequence`: the verse's words and marks in the order of
 * the WLC XML. A word item points into `words[]` by `position`. A mark item is
 * the mark itself and belongs to no word, ketiv or qere. `reading` says which
 * reading a mark inside a ketiv/qere is part of: 'qere' = inside the qere
 * (<note><rdg type="x-qere">), e.g. the paseq between הֵם and פְּרוּצִים in
 * Neh 2:13 or the maqaf of מַה־זֶּה in Exod 4:2; 'ketiv' = between two ketiv
 * words (<seg subType="x-ketiv">), e.g. the maqaf of מי־לי in Isa 52:5.
 */
type SequenceItem =
  | { kind: 'word'; position: number }
  | { kind: 'mark'; type: MarkType; text: string; reading?: 'ketiv' | 'qere' };

interface VerseData {
  text: string;
  words: WordEntry[];
  metadata: {
    sequence: SequenceItem[];
  };
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
  /**
   * Always `leningrad`: the letter is marked in the WLC itself. Since 3.0.0
   * there are no other entries (see SPECIAL_START).
   */
  tradition: 'leningrad';
  /** Always 'WLC / OpenScriptures'. */
  source: string;
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
        // These come from the WLC manuscript's own markup (the Leningrad tradition).
        specials.push({
          type: current.type,
          char: current.char,
          index: current.index,
          tradition: 'leningrad',
          source: 'WLC / OpenScriptures',
        });
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

// Extraordinary points (puncta extraordinaria). The WLC marks the traditional
// fifteen dotted passages with combining dots placed on the letters: HEBREW
// MARK UPPER DOT (U+05C4) above and HEBREW MARK LOWER DOT (U+05C5) below. These
// ride in the word text as ordinary combining marks (so they never affect
// gematria — the engine sums only base consonants U+05D0–U+05EA — nor word
// counts), but they are not otherwise surfaced. extractPoints() reads them off
// the finished word text and records which base consonant each dot sits on
// (0-based consonant index, same convention as special letters), so a renderer
// can show them without re-scanning for combining marks. The dots are left in
// `text`, faithful to the source. A dot belongs to the base consonant that
// precedes it in the text, as for any combining mark; in Gen 19:33 and Num 29:15
// the WLC text places the dot after the consonant before the vav (קׄוּ, רׄוֹ),
// so those are recorded on ק and ר.
const PUNCTUM_UPPER = 'ׄ';
const PUNCTUM_LOWER = 'ׅ';

interface ExtraordinaryPoint {
  /** 0-based index of the dotted base consonant among the word's consonants. */
  index: number;
  /** The dotted base consonant. */
  char: string;
  /** Dot position: above (U+05C4) or below (U+05C5) the letter. */
  mark: 'upper' | 'lower';
  /** Always `leningrad`: the dot is in the WLC text itself. */
  tradition: 'leningrad';
  /** Always 'WLC / OpenScriptures'. */
  source: string;
}

function extractPoints(word: string): ExtraordinaryPoint[] {
  if (!word.includes(PUNCTUM_UPPER) && !word.includes(PUNCTUM_LOWER)) return [];
  const points: ExtraordinaryPoint[] = [];
  let consonantIdx = -1;
  let currentConsonant = '';
  for (const ch of word) {
    const cp = ch.codePointAt(0)!;
    if (isHebrewConsonant(cp)) {
      consonantIdx++;
      currentConsonant = ch;
    } else if (ch === PUNCTUM_UPPER || ch === PUNCTUM_LOWER) {
      points.push({
        index: consonantIdx,
        char: currentConsonant,
        mark: ch === PUNCTUM_UPPER ? 'upper' : 'lower',
        tradition: 'leningrad',
        source: 'WLC / OpenScriptures',
      });
    }
  }
  return points;
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

/** A word or a mark of one verse, in WLC XML order, before positions are final. */
type RawItem =
  | { kind: 'w'; ord: number }
  | { kind: 'mark'; type: MarkType; text: string; reading?: 'ketiv' | 'qere' };

interface ParsedVerse {
  book: string;
  chapter: number;
  number: number;
  text: string;
  /** Transient: the verse's <w> elements and marks in XML order (see readSequence). */
  items: RawItem[];
  words: Array<{
    position: number;
    /** Transient: document order of the source <w> (see parseOsis). */
    ord?: number;
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

/**
 * Put a verse's words back in WLC document order (by `ord`, the <w> number set
 * in parseOsis) and renumber `position`. A word without `ord` (bare text outside
 * a <w>) keeps its place after the word extracted before it. `ord` is kept: the
 * verse sequence is built from it at save time.
 */
function restoreDocumentOrder(words: ParsedVerse['words']): void {
  let last = -1;
  const keyed = words.map((w, i) => {
    const k = w.ord !== undefined ? w.ord : last + 0.5;
    last = k;
    return { w, k, i };
  });
  keyed.sort((a, b) => a.k - b.k || a.i - b.i);
  for (let i = 0; i < keyed.length; i++) {
    words[i] = keyed[i].w;
    words[i].position = i + 1;
  }
}

/**
 * Read one verse's <w> elements and inter-word marks in XML order. Walks the
 * tags of the verse body (after the data-ord numbering and the special-letter
 * pass, so the only <seg>s left are the marks):
 *   - <w>: a word, by its data-ord number;
 *   - <seg> outside a <w>: a mark (MARK_BY_SEG), with its text as written;
 *     subType="x-ketiv" (a maqaf between two ketiv words) gives reading: 'ketiv';
 *   - <note type="variant"><rdg type="x-qere">: the qere reading. Its words and
 *     marks are read in place, and its marks get reading: 'qere';
 *   - the catchWord (a copy of the ketiv), <rdg type="x-accent"> (alternative
 *     accents of words already read) and every other <note> (editorial notes)
 *     are skipped, as the word extraction skips them.
 * An unknown <seg> type fails the import rather than being dropped.
 */
function readSequence(body: string, where: string): RawItem[] {
  const items: RawItem[] = [];
  const stack: Array<{ name: string; skip: boolean; qere: boolean; inW: boolean }> = [];
  const tagRe = /<(\/?)([A-Za-z]+)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(body))) {
    const [, close, name, attrs, selfClose] = m;
    if (close) {
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`${where}: unbalanced </${name}>`);
      continue;
    }
    const parent = stack[stack.length - 1] ?? { skip: false, qere: false, inW: false };
    const type = /\btype="([^"]*)"/.exec(attrs)?.[1];
    let { skip, qere, inW } = parent;
    if (name === 'note') {
      if (type !== 'variant') skip = true;
    } else if (name === 'catchWord') {
      skip = true;
    } else if (name === 'rdg') {
      if (type === 'x-qere') qere = true;
      else skip = true;
    } else if (name === 'w') {
      if (!skip) {
        const ord = /data-ord="(\d+)"/.exec(attrs);
        if (!ord) throw new Error(`${where}: <w> without data-ord`);
        items.push({ kind: 'w', ord: Number(ord[1]) });
      }
      inW = true;
    } else if (name === 'seg' && !skip && !inW) {
      const mark = type ? MARK_BY_SEG[type] : undefined;
      if (!mark) throw new Error(`${where}: unknown <seg type="${type}">`);
      const end = body.indexOf('</seg>', tagRe.lastIndex);
      items.push({
        kind: 'mark',
        type: mark,
        text: body.slice(tagRe.lastIndex, end),
        ...(qere
          ? { reading: 'qere' as const }
          : /\bsubType="x-ketiv"/.test(attrs)
            ? { reading: 'ketiv' as const }
            : {}),
      });
    }
    if (!selfClose) stack.push({ name, skip, qere, inW });
  }
  if (stack.length) throw new Error(`${where}: unclosed <${stack[stack.length - 1].name}>`);
  return items;
}

function parseOsis(xml: string): ParsedVerse[] {
  // Number every <w> in document order (data-ord) before parsing. The parse is
  // not order-preserving: fast-xml-parser groups a verse's children by tag, so
  // the qere words (inside <note><rdg type="x-qere">) were emitted after all of
  // the verse's <w> children, or before them, instead of right after the ketiv
  // they belong to (e.g. Neh 2:13 הם פרוצים landed at the end of the verse, Isa
  // 9:6 למרבה before its ketiv לם רבה). Sorting the extracted words by this
  // number restores the WLC reading order: each qere follows its ketiv, and a
  // qere without ketiv (Ruth 3:5 אלי) sits where the WLC places it.
  let ord = 0;
  xml = xml.replace(/<w\b/g, () => `<w data-ord="${ord++}"`);

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

  // The marks between words (maqaf, paseq, sof pasuq, petuchah, setumah,
  // reversed nun) are read straight from the XML text, in order, per verse
  // (readSequence); the order-losing parse below skips them.
  const sequences = new Map<string, RawItem[]>();
  for (const vm of xml.matchAll(/<verse osisID="([^"]+)">([\s\S]*?)<\/verse>/g)) {
    sequences.set(vm[1], readSequence(vm[2], vm[1]));
  }

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
                const points = extractPoints(word);
                const wordMeta: Record<string, unknown> = {};
                if (specials.length > 0) wordMeta.specialLetters = specials;
                if (points.length > 0) wordMeta.points = points;
                words.push({
                  position: pos++,
                  text: word,
                  lemma: null,
                  morph: null,
                  metadata: wordMeta,
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
                  const points = extractPoints(piece);

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
                    ord: elem['@_data-ord'] !== undefined ? Number(elem['@_data-ord']) : undefined,
                    text: piece,
                    lemma: lemma || null,
                    morph: morph || null,
                    strongs: strongs.length > 0 ? strongs : undefined,
                    variant,
                    metadata:
                      specials.length > 0 || points.length > 0
                        ? {
                            ...(specials.length > 0 ? { specialLetters: specials } : {}),
                            ...(points.length > 0 ? { points } : {}),
                          }
                        : undefined,
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

        restoreDocumentOrder(words);

        if (words.length > 0) {
          const text = words.map(w => w.text).join(' ');
          const items = sequences.get(osisId);
          if (!items) throw new Error(`${osisId}: verse body not found for its sequence`);

          results.push({
            book,
            chapter: parseInt(chap, 10),
            number: parseInt(num, 10),
            text,
            items,
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
  const positionsByOrd = new Map<number, number[]>();
  let position = 1;
  for (const w of verse.words) {
    if (isTextualCriticalNote(w)) continue;
    if (isParagraphMarker(w)) continue;

    const metadata: Record<string, unknown> = { ...w.metadata };
    if (w.lemma && !/\d/.test(w.lemma)) {
      metadata.isPrefixOnly = true;
    }

    const finalPosition = position++;
    if (w.ord !== undefined) {
      const list = positionsByOrd.get(w.ord) ?? [];
      list.push(finalPosition);
      positionsByOrd.set(w.ord, list);
    }

    filteredWords.push({
      position: finalPosition,
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

  // The verse sequence: every word (by position) and every mark, in XML order.
  // Each word must appear exactly once and in position order; anything else
  // means the sequence and words[] disagree, so the import fails.
  const sequence: SequenceItem[] = [];
  for (const item of verse.items) {
    if (item.kind === 'w') {
      for (const p of positionsByOrd.get(item.ord) ?? []) sequence.push({ kind: 'word', position: p });
    } else {
      sequence.push({
        kind: 'mark',
        type: item.type,
        text: item.text,
        ...(item.reading ? { reading: item.reading } : {}),
      });
    }
  }
  const seen = sequence.flatMap(i => (i.kind === 'word' ? [i.position] : []));
  if (seen.length !== wordEntries.length || seen.some((p, i) => p !== i + 1)) {
    throw new Error(
      `${verse.book} ${verse.chapter}:${verse.number}: sequence words ${seen.join(',')} do not match words 1..${wordEntries.length}`
    );
  }

  const data: VerseData = {
    text,
    words: wordEntries,
    metadata: { sequence },
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
