/**
 * Tests for the import script parsing logic
 *
 * These tests verify that:
 * 1. The current data has null lemmas (documenting the bug)
 * 2. The parsing logic correctly handles ketiv/qere variants
 * 3. Alternative accent notes don't create duplicate words
 */

import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Simplified types for testing
interface WordEntry {
  position: number;
  text: string;
  lemma: string | null;
  morph: string | null;
  strongs?: string[];
  metadata?: Record<string, unknown>;
}

interface ParsedVerse {
  book: string;
  chapter: number;
  number: number;
  text: string;
  words: WordEntry[];
}

// Hebrew maqqef character (U+05BE)
const MAQQEF = '\u05BE';

function removeCantillation(text: string): string {
  return text.replace(/[\u0591-\u05AF\u05BD\u05BF\u05C0\u05C3\u05C6]/g, '');
}

const STRONGS_RE = /(?:strongs?:)?([HGhg]?\d{3,5})/g;

function extractStrongs(value: string | null): string[] {
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
    const digits = token.match(/\d{3,5}/);
    if (!digits) continue;
    if (!prefix) prefix = 'H';
    results.push(`${prefix}${parseInt(digits[0], 10)}`);
  }
  return results;
}

/**
 * OLD BROKEN LOGIC - for comparison testing
 * This is how the parser worked BEFORE the fix
 */
