# @metaxia/scriptures-source-openscriptures-ohb

Open Scriptures Hebrew Bible (Hebrew) data for [@metaxia/scriptures](https://github.com/metaxiamultimedia/scriptures-js).

## Source

[Open Scriptures Hebrew Bible Project](https://github.com/openscriptures/morphhb)

## Installation

```bash
npm install @metaxia/scriptures @metaxia/scriptures-source-openscriptures-ohb
```

## Usage

### Auto-Registration

```typescript
// Import to auto-register with @metaxia/scriptures
import '@metaxia/scriptures-source-openscriptures-ohb';

import { getVerse } from '@metaxia/scriptures';

const verse = await getVerse('Genesis', 1, 1, { edition: 'openscriptures-OHB' });
console.log(verse.text);
// "בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃"
```

### Granular Imports

Import specific portions for smaller bundle sizes:

```typescript
// Single verse
import verse from '@metaxia/scriptures-source-openscriptures-ohb/books/Genesis/1/1';

// Entire chapter
import chapter from '@metaxia/scriptures-source-openscriptures-ohb/books/Genesis/1';

// Entire book
import genesis from '@metaxia/scriptures-source-openscriptures-ohb/books/Genesis';

// Raw JSON data
import verseData from '@metaxia/scriptures-source-openscriptures-ohb/data/Genesis/1/1.json';

// Edition metadata
import metadata from '@metaxia/scriptures-source-openscriptures-ohb/metadata';
```

### Lazy Loading

```typescript
// Register without loading data
import '@metaxia/scriptures-source-openscriptures-ohb/register';

import { getVerse } from '@metaxia/scriptures';

// Data loads on demand
const verse = await getVerse('Genesis', 1, 1, { edition: 'openscriptures-OHB' });
```

## Contents

- **Edition**: openscriptures-OHB
- **Language**: Hebrew
- **Books**: 39 (Genesis–Malachi)
- **Features**: Morphological tagging, Strong's numbers, lemmas

## Data Format

Each verse includes morphological annotations:

```json
{
  "id": "openscriptures-OHB:Gen.1.1",
  "text": "בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃",
  "words": [
    {
      "position": 1,
      "text": "בְּרֵאשִׁית",
      "lemma": "רֵאשִׁית",
      "strong": "H7225",
      "morph": "HNcfsa"
    }
  ],
  "gematria": {
    "standard": 2701
  }
}
```

## Morphology Codes

This edition includes Hebrew morphology codes:

| Code | Meaning |
|------|---------|
| `H` | Hebrew |
| `N` | Noun |
| `V` | Verb |
| `c` | Common gender |
| `f` | Feminine |
| `m` | Masculine |
| `s` | Singular |
| `p` | Plural |

Use `parseMorphology()` from the main library to decode:

```typescript
import { parseMorphology } from '@metaxia/scriptures';

const parsed = parseMorphology('HVqp3ms');
// { language: 'Hebrew', partOfSpeech: 'verb', stem: 'qal', ... }
```

## License

CC BY 4.0

This data is licensed under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).

Attribution: Open Scriptures Hebrew Bible Project
