Shared preamble + frozen spec docs/specs/STAGE-8b-label-diagram.md, then:

# Task S8B-M6: contracts + figure loader for label-diagram-v1
1. kit.ts: add exactly the spec's types, `KIT_LIMITS.labelDiagram`, id 'label-diagram-v1' appended to KIT_COMPONENT_IDS and KIT_GEN_COMPONENT_IDS, schema file 'label-diagram.gen.json', body keys ['figureId','parts','hint'], LabelDiagramSpec in the unions, prefix 'LD', checks LD-01..LD-09 with the spec's names appended after DT-08 (header comment: 101 checks — 92 + 9), and `attachLabelRegions(spec, figure, regions): LabelDiagramSpec` (deep copies; never mutates). KIT_SCHEMA_VERSION stays '0.6.0'.
2. build-schemas.ts: a gen schema builder for label-diagram-v1 in the existing style (every key required; parts minItems/maxItems; integer coordinates documented as normalised 0..1000 with all-zero label box meaning 'no printed label'; field descriptions in plain words). Keep every existing line byte-identical (a previous edit accidentally corrupted an existing line — do not touch existing builders).
3. NEW tests/contracts.stage8b.test.ts: golden validates against the gen schema; golden quotes are exact spans of the source text; assembleKitSpec + attachLabelRegions produce the spec without mutating inputs; checkIdsFor('label-diagram-v1') returns 9 ids; schema rejects 2 parts and a missing key. (The lead updates the count pins in tests/contracts.stage6.test.ts mechanically: do not output that file.)
4. tests/fixtures/stage6/label-diagram.gen.json — hand-written golden for figure 'medlineplus-dna-structure-1' (meta below) on source 'medlineplus-what-is-dna' (text below). Parts and their positions (the lead measured the 600x600 image; normalised = pixel*1000/600): base pairs (point 283,475; printed label box 397,303-542,330), adenine (point 650,317; label 595,353-707,380), thymine (point 800,317; label 762,353-873,380), guanine (point 658,478; label 595,510-707,537), cytosine (point 800,478; label 762,510-880,537), sugar-phosphate backbone (point 358,683; label 508,672-697,733). Names must be whole phrases in their quotes (the page writes 'sugar-phosphate backbone' with a hyphen and 'adenine (A)' etc.). Quotes ≤ 150 chars, exact.
5. packages/sources/figures.ts (+ figures.test.ts): `FigureMeta` type (the Part 1 JSON fields), `listFigures(sourceId)`, `loadFigure(figureId)` reading data/figures relative to this file (mirror how packages/sources/index.ts locates data/sources), sha256 verify with node:crypto (this module is server-side; it may use node:fs/node:crypto/node:path), throws Error('FIGURE_NOT_FOUND') / Error('FIGURE_HASH_MISMATCH'). Tests: the DNA figure loads and hashes; listFigures('medlineplus-what-is-dna') contains it; unknown id throws; listFigures of a source without figures is [].

=== FIGURE META data/figures/medlineplus-dna-structure-1.json ===
```json
{
  "id": "medlineplus-dna-structure-1",
  "sourceId": "medlineplus-what-is-dna",
  "file": "medlineplus-dna-structure-1.jpg",
  "mime": "image/jpeg",
  "sha256": "84e5b887cdd3a12fc6b15d1fd0b85026384927492baeb86567a4c264cf7e78a9",
  "width": 600,
  "height": 600,
  "imageUrl": "https://medlineplus.gov/images/PX000098_PRESENTATION.jpeg",
  "pageUrl": "https://medlineplus.gov/genetics/understanding/basics/dna/",
  "caption": "DNA is a double helix formed by base pairs attached to a sugar-phosphate backbone.",
  "altText": "DNA is made up of base pairs and a sugar phosphate backbone.",
  "credit": "Credit: U.S. National Library of Medicine",
  "license": "U.S. Government work (U.S. National Library of Medicine), public domain",
  "licenseEvidence": "https://medlineplus.gov/about/using/usingcontent/ — \"Works produced by the federal government are not copyrighted under U.S. law. You may reproduce, redistribute, and link freely to non-copyrighted content, including on social media.\"; the same page lists among MedlinePlus's public-domain areas \"Summaries on Genetics pages, including health condition, gene, and chromosome pages and the Help Me Understand Genetics handbook\" and \"Illustrations with the 'U.S. National Library of Medicine' watermark and credit.\" This figure prints that credit inside the image and the page carries \"Credit: U.S. National Library of Medicine\". Retrieved 2026-10-31 (HTTP 200). The same page warns that Genetics-page images \"attributed to government agencies, other organizations, or individuals may be copyright protected\" and that unattributed images are licensed stock that may not be reproduced — neither applies here.",
  "labelsInImage": true,
  "retrievedAt": "2026-10-31T02:42:52Z"
}

```
=== LIBRARY SOURCE TEXT data/sources/medlineplus-what-is-dna.txt (sourceId medlineplus-what-is-dna) ===
````text
# What is DNA?

DNA, or deoxyribonucleic acid, is the hereditary material in humans and almost all other organisms. Nearly every cell in a person’s body has the same DNA. Most DNA is located in the cell nucleus (where it is called nuclear DNA), but a small amount of DNA can also be found in the mitochondria (where it is called mitochondrial DNA or mtDNA). Mitochondria are structures within cells that convert the energy from food into a form that cells can use.

The information in DNA is stored as a code made up of four chemical bases: adenine (A), guanine (G), cytosine (C), and thymine (T). Human DNA consists of about 3 billion bases, and more than 99 percent of those bases are the same in all people. The order, or sequence, of these bases determines the information available for building and maintaining an organism, similar to the way in which letters of the alphabet appear in a certain order to form words and sentences.

DNA bases pair up with each other, A with T and C with G, to form units called base pairs. Each base is also attached to a sugar molecule and a phosphate molecule. Together, a base, sugar, and phosphate are called a nucleotide. Nucleotides are arranged in two long strands that form a spiral called a double helix. The structure of the double helix is somewhat like a ladder, with the base pairs forming the ladder’s rungs and the sugar and phosphate molecules forming the vertical sidepieces of the ladder.

An important property of DNA is that it can replicate, or make copies of itself. Each strand of DNA in the double helix can serve as a pattern for duplicating the sequence of bases. This is critical when cells divide because each new cell needs to have an exact copy of the DNA present in the old cell.

DNA is a double helix formed by base pairs attached to a sugar-phosphate backbone.

````

(Followed by current files in full; omitted.)