function parseOsisBroken(xml: string): ParsedVerse[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    preserveOrder: false,
    trimValues: false,
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

    if (record['@_osisID'] && typeof record['@_osisID'] === 'string') {
      const osisId = record['@_osisID'];
      const parts = osisId.split('.');
      if (parts.length === 3) {
        const [book, chap, num] = parts;
        const words: WordEntry[] = [];
        let pos = 1;

        function extractWords(content: unknown): void {
          if (!content) return;

          if (typeof content === 'string') {
            const cleanText = removeCantillation(content.replace(/\//g, '').trim());
            if (cleanText) {
              for (const word of cleanText.split(/\s+/).filter(Boolean)) {
                if (word === MAQQEF) continue;
                words.push({
                  position: pos++,
                  text: word,
                  lemma: null,
                  morph: null,
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
              // OLD BUG: Skip ALL elements with @_type, including x-ketiv
              if (elem['@_type']) {
                return;
              }

              const rawText = String(elem['#text']);
              const text = removeCantillation(rawText.replace(/\//g, '')).trim();
              const lemma = elem['@_lemma'] as string | undefined;
              const morph = elem['@_morph'] as string | undefined;

              if (text) {
                const strongs = extractStrongs(lemma || null);
                for (const piece of text.split(/\s+/).filter(Boolean)) {
                  if (piece === MAQQEF) continue;
                  words.push({
                    position: pos++,
                    text: piece,
                    lemma: lemma || null,
                    morph: morph || null,
                    strongs: strongs.length > 0 ? strongs : undefined,
                  });
                }
              }
            }

            // OLD BUG: Recurse into ALL children including note/catchWord/rdg
            for (const [key, value] of Object.entries(elem)) {
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
 * NEW FIXED LOGIC - extracts ketiv/qere with proper metadata
 * This mirrors the actual import.ts logic
 */
function parseOsisFixed(xml: string): ParsedVerse[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    preserveOrder: false,
    trimValues: false,
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

    if (record['@_osisID'] && typeof record['@_osisID'] === 'string') {
      const osisId = record['@_osisID'];
      const parts = osisId.split('.');
      if (parts.length === 3) {
        const [book, chap, num] = parts;
        const words: WordEntry[] = [];
        let pos = 1;
        let isInsideQere = false;

        function processRdg(rdgValue: unknown): void {
          if (!rdgValue) return;
          const rdgArray = Array.isArray(rdgValue) ? rdgValue : [rdgValue];
          for (const rdg of rdgArray) {
            if (rdg && typeof rdg === 'object') {
              const rdgObj = rdg as Record<string, unknown>;
              const rdgType = rdgObj['@_type'] as string | undefined;
              // Only process x-qere readings (skip x-accent)
              if (rdgType === 'x-qere') {
                const prevIsInsideQere = isInsideQere;
                isInsideQere = true;
                extractWords(rdg);
                isInsideQere = prevIsInsideQere;
              }
            }
          }
        }

        function extractWords(content: unknown): void {
          if (!content) return;

          if (typeof content === 'string') {
            const cleanText = removeCantillation(content.replace(/\//g, '').trim());
            if (cleanText) {
              for (const word of cleanText.split(/\s+/).filter(Boolean)) {
                if (word === MAQQEF) continue;
                words.push({
                  position: pos++,
                  text: word,
                  lemma: null,
                  morph: null,
                  metadata: {},
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

              // FIX: Only skip segment types, NOT x-ketiv or x-qere
              if (elemType && elemType.startsWith('x-')) {
                // Allow ketiv and qere types through
                if (elemType !== 'x-ketiv' && elemType !== 'x-qere') {
                  return;
                }
              }

              const rawText = String(elem['#text']);
              const text = removeCantillation(rawText.replace(/\//g, '')).trim();
              const lemma = elem['@_lemma'] as string | undefined;
              const morph = elem['@_morph'] as string | undefined;

              if (text) {
                const strongs = extractStrongs(lemma || null);
                for (const piece of text.split(/\s+/).filter(Boolean)) {
                  if (piece === MAQQEF) continue;

                  // Build metadata for ketiv/qere variants
                  const metadata: Record<string, unknown> = {};
                  if (elemType === 'x-ketiv') {
                    metadata.isKetiv = true;
                  }
                  if (isInsideQere) {
                    metadata.isQere = true;
                  }

                  words.push({
                    position: pos++,
                    text: piece,
                    lemma: lemma || null,
                    morph: morph || null,
                    strongs: strongs.length > 0 ? strongs : undefined,
                    metadata,
                  });
                }
              }
            }

            for (const [key, value] of Object.entries(elem)) {
              // Skip catchWord (redundant copy of ketiv text)
              if (key === 'catchWord') {
                continue;
              }
              // Handle rdg elements specially
              if (key === 'rdg') {
                processRdg(value);
                continue;
              }
              // Process note's rdg children but skip other note content
              if (key === 'note') {
                const noteArray = Array.isArray(value) ? value : [value];
                for (const note of noteArray) {
                  if (note && typeof note === 'object') {
                    const noteObj = note as Record<string, unknown>;
                    if (noteObj['rdg']) {
                      processRdg(noteObj['rdg']);
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

// Sample XML representing Genesis 8:17 ketiv/qere pattern
const KETIV_QERE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<verse osisID="Gen.8.17">
  <w lemma="3605" morph="HNcmsc">כָּל</w>
  <w type="x-ketiv" lemma="3318" morph="HVhv2ms">הוצא</w>
  <note type="variant">
    <catchWord>הוצא</catchWord>
    <rdg type="x-qere">
      <w lemma="3318" morph="HVhv2ms">הַיְצֵא</w>
    </rdg>
  </note>
  <w lemma="854" morph="HR/Sp2fs">אִתָּךְ</w>
</verse>`;

// Sample XML representing Exodus 20:2 alternative accent pattern
const ALTERNATIVE_ACCENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<verse osisID="Exod.20.2">
  <w lemma="595" morph="HPp1cs">אָנֹכִי</w>
  <note type="alternative">
    <catchWord>אָנֹכִי</catchWord>
    <rdg type="x-accent">אָנֹכִי</rdg>
  </note>
  <w lemma="3068" morph="HNp">יְהוָה</w>
  <w lemma="430" morph="HNcmpc/Sp2ms">אֱלֹהֶיךָ</w>
  <note type="alternative">
    <catchWord>אֱלֹהֶיךָ</catchWord>
    <rdg type="x-accent">אֱלֹהֶיךָ</rdg>
  </note>
</verse>`;

describe('import script parsing - old vs new behavior', () => {
  it('OLD LOGIC: skips ketiv element (type=x-ketiv)', () => {
    const verses = parseOsisBroken(KETIV_QERE_XML);
    expect(verses).toHaveLength(1);

    const verse = verses[0];

    // Old logic skips x-ketiv elements, so "הוצא" ketiv is missing its lemma
    // But it might still appear from catchWord extraction
    const ketivText = 'הוצא';
    const ketivWords = verse.words.filter(w => w.text === ketivText);

    // If ketiv is found, it should NOT have lemma (from catchWord)
    // or not be found at all (skipped)
    for (const w of ketivWords) {
      // Old logic would give null lemma from catchWord
      expect(w.lemma).toBeNull();
    }
  });

  it('FIXED LOGIC: extracts ketiv with lemma and metadata', () => {
    const verses = parseOsisFixed(KETIV_QERE_XML);
    expect(verses).toHaveLength(1);

    const verse = verses[0];

    // Find ketiv word
    const ketivWord = verse.words.find(w => w.metadata?.isKetiv === true);
    expect(ketivWord).toBeDefined();
    expect(ketivWord!.text).toBe('הוצא');
    expect(ketivWord!.lemma).toBe('3318'); // Has lemma now!
    expect(ketivWord!.morph).toBe('HVhv2ms');

    // Find qere word
    const qereWord = verse.words.find(w => w.metadata?.isQere === true);
    expect(qereWord).toBeDefined();
    expect(qereWord!.text).toBe('הַיְצֵא');
    expect(qereWord!.lemma).toBe('3318');
  });

  it('FIXED LOGIC: no duplicate words from alternative accent notes', () => {
    const verses = parseOsisFixed(ALTERNATIVE_ACCENT_XML);
    expect(verses).toHaveLength(1);

    const verse = verses[0];

    // Should only have 3 words, no duplicates from catchWord/rdg
    expect(verse.words).toHaveLength(3);

    // All words should have lemmas (no null lemma duplicates)
    const nullLemmaWords = verse.words.filter(w => w.lemma === null);
    expect(nullLemmaWords).toHaveLength(0);
  });

  it('FIXED LOGIC: skips segment types like x-sof-pasuq', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <verse osisID="Gen.1.1">
      <w lemma="7225" morph="HNcfsa">בְּרֵאשִׁית</w>
      <seg type="x-sof-pasuq">׃</seg>
    </verse>`;

    const verses = parseOsisFixed(xml);
    expect(verses).toHaveLength(1);

    const verse = verses[0];
    expect(verse.words).toHaveLength(1);
    expect(verse.words[0].text).toBe('בְּרֵאשִׁית');
  });

  it('FIXED LOGIC: users can filter by isKetiv/isQere metadata', () => {
    const verses = parseOsisFixed(KETIV_QERE_XML);
    const verse = verses[0];

    // Users can get only ketiv forms
    const ketivWords = verse.words.filter(w => w.metadata?.isKetiv);
    expect(ketivWords.length).toBeGreaterThan(0);

    // Users can get only qere forms
    const qereWords = verse.words.filter(w => w.metadata?.isQere);
    expect(qereWords.length).toBeGreaterThan(0);

    // Users can get only "standard" words (neither ketiv nor qere)
    const standardWords = verse.words.filter(
      w => !w.metadata?.isKetiv && !w.metadata?.isQere
    );
    expect(standardWords.length).toBeGreaterThan(0);
  });
});

describe('actual data verification - strict assertions', () => {
  it('Genesis 8:17 - should have NO null lemmas after fix', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '8', '17.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    const nullLemmaWords = data.words.filter(
      (w: { lemma: string | null }) => w.lemma === null
    );

    if (nullLemmaWords.length > 0) {
      console.log('FAIL: Genesis 8:17 still has null lemma words:',
        nullLemmaWords.map((w: { text: string; position: number }) => `pos ${w.position}: ${w.text}`)
      );
    }

    // STRICT: After re-import with fix, there should be NO null lemmas
    expect(nullLemmaWords).toHaveLength(0);
  });

  it('Genesis 8:17 - should have ketiv word with isKetiv metadata', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '8', '17.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Find ketiv word (הוצא - written form)
    const ketivWord = data.words.find(
      (w: { metadata?: { isKetiv?: boolean } }) => w.metadata?.isKetiv === true
    );

    expect(ketivWord).toBeDefined();
    expect(ketivWord.text).toBe('הוצא');
    expect(ketivWord.lemma).toBe('3318');
  });

  it('Genesis 8:17 - should have qere word with isQere metadata', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '8', '17.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Find qere word (הַיְצֵא - read form)
    const qereWord = data.words.find(
      (w: { metadata?: { isQere?: boolean } }) => w.metadata?.isQere === true
    );

    expect(qereWord).toBeDefined();
    expect(qereWord.text).toBe('הַיְצֵא');
    expect(qereWord.lemma).toBe('3318');
  });

  it('Exodus 20:2 - should have NO null lemmas after fix', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Exod', '20', '2.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    const nullLemmaWords = data.words.filter(
      (w: { lemma: string | null }) => w.lemma === null
    );

    if (nullLemmaWords.length > 0) {
      console.log('FAIL: Exodus 20:2 still has null lemma words:',
        nullLemmaWords.map((w: { text: string; position: number }) => `pos ${w.position}: ${w.text}`)
      );
    }

    // STRICT: After re-import with fix, there should be NO null lemmas
    expect(nullLemmaWords).toHaveLength(0);
  });

  it('Exodus 20:2 - should NOT have duplicate words from alternative notes', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Exod', '20', '2.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // The verse should have exactly 9 words (no duplicates from notes)
    // אָנֹכִי יְהוָה אֱלֹהֶיךָ אֲשֶׁר הוֹצֵאתִיךָ מֵאֶרֶץ מִצְרַיִם מִבֵּית עֲבָדִים
    expect(data.words.length).toBe(9);
  });
});
