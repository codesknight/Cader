# Verification and repair
Before writes: target identity, units/scale status, permissions, frozen state, operation schema, region ownership and dependencies.
After each meaningful batch: independently query geometry and entity properties, capture relevant CAD view, compare against source crop or user specifications. Verify expected entities, location, orientation, labels and local connectivity where applicable. Use domain skills for symbols or standards; do not invent missing facts. Do not use visual similarity alone as proof of topology or dimensions.

Record discrepancy type, evidence reference, affected entities, expected vs observed, and next action. Repair only affected geometry, then re-query and re-render. Recheck neighbors if shared anchors changed. If no visual capture capability is available, report visual verification unavailable and do not mark it passed.

Final: check coverage of requested scope, overlap deduplication, cross-region connections, layout, annotations and applicable units; save and independently reopen if supported. Acceptance remains pending if any required check is absent. Preserve drafts explicitly as drafts.
