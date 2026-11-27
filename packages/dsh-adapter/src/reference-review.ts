import { createHash } from 'node:crypto';
import { readReferenceImage } from '@cader/config';
import type { ReferenceIndex, SourceItem } from './reference-index.js';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { assertToolArguments } from './tool-validation.js';
import { sourceAspectViews } from './source-coordinates.js';
import type { AgentResult } from './live.js';
export interface IndexedSourceReading {
    id: string;
    status: 'clear' | 'uncertain' | 'reject';
    text: string | null;
    rotation: 0 | 90 | 180 | 270 | null;
    evidence: string;
    semantic_pending: boolean;
}
export const sourceLiteralKey=(text:string|null)=>text===null?null:text.normalize('NFC').trim().replace(/\s+/gu,' ');
const sameReading=(a:IndexedSourceReading,b:IndexedSourceReading)=>sourceLiteralKey(a.text)===sourceLiteralKey(b.text)&&a.rotation===b.rotation;
export function sourceItemView(index: ReferenceIndex, items: SourceItem[],padding=24) {
    const left = Math.max(0, Math.floor(Math.min(...items.map(i => i.bounds[0])) - padding)), top = Math.max(0, Math.floor(Math.min(...items.map(i => i.bounds[1])) - padding));
    const right = Math.min(index.source.width, Math.ceil(Math.max(...items.map(i => i.bounds[2])) + padding + 1)), bottom = Math.min(index.source.height, Math.ceil(Math.max(...items.map(i => i.bounds[3])) + padding + 1));
    return { crop: { left, top, width: right - left, height: bottom - top } };
}
/** Independent actual-pixel review, separate from producer OCR/CV scores and CAD.
 * It certifies only local appearance/literal evidence, never complete semantics. */
