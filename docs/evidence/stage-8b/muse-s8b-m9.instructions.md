# Task S8B-M9: label-diagram-v1 design text from the second live run (lead overlay of your points, label boxes and SAM 3.1 regions)
SAM 3.1 now works (about 2 s and USD 0.0025 per revision). Your water-cycle points were good: transpiration on the trees, evaporation on an arrow, condensation on the cloud and runoff on the lake each gave SAM a sensible region. Three things failed:
1. **Whole-figure or vague parts.** On the DNA figure you chose 'double helix' (the whole drawing) and 'nucleotide' (no single drawn object). SAM then returned the whole diagram (67% of the image, LD-06) or nothing. On the pH-scale figure, the 'parts' were bands of one continuous colour bar, so the regions overlapped (LD-07).
2. **A point placed on a printed label.** 'Precipitation': your point (795,336) sat on the printed word 'Precipitation', but your label box for it was drawn about 35 units lower, so the cover would have missed the word. SAM segmented the text.
3. **Label boxes drifted down.** Label boxes were often 10–40 units below the printed text, and one box enclosed two printed words ('Adenine Thymine').

Rewrite ONLY the 'label-diagram-v1' design text in prompts-v2.ts, and bump STAGE6_PROMPT_VERSION to 's6-v10'. The new text must say:
- Choose parts that are separately drawn objects or components (a cloud, a tree, an arrow, one strand, one rung, one coloured key bar). Never choose the whole figure, the overall structure ('double helix', 'cycle'), a concept with no single drawn shape, or a band of a continuous scale. If fewer than 3 such parts exist, do not write the component (the planner should not have chosen it).
- Place each point at the visual centre of the part's drawn body. Put it on ink, not on background, and well away from any printed text. Then check: the point is not inside any printed word.
- Each label box tightly encloses exactly one printed label: the full word or words of that part's own name, a few units of margin, no neighbouring words, and the same vertical position as the text. Locate the text's top and bottom edges first.
- Keep everything that is still true (names from the page TEXT, quotes, 0..1000 integers x right y down, all-zero box when unprinted, ids, compact JSON).
Change nothing else. NEW test prompts-v2.s6v10.test.ts: the version is s6-v10; the design text forbids the whole figure and continuous-scale bands, requires the visual centre on ink away from printed text, and requires one label box per printed label with the same vertical position. The lead updates the old version pins.

(Followed by the current prompts-v2.ts in full; omitted.)
