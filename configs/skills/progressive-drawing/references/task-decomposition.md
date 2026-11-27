# Task decomposition — current Cader contract

Plan globally, resolve details locally. Prefer a few complete semantic objects or views; these are not mandatory task types. Keep a connected component whole when feasible. Prioritize requested drawing content over decorative frames, indices or empty margins.

`cader_submit_progressive_plan` uses original-image normalized coordinates, top-left origin and Y down. Logical execution rectangles must NOT overlap and must cover `content_bounds`. Read-only magnification views may overlap, but do not create overlapping CAD ownership. A fresh design can choose bounds around its requested content; blank areas may remain empty. Do not invent frames, text or decoration to fill every rectangle.

Prefer `cader_submit_progressive_partition` for strip/grid partitions: supply sorted interior `x_cuts` / `y_cuts`, and describe every zero-based `(row,column)` cell exactly once. The program computes shared rectangle coordinates and applies the same scope, dependency and anchor checks. An empty cuts array leaves that axis whole; choose cuts from actual content/whitespace, not an arbitrary grid that fragments symbols. This is another authoring form, not permission to omit scope or erase a rejected plan's evidence.

This is a valid FORMAT example, not a fixed task plan or drawing sequence. Derive the actual partition from the user's request and image:
```json
{"version":1,"content_bounds":[[0,0],[1,1]],"units":"relative-layout-units","regions":[{"id":"primary","bounds":[[0,0],[0.6,1]],"description":"First requested content region","depends_on":[],"priority":90},{"id":"secondary","bounds":[[0.6,0],[1,1]],"description":"Second requested content region","depends_on":[],"priority":80}],"anchors":[]}
```

An anchor is an actual geometric crossing on the shared boundary of EVERY listed region. It is not a relationship such as sky-to-object, object center or distant endpoints on the same long wire. Do not invent anchors; an empty list is correct when no shared geometry exists. `connected` means functional conductor continuity, `coincident` means geometric continuity. Keep actual unknown crossings pending; never omit a known necessary crossing to claim completion.

Dependencies are real prerequisites, not a scanning order. Local acceptance must be satisfiable before future regions exist. Do not require a future canopy, ground line or adjacent feature to certify the current part; preserve joins as global conditions. Use `cader_split_progressive_region` only for an unexecuted oversized region, with a cut in the SAME global normalized frame and actual shared crossings. Respect the live schema and limits; no new authority is granted by this text.