export async function reviewIndexedSource(run: (profile: string, instruction: string, request: any) => Promise<AgentResult>, profile: string, root: string, path: string, index: ReferenceIndex, items: SourceItem[], task: string, signal?: AbortSignal, reserve: () => void = () => { }) {
    const image = await readReferenceImage(root, path), sha = createHash('sha256').update(image.data).digest('hex');
    if (sha !== index.source.sha256)
        throw new Error('REFERENCE_CHANGED_RESELECT_REQUIRED');
    if (!items.length || items.length > 32 || new Set(items.map(i => i.id)).size !== items.length)
        throw new Error('SOURCE_REVIEW_IDS_INVALID');
    const read = async (targets: SourceItem[], independentText = false, tight=false) => {
        reserve();
        const literalOnly=targets.every(item=>item.kind==='text');
        const view = sourceItemView(index, targets,tight?1:24), b = view.crop;
        const frame: [
            [
                number,
                number
            ],
            [
                number,
                number
            ]
        ] = [[b.left / image.width, b.top / image.height], [(b.left + b.width) / image.width, (b.top + b.height) / image.height]];
        const local = ([x, y]: number[]) => [(x! - b.left) / b.width, (y! - b.top) / b.height];
        let structured: IndexedSourceReading[] | undefined;
        const tool: ToolDefinition = { name: 'cader_submit_indexed_source_review', description: literalOnly?'Read only literal glyphs and orientation for frozen source label IDs. Positions are program-owned lookup metadata, not review conditions. No diagram planning or CAD authorization.':'Report actual-pixel local appearance and literal reading for each requested stable ID exactly once. Source producer scores are not proof; unknown function does not imply invisible geometry. No CAD authorization or task completion.', parameters: { type: 'object', additionalProperties: false, properties: { items: { type: 'array', minItems: targets.length, maxItems: targets.length, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', enum: targets.map(i => i.id) }, status: { type: 'string', enum: literalOnly ? ['clear','uncertain'] : ['clear', 'uncertain', 'reject'] }, text: { type: ['string', 'null'], maxLength: 1024 }, rotation: { type: ['integer', 'null'], enum: [0, 90, 180, 270, null] }, evidence: { type: 'string', minLength: 1, maxLength: 300 }, semantic_pending: { type: 'boolean' } }, required: ['id', 'status', 'text', 'rotation', 'evidence', 'semantic_pending'] } } }, required: ['items'] }, output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] }, async execute(args, exec) {
                assertToolArguments(tool, args);
                const rows = (args as {
                    items: IndexedSourceReading[];
                }).items;
                if (new Set(rows.map(r => r.id)).size !== targets.length || rows.some(r => { const i = targets.find(i => i.id === r.id); return !i || i.kind === 'text' && r.status === 'clear' && (!r.text?.trim() || r.rotation === null) || i.kind === 'path' && (r.text !== null || r.rotation !== null); }))
                    throw new Error('SOURCE_ITEM_REVIEW_BINDING_INVALID');
                structured = rows;
                exec.concludeTurn();
                return JSON.stringify({ source_sha256: sha, items: rows, complete_source_accepted: false });
            } };
        const candidates = tight ? targets.map(i=>({id:i.id,kind:i.kind,scope:'The entire supplied TARGET image is this single frozen source label. Read literal glyphs only; no coordinates, layout or whole-sheet check.'})) : targets.map(i => ({ id: i.id, kind: i.kind, bounds: [local(i.bounds.slice(0, 2)), local(i.bounds.slice(2))], ...(i.kind === 'path' ? { points: i.points.map(local), closed: i.closed, stroke_width_pixels: i.stroke_width } : { ...(!independentText ? { ocr_hypothesis: i.text } : {}), notice: 'Read literal and orientation independently; do not use the producer score as evidence.' }) }));
        const literalInstruction=(tight?'只读取当前实际附带的单一TARGET标注图像，整张TARGET就是这个ID，不评价坐标。':'只读取当前BASE中各个固定标注ID的字面字符，bounds仅用于查找该行，不评价区域范围或整体布局。')+'逐字报告text和rotation；标注位置及裁片由程序固定且已核对，不规划图纸，不要求完整邻件。仅无法辨认的字形可uncertain；可见文字不因未知用途、缺少邻件、没有全图或几乎填满TARGET而不确定。保留真实大小写、单位和标点，不从惯例猜字。用当前schema提交，不能声称整图完成。';
        const result = await run(profile, (literalOnly?literalInstruction:'只独立核对实际原图BASE裁片内指定ID的图形外观/位置/文字。候选是本地图像处理的假设，不是答案，不是已绘CAD。逐项调用cader_submit_indexed_source_review。clear表示当前像素足以支持该路径/轮廓或准确字面值；uncertain表示实际不能辨认；reject表示候选坐标/形状/文字对应范围错误。可见的线条不因未知用途、图框角色、未请求比例尺或跨区功能关系而变成不可见；这些语义用semantic_pending单独保存，不声称拓扑已验收。路径可能是未识别字符的笔画：可核实几何，但不能把描出字形称为已识别数值，semantic_pending=true，后续完整可读性另验。文字严格限于每项bounds内，不能串入相邻标签或邻行；高清单项目裁片只显示该目标和极小边缘。文字必须从像素逐字读，不猜单位/大小写，clear时text和rotation必填；非文字两项为null。整个图纸是否画完不在本次源观察范围，不能用它改变可见性结论。' + (independentText ? '这是对有冲突字面值的第二次独立读取；没有给出前次结论，不能自行求一致。' : '') + JSON.stringify({ task, coordinate_system: 'normalized-BASE-top-left-y-down', candidates })) + (literalOnly?JSON.stringify({candidates}):''), { image: path, imageView: view, sourceDetails: sourceAspectViews(view).map((view, i) => ({ path, view, label: 'Actual-pixel source detail ' + i + '. Report only the stable IDs, never new positions or offsets.' })), observationFrame: frame, observationViewAware: true, independentEvidence: true, taskState: () => ({ phase: 'reference', source_sha256: sha, requested_item_ids: targets.map(i => i.id), semantics: 'pending separately; no prior CAD review' }), signal, ...literalOnly?{}:{skill: 'progressive-drawing', skillResource: 'source-observation'}, onlyTools: tight?[tool.name]:literalOnly?[tool.name,'cader_view_image']:[tool.name, 'cader_view_image', 'cader_load_skill'], extraTools: [tool], maxImageViews: 2, maxModelSteps: 4, resultText: () => structured ? JSON.stringify(structured) : undefined });
        if (!structured || result.status !== 'succeeded')
            throw new Error(result.errorCode ?? 'SOURCE_ITEM_REVIEW_INVALID');
        return { id: result.id, items: structured, view };
    };
    const first = await read(items);
    const disputed = items.filter(i => i.kind === 'text' && first.items.find(r => r.id === i.id)?.status === 'clear' && (sourceLiteralKey(first.items.find(r => r.id === i.id)?.text??null) !== sourceLiteralKey(i.text) || i.alternatives.length));
    const second = disputed.length ? await read(disputed, true) : null;
    let readings = first.items.map(row => { const other = second?.items.find(r => r.id === row.id); return other && (other.status !== 'clear' || !sameReading(other,row)) ? { ...row, status: 'uncertain' as const, evidence: 'Independent literal readings disagree; explicit clarification or new evidence required.' } : row; });
    const details: Awaited<ReturnType<typeof read>>[] = [];
    // A small glyph on a broad BASE must be re-observed in a bounded actual-pixel
    // crop before asking the user. Never re-read already accepted unrelated facts.
    for (const row of readings.filter(r => r.status === 'uncertain').slice(0, 8)) {
        const item = items.find(i => i.id === row.id)!;
        const detail = await read([item], true, true);
        details.push(detail);
        const refined = detail.items[0]!;
        if (refined.status !== 'clear') continue;
        // Two fresh target-only reads may correct a broad-view neighbor leak.
        // Keep ALL original disagreements; never force a new reading to match
        // the old broad crop or normalize case/units/numerical punctuation.
        const confirm = await read([item], true, true);
        details.push(confirm);
        if (confirm.items[0]!.status === 'clear' && sameReading(refined,confirm.items[0]!))
            readings = readings.map(r => r.id === row.id ? {...refined,text:sourceLiteralKey(refined.text),evidence:refined.evidence+'; confirmed by independent target-only reread; earlier broad evidence retained.'} : r);
    }
    const again = await readReferenceImage(root, path);
    if (createHash('sha256').update(again.data).digest('hex') !== sha)
        throw new Error('REFERENCE_CHANGED_RESELECT_REQUIRED');
    return { source_sha256: sha, index_item_ids: items.map(i => i.id), view: sourceItemView(index, items), attempts: [first, ...(second ? [second] : []), ...details], items: readings, semantics: 'not_verified', complete_source_accepted: false };
}
