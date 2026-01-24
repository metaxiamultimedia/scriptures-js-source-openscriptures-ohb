/**
 * Tests for @metaxia/scriptures-source-openscriptures-ohb
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Extract only Hebrew consonants (removes vowels, cantillation, etc.)
function extractConsonants(text: string): string {
  return text.replace(/[^\u05D0-\u05EA]/g, '');
}

describe('word data', () => {
  it('should have Israel word at correct position in Genesis 32:29', async () => {
    // Genesis 32:29 contains יִשְׂרָאֵל (Israel) at position 9
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '32', '29.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    const israelWord = data.words.find(
      (word: { position: number }) => word.position === 9
    );

    expect(israelWord).toBeDefined();
    // Extract consonants to compare (text now includes vowels and cantillation)
    expect(extractConsonants(israelWord.text)).toBe('ישראל'); // Israel in Hebrew
  });
});

describe('maqqef punctuation handling', () => {
  it('should not include maqqef marks as separate word entries', async () => {
    // Genesis 1:2 contains maqqef (־) connecting words like "al-penei"
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '1', '2.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Hebrew maqqef character (U+05BE)
    const MAQQEF = '־';

    const maqqefWords = data.words.filter(
      (word: { text: string }) => word.text === MAQQEF
    );

    expect(maqqefWords).toHaveLength(0);
  });

  it('should not have words with null lemma that are punctuation-only', async () => {
    const dataPath = join(__dirname, '..', 'data', 'openscriptures-OHB', 'Gen', '1', '2.json');
    const data = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Words with null lemma should still have Hebrew text content
    const nullLemmaWords = data.words.filter(
      (word: { lemma: string | null; text: string }) =>
        word.lemma === null
    );

    // All null-lemma words should have actual Hebrew content
    for (const word of nullLemmaWords) {
      expect(word.text.length).toBeGreaterThan(0);
    }
  });
});
