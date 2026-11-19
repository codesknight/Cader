---
name: cad-redraw-review
description: Assess evidence and readiness for a CAD redraw without modifying CAD documents.
---

# Cader redraw review

This is Cader-authored guidance for the current read-only runtime. It is not the upstream
autocad-dwg-redraw package and supplies no DWG reader, converter or drawing executor.

Start by stating which inputs are actually accessible: a supplied image attachment,
user-provided measurements, or results from available reviewed MCP tools. A filename
mentioned in text does not mean you have opened or inspected that file.

Choose the next decision using the best available evidence. If an editable source drawing
exists, recommend obtaining its structural data through a suitable reviewed tool. For a
PDF, request an explicit content inspection rather than assuming vector geometry. For an
image, separate visible features from measurements with a defensible physical unit.

Load resource assessment-format through cader_load_skill when producing an assessment.
For each important claim, identify its basis: a user statement, a tool observation, a
calculation from stated values, an image estimate, or an unresolved question. Retain
conflicting values in the report. Never silently replace a stated dimension with pixels.

If an image is provided, inspect its legibility, missing regions and viewpoints. Without
an established scale, provide a qualitative review and list the measurements still needed.
Do not guess unreadable text, dimensional tolerances, document units or source entities.
Do not infer full DWG structure from a preview or assume every view shares a scale.

Separate these questions in the proposed acceptance plan: does geometry meet supplied
constraints, does its appearance match the reference, and does an actual saved artifact
open and retain the intended content? A matching object count or convincing picture alone
does not answer all three. No deterministic geometry verifier is bundled with this Skill.

Use main-agent coordination only. A permitted vision worker may review image evidence,
but no child may delegate or approve edits. Return uncertainty and required evidence to
the main agent; the main agent decides what to report to the user.

No script, shell, AutoLISP or direct COM execution is available through this Skill. Do not
create, edit, save, overwrite or restart CAD. Report missing tools as capability gaps.
Future writes require the Cader working-copy, authorization, document/revision binding
and request reconciliation contract; this guidance grants none of those capabilities.

Research reference: https://github.com/pengxiaoan/autocad-dwg-redraw-skill
at ed182ec5966caaaf1d82d6ad4015435a27a8a909. Upstream files are not bundled;
its reviewed snapshot had no explicit license declaration. See the Cader research report.
