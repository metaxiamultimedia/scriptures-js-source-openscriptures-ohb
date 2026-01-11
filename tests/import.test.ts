/**
 * Tests for the import script parsing logic
 */

import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';

// Simplified types for testing
interface WordEntry {
  position: number;
  text: string;
  lemma: string | null;
  morph: string | null;
  strongs?: string[];
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
 * Parse OSIS XML using the fixed logic
 */
function parseOsis(xml: string): ParsedVerse[] {
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
              const elemType = elem['@_type'] as string | undefined;

              // Skip <seg> elements with specific types (paragraph markers and punctuation)
              // But do NOT skip <w> elements with type="x-ketiv" - they are valid words
              if (elemType && !elemType.startsWith('x-ketiv')) {
                // Skip segment types like x-pe, x-samekh, x-sof-pasuq, x-maqqef, etc.
                if (elemType.startsWith('x-')) {
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

            for (const [key, value] of Object.entries(elem)) {
              // Skip note elements and their children entirely
              if (key === 'note' || key === 'catchWord' || key === 'rdg') {
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

describe('import script parsing', () => {
  it('should extract ketiv words with their lemma (not skip them)', () => {
    // Simulate Genesis 8:17 ketiv/qere structure
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <verse osisID="Gen.8.17">
      <w lemma="3605" morph="HNcmsc">כָּל</w>
      <w type="x-ketiv" lemma="3318" morph="HVhv2ms">הוצא</w>
      <note type="variant">
        <catchWord>הוצא</catchWord>
        <rdg type="x-qere">
          <w lemma="3318" morph="HVhv2ms">הַיְצֵא</w>
        </rdg>
      </note>
    </verse>`;

    const verses = parseOsis(xml);
    expect(verses).toHaveLength(1);

    const verse = verses[0];
    expect(verse.words).toHaveLength(2);

    // First word should be כָּל with lemma
    expect(verse.words[0].text).toBe('כָּל');
    expect(verse.words[0].lemma).toBe('3605');

    // Second word should be the ketiv with its lemma (not null!)
    expect(verse.words[1].text).toBe('הוצא');
    expect(verse.words[1].lemma).toBe('3318');
    expect(verse.words[1].morph).toBe('HVhv2ms');
  });

  it('should not extract duplicate words from alternative accent notes', () => {
    // Simulate Exodus 20:2 alternative accent structure
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <verse osisID="Exod.20.2">
      <w lemma="595" morph="HPp1cs">אָנֹכִי</w>
      <note type="alternative">
        <catchWord>אָנֹכִי</catchWord>
        <rdg type="x-accent">אָנֹכִי</rdg>
      </note>
      <w lemma="3068" morph="HNp">יְהוָה</w>
      <w lemma="430" morph="HNcmpc/Sp2ms">אֱלֹהֶיךָ</w>
    </verse>`;

    const verses = parseOsis(xml);
    expect(verses).toHaveLength(1);

    const verse = verses[0];
    // Should only have 3 words, not duplicates from the note
    expect(verse.words).toHaveLength(3);

    // All words should have lemmas
    expect(verse.words[0].text).toBe('אָנֹכִי');
    expect(verse.words[0].lemma).toBe('595');

    expect(verse.words[1].text).toBe('יְהוָה');
    expect(verse.words[1].lemma).toBe('3068');

    expect(verse.words[2].text).toBe('אֱלֹהֶיךָ');
    expect(verse.words[2].lemma).toBe('430');

    // No words should have null lemma
    const nullLemmaWords = verse.words.filter(w => w.lemma === null);
    expect(nullLemmaWords).toHaveLength(0);
  });

  it('should skip segment types like x-sof-pasuq', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <verse osisID="Gen.1.1">
      <w lemma="7225" morph="HNcfsa">בְּרֵאשִׁית</w>
      <seg type="x-sof-pasuq">׃</seg>
    </verse>`;

    const verses = parseOsis(xml);
    expect(verses).toHaveLength(1);

    const verse = verses[0];
    expect(verse.words).toHaveLength(1);
    expect(verse.words[0].text).toBe('בְּרֵאשִׁית');
  });

  it('should handle variant notes without extracting qere as separate word', () => {
    // Only ketiv should be extracted when skipping notes
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <verse osisID="Test.1.1">
      <w lemma="1234" morph="HNcmsa">word1</w>
      <w type="x-ketiv" lemma="5678" morph="HVqp3ms">ketiv</w>
      <note type="variant">
        <catchWord>ketiv</catchWord>
        <rdg type="x-qere">
          <w lemma="5678" morph="HVqp3ms">qere</w>
        </rdg>
      </note>
      <w lemma="9012" morph="HNcfsa">word2</w>
    </verse>`;

    const verses = parseOsis(xml);
    expect(verses).toHaveLength(1);

    const verse = verses[0];
    // Should have: word1, ketiv, word2 (qere skipped as it's in a note)
    expect(verse.words).toHaveLength(3);

    expect(verse.words[0].text).toBe('word1');
    expect(verse.words[0].lemma).toBe('1234');

    expect(verse.words[1].text).toBe('ketiv');
    expect(verse.words[1].lemma).toBe('5678');

    expect(verse.words[2].text).toBe('word2');
    expect(verse.words[2].lemma).toBe('9012');
  });
});
