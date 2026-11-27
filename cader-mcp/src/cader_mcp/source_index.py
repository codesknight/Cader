"""Read-only raster evidence proposals. Never execute CAD or certify semantics.

OCR, geometry and residual pixels are independent evidence layers. All positions
are ORIGINAL pixels; the client owns the only CAD transform. No task templates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import unicodedata
from pathlib import Path


def stable_id(kind, value):
    return kind + "_" + hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:20]


def tiles(width, height, edge=800, halo=96):
    """Disjoint ownership; overlapping read-only perception, as in sliced inference."""
    for y in range(0, height, edge):
        for x in range(0, width, edge):
            a, b = min(x + edge, width), min(y + edge, height)
            yield {
                "owner": [x, y, a, b],
                "view": [
                    max(0, x - halo),
                    max(0, y - halo),
                    min(width, a + halo),
                    min(height, b + halo),
                ],
            }


def overlap(a, b):
    area = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    return area / max(1, min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])))


def merge_labels(labels):
    result = []
    for item in sorted(labels, key=lambda a: -a["score"]):
        prior = next((p for p in result if overlap(p["bounds"], item["bounds"]) > 0.65), None)
        if prior is None:
            result.append({**item, "alternatives": []})
        elif prior["text"] != item["text"]:
            prior["alternatives"].append({"text": item["text"], "score": item["score"]})
    for item in result:
        item["id"] = stable_id("text", [item["bounds"], item["text"]])
    return sorted(result, key=lambda a: (a["bounds"][1], a["bounds"][0]))


def native_text_candidate(label):
    """Avoid converting an isolated symbol or 2D typesetting into guessed TEXT.

    Rejected OCR proposals remain actual source ink, so they are vectorized as
    editable native paths. This is a representation choice, not erased content
    or a semantic acceptance. Single-line multi-character text stays literal.
    """
    text = label["text"]
    if sum(character.isalnum() for character in text) < 2:
        return False
    x, y, a, b = label["bounds"]
    units = sum(
        1 if unicodedata.east_asian_width(c) in {"W", "F"} else 0.55
        for c in text
        if not c.isspace()
    )
    expected_height = (a - x) / max(units, 1)
    return "\n" not in text and b - y <= 1.8 * expected_height


def coherent_paths(paths):
    """Join actual connected strokes, never bridge a gap or invent an edge.

    For a branching component a depth-first closed walk may retrace an existing
    edge. This is graphical reproduction, not a claim of recovered CAD topology.
    Every emitted segment comes from a source path in either direction. Width
    buckets differ by at most .25 original pixels; pixel verification is separate.
    """
    from collections import defaultdict

    buckets = defaultdict(list)
    result = []
    for path in paths:
        if path["closed"]:
            result.append(path)
        else:
            buckets[round(path["stroke_width"] * 4)].append(path)
    for group in buckets.values():
        adjacency = defaultdict(list)
        for i, path in enumerate(group):
            adjacency[tuple(path["points"][0])].append(i)
            adjacency[tuple(path["points"][-1])].append(i)
        visited = set()
        for seed in range(len(group)):
            if seed in visited:
                continue
            collected, walk = [], [group[seed]["points"][0]]
            stack = [(tuple(walk[0]), None)]
            while stack:
                node, back = stack[-1]
                edge = next((i for i in adjacency[node] if i not in visited), None)
                if edge is None:
                    stack.pop()
                    if back is not None:
                        walk.extend(back)
                    continue
                visited.add(edge)
                path = group[edge]
                collected.append(path)
                points = path["points"]
                if tuple(points[0]) != node:
                    points = list(reversed(points))
                walk.extend(points[1:])
                stack.append((tuple(points[-1]), list(reversed(points[:-1]))))
            if len(collected) == 1:
                result.append(collected[0])
                continue
            width = sum(p["stroke_width"] for p in collected) / len(collected)
            # Split only at an existing vertex; no segment may cross a pen-up.
            for start in range(0, len(walk) - 1, 2047):
                points = walk[start : start + 2048]
                closed = len(points) > 3 and points[0] == points[-1]
                if closed:
                    points = points[:-1]
                if len(points) < 2:
                    continue
                result.append(
                    {
                        "id": stable_id("path", [points, closed, width]),
                        "kind": "path",
                        "points": points,
                        "closed": closed,
                        "bounds": [
                            min(p[0] for p in points),
                            min(p[1] for p in points),
                            max(p[0] for p in points),
                            max(p[1] for p in points),
                        ],
                        "pixel_length": sum(
                            math.dist(a, b) for a, b in zip(points, points[1:], strict=False)
                        ),
                        "stroke_width": round(width, 3),
                        "status": "proposal",
                        "source_path_ids": [p["id"] for p in collected],
                        "representation": "connected-source-walk-no-invented-edges",
                    }
                )
    return result


def skeleton_paths(mask):
    """Trace every graph edge once, including loops. Junctions are geometric only."""
    import cv2
    import numpy as np
    from skimage.morphology import skeletonize

    skeleton = skeletonize(mask > 0)
    pixels = set(zip(*np.nonzero(skeleton), strict=True))

    def neighbors(p):
        y, x = p
        return [
            (y + dy, x + dx)
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))
            if (y + dy, x + dx) in pixels
            and not (dy and dx and ((y, x + dx) in pixels or (y + dy, x) in pixels))
        ]

    adjacency = {p: neighbors(p) for p in sorted(pixels)}
    visited, paths = set(), []
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 3)

    def emit_path(points):
        widths = [max(0.5, 2 * float(distance[y, x]) - 1) for y, x in points]
        smooth = [float(np.median(widths[max(0, i - 2) : i + 3])) for i in range(len(points))]
        cuts, start = [0], 0
        for i in range(3, len(points) - 3):
            baseline = float(np.median(smooth[start:i]))
            if i - start >= 3 and abs(float(np.median(smooth[i : i + 3])) - baseline) > 1.5:
                cuts.append(i)
                start = i
        cuts.append(len(points) - 1)
        for a, b in zip(cuts, cuts[1:], strict=False):
            subset = points[a : b + 1]
            closed = len(cuts) == 2 and subset[-1] == subset[0]
            xy = np.array([[int(x), int(y)] for y, x in subset], dtype=np.float32)
            approx = cv2.approxPolyDP(xy, 0.65, closed).reshape(-1, 2).tolist()
            if len(approx) < (3 if closed else 2):
                continue
            length = sum(math.dist(x, y) for x, y in zip(approx, approx[1:], strict=False))
            if length < 2:
                continue
            stroke = round(float(np.median(smooth[a : b + 1])), 3)
            paths.append(
                {
                    "id": stable_id("path", [approx, closed, stroke]),
                    "kind": "path",
                    "points": approx,
                    "closed": closed,
                    "bounds": [
                        float(xy[:, 0].min()),
                        float(xy[:, 1].min()),
                        float(xy[:, 0].max()),
                        float(xy[:, 1].max()),
                    ],
                    "pixel_length": round(length, 3),
                    "stroke_width": stroke,
                    "status": "proposal",
                }
            )

    starts = [p for p in adjacency if len(adjacency[p]) != 2]
    for start in starts + list(adjacency):
        for first in adjacency[start]:
            edge = tuple(sorted((start, first)))
            if edge in visited:
                continue
            points = [start, first]
            visited.add(edge)
            previous, current = start, first
            while current != start and len(adjacency[current]) == 2:
                following = next(p for p in adjacency[current] if p != previous)
                edge = tuple(sorted((current, following)))
                if edge in visited:
                    break
                visited.add(edge)
                points.append(following)
                previous, current = current, following
            if len(points) < 3:
                continue
            emit_path(points)
    return paths, skeleton


def build_index(path, *, use_ocr=True, edge=800):
    import cv2
    import numpy as np

    data = Path(path).read_bytes()
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("SOURCE_IMAGE_DECODE_FAILED")
    height, width = image.shape[:2]
    if width * height > 40_000_000:
        raise ValueError("SOURCE_IMAGE_PIXEL_LIMIT")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if np.median([gray[0, 0], gray[0, -1], gray[-1, 0], gray[-1, -1]]) < 128:
        gray = 255 - gray
    _, ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    saturation = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)[:, :, 1]
    if np.mean(saturation > 64) > 0.1 or not 0.0001 < np.mean(ink > 0) < 0.4:
        raise ValueError("SOURCE_INDEX_REQUIRES_LINE_ART")
    while math.ceil(width / edge) * math.ceil(height / edge) > 64:
        edge += 64
    grid, labels = list(tiles(width, height, edge)), []
    if use_ocr:
        from rapidocr import RapidOCR

        engine = RapidOCR(
            params={
                "EngineConfig.onnxruntime.intra_op_num_threads": 4,
                "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            }
        )
        for i, tile in enumerate(grid):
            x, y, a, b = tile["view"]
            result = engine(image[y:b, x:a])
            if result.txts is not None:
                for box, text, score in zip(result.boxes, result.txts, result.scores, strict=True):
                    box = np.asarray(box) + [x, y]
                    bounds = [
                        int(box[:, 0].min()),
                        int(box[:, 1].min()),
                        int(box[:, 0].max()),
                        int(box[:, 1].max()),
                    ]
                    touches_inner_edge = (
                        (x > 0 and bounds[0] <= x + 2)
                        or (y > 0 and bounds[1] <= y + 2)
                        or (a < width and bounds[2] >= a - 3)
                        or (b < height and bounds[3] >= b - 3)
                    )
                    if text.strip() and not touches_inner_edge:
                        labels.append(
                            {
                                "kind": "text",
                                "text": text,
                                "bounds": bounds,
                                "quad": box.astype(int).tolist(),
                                "score": float(score),
                                "tile": i,
                                "status": "proposal",
                            }
                        )
            print(json.dumps({"stage": "ocr", "tile": i + 1, "tiles": len(grid)}), flush=True)
    ocr_proposals = merge_labels(labels)
    labels = [label for label in ocr_proposals if native_text_candidate(label)]
    geometry = ink.copy()
    for label in labels:
        cv2.fillPoly(geometry, [np.asarray(label["quad"], np.int32)], 0)
    # Do not let a text rectangle silently erase a conductor passing through it.
    # Restore only original ink near an independently detected continuous line.
    long_lines = cv2.HoughLinesP(ink, 1, math.pi / 180, 30, minLineLength=50, maxLineGap=0)
    preserved = np.zeros_like(ink)
    if long_lines is not None:
        for x, y, a, b in long_lines.reshape(-1, 4):
            cv2.line(preserved, (int(x), int(y)), (int(a), int(b)), 255, 3)
        geometry = np.maximum(geometry, cv2.bitwise_and(ink, preserved))
    paths, skeleton = skeleton_paths(geometry)
    paths = coherent_paths(paths)
    outlined = [label for label in ocr_proposals if not native_text_candidate(label)]
    for item in paths:
        x, y, a, b = item["bounds"]
        candidates = [
            label
            for label in outlined
            if label["bounds"][0] - 1 <= x
            and label["bounds"][1] - 1 <= y
            and a <= label["bounds"][2] + 1
            and b <= label["bounds"][3] + 1
        ]
        if candidates:
            label = min(
                candidates,
                key=lambda t: (t["bounds"][2] - t["bounds"][0]) * (t["bounds"][3] - t["bounds"][1]),
            )
            item["group_id"] = label["id"]
            item["owner_point"] = [
                (label["bounds"][0] + label["bounds"][2]) / 2,
                (label["bounds"][1] + label["bounds"][3]) / 2,
            ]

    # Proposals never certify their own completeness. Unexplained pixels remain
    # explicit residuals, to be checked against independently rendered native CAD.
    return {
        "version": 1,
        "source": {"sha256": hashlib.sha256(data).hexdigest(), "width": width, "height": height},
        "engine": {
            "method": "local-ocr-skeleton-graph",
            "coordinate_system": "original-pixels-top-left-y-down",
            "engine_version": 5,
            "outlined_ocr_ids": [
                label["id"] for label in ocr_proposals if not native_text_candidate(label)
            ],
            "tile_edge": edge,
            "halo": 96,
            "ocr": use_ocr,
            "simplification_pixels": 0.65,
        },
        "tiles": grid,
        "items": paths + labels,
        "coverage": {
            "source_ink_pixels": int(np.count_nonzero(ink)),
            "geometry_ink_pixels": int(np.count_nonzero(geometry)),
            "skeleton_pixels": int(np.count_nonzero(skeleton)),
            "status": "not_verified",
        },
        "semantics": "not_verified",
        "quality_accepted": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--no-ocr", action="store_true")
    args = parser.parse_args()
    result = build_index(args.image, use_ocr=not args.no_ocr)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False)
    print(
        json.dumps(
            {
                "stage": "indexed",
                "items": len(result["items"]),
                "source_sha256": result["source"]["sha256"],
            }
        )
    )


if __name__ == "__main__":
    main()
