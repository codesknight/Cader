import { spawn } from 'node:child_process';
import { readFile, mkdir, stat, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readReferenceImage } from '@cader/config';
export type PixelBox = [
    number,
    number,
    number,
    number
];
export type SourceItem = {
    id: string;
    bounds: PixelBox;
    status: 'proposal';
    group_id?: string;
    owner_point?: [
        number,
        number
    ];
} & ({
    kind: 'path';
    points: [
        number,
        number
    ][];
    closed: boolean;
    pixel_length: number;
    stroke_width?: number;
} | {
    kind: 'text';
    text: string;
    quad: [
        number,
        number
    ][];
    score: number;
    alternatives: {
        text: string;
        score: number;
    }[];
});
export interface ReferenceIndex {
    version: 1;
    source: {
        sha256: string;
        width: number;
        height: number;
    };
    engine: Record<string, unknown>;
    tiles: {
        owner: PixelBox;
        view: PixelBox;
    }[];
    items: SourceItem[];
    coverage: Record<string, unknown>;
    semantics: 'not_verified';
    quality_accepted: false;
}
async function localSourceCheck(root: string, workspace: string, runDirectory: string, path: string, input: {
    source: ReferenceIndex['source'];
    [key: string]: unknown;
}, signal: AbortSignal, mode: 'native' | 'paths') {
    const source = await readReferenceImage(workspace, path);
    if (createHash('sha256').update(source.data).digest('hex') !== input.source.sha256)
        throw new Error('REFERENCE_CHANGED_RESELECT_REQUIRED');
    const directory = join(runDirectory, 'source-residuals'), id = randomUUID();
    await mkdir(directory, { recursive: true });
    const native = join(directory, id + '-input.json'), output = join(directory, id + '-result.json'), raw = JSON.stringify(input);
    await writeFile(native, raw, { flag: 'wx' });
    const environment: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    for (const key of ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA'])
        if (process.env[key])
            environment[key] = process.env[key];
    const python = resolve(root, 'cader-mcp/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const code = await new Promise<number>((accept, reject) => { const child = spawn(python, ['-m', 'cader_mcp.source_residual', path, native, output, ...mode === 'paths' ? ['--path-support'] : []], { cwd: root, env: environment, windowsHide: true, signal, stdio: 'ignore' }); child.on('error', reject); child.on('close', code => accept(code ?? 1)); });
    if (code !== 0)
        throw new Error('SOURCE_RESIDUAL_HELPER_FAILED');
    const report = JSON.parse(await readFile(output, 'utf8'));
    if (report.source_sha256 !== input.source.sha256 || report.input_sha256 !== createHash('sha256').update(raw).digest('hex') || report.quality_accepted !== false || report.semantics !== 'not_verified')
        throw new Error('SOURCE_RESIDUAL_REPORT_BINDING_INVALID');
    const again = await readReferenceImage(workspace, path);
    if (createHash('sha256').update(again.data).digest('hex') !== input.source.sha256)
        throw new Error('REFERENCE_CHANGED_RESELECT_REQUIRED');
    return { report, path: output };
}
export async function compareSourceNative(root: string, workspace: string, runDirectory: string, path: string, input: {
    source: ReferenceIndex['source'];
    snapshot_sha256: string;
    document: unknown;
    entities: Record<string, any>[];
    verified_text_entity_ids: number[];
}, signal: AbortSignal) {
    const value = await localSourceCheck(root, workspace, runDirectory, path, input, signal, 'native'), report = value.report;
    if (report.snapshot_sha256 !== input.snapshot_sha256 || JSON.stringify(report.document) !== JSON.stringify(input.document) || typeof report.geometry_residual_clear !== 'boolean' || !Array.isArray(report.missing) || !Array.isArray(report.extra))
        throw new Error('SOURCE_RESIDUAL_REPORT_BINDING_INVALID');
    return value;
}
export async function checkSourcePaths(root: string, workspace: string, runDirectory: string, path: string, index: ReferenceIndex, items: SourceItem[], signal: AbortSignal) {
    const value = await localSourceCheck(root, workspace, runDirectory, path, { source: index.source, items }, signal, 'paths'), report = value.report;
    if (report.method !== 'independent-source-raster-support/1' || !Array.isArray(report.checks) || report.checks.length !== items.length || new Set(report.checks.map((c: any) => c.id)).size !== items.length || report.checks.some((c: any) => !items.some(i => i.id === c.id) || typeof c.source_supported !== 'boolean' || !Number.isSafeInteger(c.unexplained_pixels)))
        throw new Error('SOURCE_SUPPORT_REPORT_BINDING_INVALID');
    return value;
}
export function parseReferenceIndex(value: unknown, source: {
    sha256: string;
    width: number;
    height: number;
}): ReferenceIndex {
    const v = value as ReferenceIndex;
    if (v?.version !== 1 || v.source?.sha256 !== source.sha256 || v.source?.width !== source.width || v.source?.height !== source.height || v.quality_accepted !== false || v.semantics !== 'not_verified' || v.engine?.coordinate_system !== 'original-pixels-top-left-y-down' || !Array.isArray(v.tiles) || v.tiles.length < 2 || v.tiles.length > 64 || !Array.isArray(v.items) || !v.items.length || v.items.length > 20000)
        throw new Error('SOURCE_INDEX_INVALID');
    let area = 0;
    const box = (b: number[]) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[0]! >= 0 && b[1]! >= 0 && b[2]! <= source.width && b[3]! <= source.height && b[0]! < b[2]! && b[1]! < b[3]!;
    for (const [i, t] of v.tiles.entries()) {
        if (!box(t.owner) || !box(t.view) || t.view[0] > t.owner[0] || t.view[1] > t.owner[1] || t.view[2] < t.owner[2] || t.view[3] < t.owner[3] || v.tiles.slice(0, i).some(p => Math.min(p.owner[2], t.owner[2]) > Math.max(p.owner[0], t.owner[0]) && Math.min(p.owner[3], t.owner[3]) > Math.max(p.owner[1], t.owner[1])))
            throw new Error('SOURCE_INDEX_TILE_OWNERSHIP_INVALID');
        area += (t.owner[2] - t.owner[0]) * (t.owner[3] - t.owner[1]);
    }
    if (area !== source.width * source.height)
        throw new Error('SOURCE_INDEX_TILE_COVERAGE_INCOMPLETE');
    const ids = new Set<string>();
    const point = (p: number[]) => Array.isArray(p) && p.length === 2 && p.every((n, i) => Number.isFinite(n) && n >= 0 && n < (i ? source.height : source.width));
    for (const item of v.items) {
        if (!item || !/^\w{1,64}$/.test(item.id) || ids.has(item.id) || item.status !== 'proposal' || !Array.isArray(item.bounds) || item.bounds.length !== 4 || !point(item.bounds.slice(0, 2)) || !point(item.bounds.slice(2)) || item.bounds[0] > item.bounds[2] || item.bounds[1] > item.bounds[3])
            throw new Error('SOURCE_INDEX_ITEM_INVALID');
        ids.add(item.id);
        if (item.group_id !== undefined && !/^\w{1,64}$/.test(item.group_id) || item.owner_point !== undefined && !point(item.owner_point))
            throw new Error('SOURCE_INDEX_GROUP_INVALID');
        if (item.kind === 'path') {
            if (typeof item.closed !== 'boolean' || !Array.isArray(item.points) || item.points.length < (item.closed ? 3 : 2) || item.points.length > 4096 || !item.points.every(point) || !Number.isFinite(item.pixel_length) || item.pixel_length <= 0 || item.stroke_width !== undefined && (!Number.isFinite(item.stroke_width) || item.stroke_width <= 0))
                throw new Error('SOURCE_INDEX_PATH_INVALID');
        }
        else if (item.kind === 'text') {
            if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 1024 || !Number.isFinite(item.score) || item.score < 0 || item.score > 1 || !Array.isArray(item.quad) || item.quad.length !== 4 || !item.quad.every(point) || !Array.isArray(item.alternatives) || item.alternatives.some(a => typeof a.text !== 'string' || !a.text.trim() || a.text.length > 1024 || !Number.isFinite(a.score) || a.score < 0 || a.score > 1))
                throw new Error('SOURCE_INDEX_TEXT_INVALID');
        }
        else
            throw new Error('SOURCE_INDEX_ITEM_KIND_INVALID');
    }
    return structuredClone(v);
}
/** Fixed local read-only helper, never an Agent shell or remote image upload.
 * Optional dependencies are installed explicitly; startup never installs them. */
export async function indexReferenceSource(root: string, workspace: string, path: string, signal?: AbortSignal, emit: (event: {
    type: string;
    [key: string]: unknown;
}) => void = () => { }) {
    const source = await readReferenceImage(workspace, path), fingerprint = { sha256: createHash('sha256').update(source.data).digest('hex'), width: source.width, height: source.height };
    const python = resolve(root, 'cader-mcp/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (!await stat(python).catch(() => null))
        return { available: false as const, reason: 'SOURCE_INDEX_ENVIRONMENT_UNAVAILABLE' };
    const directory = resolve(root, '.cader/cache/source-index/v5', fingerprint.sha256), cached = join(directory, 'index.json');
    try {
        const value = parseReferenceIndex(JSON.parse(await readFile(cached, 'utf8')), fingerprint);
        emit({ type: 'source.index_loaded', cached: true, source_sha256: fingerprint.sha256, items: value.items.length });
        return { available: true as const, index: value, path: cached };
    }
    catch { /* Incomplete/untrusted caches never authorize writes. */ }
    await mkdir(directory, { recursive: true });
    const pending = join(directory, 'index-' + randomUUID() + '.json');
    const environment: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', OMP_NUM_THREADS: '4' };
    for (const key of ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA'])
        if (process.env[key])
            environment[key] = process.env[key];
    let stderr = '', stdout = '';
    const exit = await new Promise<number>((accept, reject) => {
        const child = spawn(python, ['-m', 'cader_mcp.source_index', path, pending], { cwd: root, env: environment, windowsHide: true, signal, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', chunk => { stdout += String(chunk); let newline: number; while ((newline = stdout.indexOf('\n')) >= 0) {
            const line = stdout.slice(0, newline);
            stdout = stdout.slice(newline + 1);
            try {
                const item = JSON.parse(line);
                if (item.stage === 'ocr')
                    emit({ type: 'source.index_progress', tile: item.tile, tiles: item.tiles });
            }
            catch { /* library log, not model authority */ }
        } });
        child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-8000); });
        child.on('error', reject);
        child.on('close', code => accept(code ?? 1));
    });
    if (exit !== 0) {
        const reason = /No module named|ModuleNotFoundError/.test(stderr) ? 'SOURCE_INDEX_DEPENDENCIES_UNAVAILABLE' : /REQUIRES_LINE_ART/.test(stderr) ? 'SOURCE_INDEX_NOT_LINE_ART' : 'SOURCE_INDEX_FAILED';
        await writeFile(join(directory, 'failure-' + randomUUID() + '.json'), JSON.stringify({ reason, exit }), { flag: 'wx' });
        return { available: false as const, reason };
    }
    const value = parseReferenceIndex(JSON.parse(await readFile(pending, 'utf8')), fingerprint);
    const again = await readReferenceImage(workspace, path);
    if (createHash('sha256').update(again.data).digest('hex') !== fingerprint.sha256)
        throw new Error('REFERENCE_CHANGED_RESELECT_REQUIRED');
    await rename(pending, cached);
    emit({ type: 'source.index_loaded', cached: false, source_sha256: fingerprint.sha256, items: value.items.length });
    return { available: true as const, index: value, path: cached };
}
