/**
 * Source configuration and data loading for openscriptures-OHB.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile, readdir } from 'fs/promises';
import type { EditionMetadata, VerseData } from '@metaxia/scriptures-core';

// Resolve paths relative to this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '..', 'data', 'openscriptures-OHB');
const CACHE_PATH = join(__dirname, '..', 'cache');

/**
 * Edition metadata.
 */
export const metadata: EditionMetadata = {
  abbreviation: 'openscriptures-OHB',
  name: 'Open Scriptures Hebrew Bible',
  language: 'Hebrew',
  license: 'CC BY 4.0',
  source: 'Open Scriptures Hebrew Bible Project',
  urls: ['https://github.com/openscriptures/morphhb'],
};

/**
 * Source information for registration.
 */
export const sourceInfo = {
  edition: 'openscriptures-OHB',
  metadata,
  dataPath: DATA_PATH,
  cachePath: CACHE_PATH,
};

/**
 * Hebrew Bible book name to OSIS mapping.
 */
const BOOK_TO_OSIS: Record<string, string> = {
  'Genesis': 'Gen', 'Exodus': 'Exod', 'Leviticus': 'Lev', 'Numbers': 'Num',
  'Deuteronomy': 'Deut', 'Joshua': 'Josh', 'Judges': 'Judg', 'Ruth': 'Ruth',
  '1 Samuel': '1Sam', '2 Samuel': '2Sam', '1 Kings': '1Kgs', '2 Kings': '2Kgs',
  '1 Chronicles': '1Chr', '2 Chronicles': '2Chr', 'Ezra': 'Ezra', 'Nehemiah': 'Neh',
  'Esther': 'Esth', 'Job': 'Job', 'Psalms': 'Ps', 'Proverbs': 'Prov',
  'Ecclesiastes': 'Eccl', 'Song of Solomon': 'Song', 'Isaiah': 'Isa', 'Jeremiah': 'Jer',
  'Lamentations': 'Lam', 'Ezekiel': 'Ezek', 'Daniel': 'Dan', 'Hosea': 'Hos',
  'Joel': 'Joel', 'Amos': 'Amos', 'Obadiah': 'Obad', 'Jonah': 'Jonah',
  'Micah': 'Mic', 'Nahum': 'Nah', 'Habakkuk': 'Hab', 'Zephaniah': 'Zeph',
  'Haggai': 'Hag', 'Zechariah': 'Zech', 'Malachi': 'Mal',
};

/**
 * Convert book name to directory name (OSIS format).
 */
function toOsis(book: string): string {
  return BOOK_TO_OSIS[book] || book;
}

/**
 * Load a single verse.
 */
export async function loadVerse(book: string, chapter: number, verse: number): Promise<VerseData> {
  const osisBook = toOsis(book);
  const filePath = join(DATA_PATH, osisBook, String(chapter), `${verse}.json`);

  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Verse ${book} ${chapter}:${verse} not found in openscriptures-OHB`);
  }
}

/**
 * Load all verses in a chapter.
 */
export async function loadChapter(book: string, chapter: number): Promise<VerseData[]> {
  const osisBook = toOsis(book);
  const chapterPath = join(DATA_PATH, osisBook, String(chapter));

  try {
    const files = await readdir(chapterPath);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort((a, b) => {
      const numA = parseInt(a.replace('.json', ''), 10);
      const numB = parseInt(b.replace('.json', ''), 10);
      return numA - numB;
    });

    const verses: VerseData[] = [];
    for (const file of jsonFiles) {
      const content = await readFile(join(chapterPath, file), 'utf-8');
      verses.push(JSON.parse(content));
    }
    return verses;
  } catch (error) {
    throw new Error(`Chapter ${book} ${chapter} not found in openscriptures-OHB`);
  }
}

/**
 * Load cache data.
 */
export async function loadCache(cacheName: string): Promise<Record<string, unknown>> {
  const filePath = join(CACHE_PATH, `${cacheName}.json`);

  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Cache '${cacheName}' not found`);
  }
}

/**
 * List available books (Old Testament only).
 */
export function listBooks(): string[] {
  return Object.keys(BOOK_TO_OSIS);
}
