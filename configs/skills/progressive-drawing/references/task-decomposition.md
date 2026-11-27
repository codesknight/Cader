# Task decomposition
Choose semantic regions where possible, otherwise use overlapping spatial tiles. Mechanical: views, profiles, holes, dimensions. Architectural: rooms, grids, walls, openings. Electrical: buses, bays, devices and terminals. These are examples, not hard-coded task types.

Use a single global coordinate convention. Store source-to-CAD transform and uncertainty. Define shared anchor IDs and ownership of overlap entities so that neighboring patches do not duplicate geometry. Split oversized regions recursively; do not split across critical connectivity without explicit boundary ports. Resolve dependencies before writes. Schedule independent ready regions first; isolate failures without bypassing global safety barriers.

Suggested logical plan (adapt to existing schemas; not a tool contract):
```json
{"source_id":"example","target_document_id":null,"units":"unknown","regions":[{"id":"r01","source_bbox":[0,0,100,100],"depends_on":[],"anchors":["a01"],"status":"pending","acceptance":["geometry matches evidence","boundary anchors consistent"]}]}
```
Keep batch size within actual context, tool and verifier budgets. Prefer dependency-aware semantic splits over arbitrary fixed tile sizes. Update plan on user scope changes and invalidate only affected work.
