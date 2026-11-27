"""Independent read-only comparison of source ink and native CAD readback.

Coordinates use the declared source-to-WCS transform, never image registration
against the source (which could hide scale/layout errors). Native text boxes are
excluded ONLY after separate literal and rendered-image checks by the Harness.
This report cannot accept a drawing or certify engineering semantics.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def compare(image_path, native):
    import cv2
    import numpy as np

    data = Path(image_path).read_bytes()
    source = native["source"]
    if hashlib.sha256(data).hexdigest() != source["sha256"]:
        raise ValueError("REFERENCE_CHANGED_RESELECT_REQUIRED")
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None or image.shape != (source["height"], source["width"]):
        raise ValueError("SOURCE_RESIDUAL_DIMENSIONS_INVALID")
    if np.median([image[0, 0], image[0, -1], image[-1, 0], image[-1, -1]]) < 128:
        image = 255 - image
    _, ink = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    rendered, text_mask = np.zeros_like(ink), np.zeros_like(ink)
    scale = source["width"] / 1000
    unsupported = []

    def pixel(point):
        return [float(point[0]) * scale, source["height"] - float(point[1]) * scale]

    ids = set()
    for entity in native["entities"]:
        if entity["object_id"] in ids:
            raise ValueError("SOURCE_RESIDUAL_DUPLICATE_ENTITY")
        ids.add(entity["object_id"])
        if entity["type"] in {"AcDbPolyline", "AcDb2dPolyline"}:
            coordinates, stride = entity.get("coordinates", []), entity.get("coordinate_dimension")
            if (
                stride not in {2, 3}
                or len(coordinates) < stride * 2
                or entity.get("normal") != [0, 0, 1]
                or entity.get("elevation") != 0
            ):
                unsupported.append(entity["object_id"])
                continue
            points = np.array(
                [pixel(coordinates[i : i + stride]) for i in range(0, len(coordinates), stride)]
            )
            width = max(1, round(float(entity.get("constant_width", 0)) * scale))
            if (
                not np.isfinite(points).all()
                or width > 1000
                or (points < -2).any()
                or (points[:, 0] > source["width"] + 2).any()
                or (points[:, 1] > source["height"] + 2).any()
            ):
                unsupported.append(entity["object_id"])
                continue
            cv2.polylines(
                rendered,
                [np.rint(points).astype(np.int32)],
                entity.get("closed") is True,
                255,
                width,
                cv2.LINE_AA,
            )
        elif (
            entity["type"] == "AcDbText"
            and entity["object_id"] in native["verified_text_entity_ids"]
        ):
            box = entity["bounding_box"]
            a, b = pixel([box["min"][0], box["max"][1]]), pixel([box["max"][0], box["min"][1]])
            cv2.rectangle(
                text_mask, tuple(np.floor(a).astype(int)), tuple(np.ceil(b).astype(int)), 255, -1
            )
        else:
            unsupported.append(entity["object_id"])
    # Two original pixels cover .65px simplification, antialiasing and integer
    # rasterization; they do not excuse a missing symbol, label or shifted line.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = text_mask == 0
    expected = (ink > 127) & mask
    actual = (rendered > 127) & mask
    missing = expected & (cv2.dilate(rendered, kernel) <= 127)
    extra = actual & (cv2.dilate(ink, kernel) <= 127)

    def components(binary):
        count, _, stats, _ = cv2.connectedComponentsWithStats(binary.astype(np.uint8), 8)
        return [
            {"bounds": [int(x), int(y), int(x + w), int(y + h)], "pixels": int(area)}
            for x, y, w, h, area in stats[1:count]
            if area >= 12 or max(w, h) >= 16
        ]

    missing_items, extra_items = components(missing), components(extra)
    return {
        "version": 1,
        "source_sha256": source["sha256"],
        "snapshot_sha256": native["snapshot_sha256"],
        "document": native["document"],
        "coordinate_system": "declared-native-WCS-to-original-pixels-no-registration",
        "tolerance_pixels": 2,
        "expected_ink_pixels": int(expected.sum()),
        "actual_ink_pixels": int(actual.sum()),
        "missing_pixels": int(missing.sum()),
        "extra_pixels": int(extra.sum()),
        "missing": missing_items,
        "extra": extra_items,
        "unsupported_entity_ids": unsupported,
        "separately_verified_text_ids": native["verified_text_entity_ids"],
        "geometry_residual_clear": not unsupported and not missing_items and not extra_items,
        "quality_accepted": False,
        "semantics": "not_verified",
        "limitations": (
            "Native raster comparison only; literal text, actual CAD rendering, "
            "full source coverage and global visual review remain required."
        ),
    }


def path_support(image_path, request):
    """Independent source-pixel support, not a semantic or completeness claim."""
    import cv2
    import numpy as np

    data = Path(image_path).read_bytes()
    source = request["source"]
    if hashlib.sha256(data).hexdigest() != source["sha256"]:
        raise ValueError("REFERENCE_CHANGED_RESELECT_REQUIRED")
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None or image.shape != (source["height"], source["width"]):
        raise ValueError("SOURCE_SUPPORT_DIMENSIONS_INVALID")
    if np.median([image[0, 0], image[0, -1], image[-1, 0], image[-1, -1]]) < 128:
        image = 255 - image
    _, ink = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    supported = cv2.dilate(ink, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    items = request["items"]
    if not items or len(items) > 32 or len({i["id"] for i in items}) != len(items):
        raise ValueError("SOURCE_SUPPORT_IDS_INVALID")
    checks = []
    for item in items:
        if item["kind"] != "path":
            raise ValueError("SOURCE_SUPPORT_PATHS_ONLY")
        width = max(1, round(item["stroke_width"]))
        points = np.asarray(item["points"])
        if points.ndim != 2 or points.shape[1] != 2 or not np.isfinite(points).all():
            raise ValueError("SOURCE_SUPPORT_COORDINATES_INVALID")
        margin = width // 2 + 3
        x = max(0, int(np.floor(points[:, 0].min())) - margin)
        y = max(0, int(np.floor(points[:, 1].min())) - margin)
        a = min(source["width"], int(np.ceil(points[:, 0].max())) + margin + 1)
        b = min(source["height"], int(np.ceil(points[:, 1].max())) + margin + 1)
        rendered = np.zeros((b - y, a - x), np.uint8)
        cv2.polylines(
            rendered,
            [np.rint(points - [x, y]).astype(np.int32)],
            item["closed"],
            255,
            width,
            cv2.LINE_AA,
        )
        count = int((rendered > 127).sum())
        unexplained = int(((rendered > 127) & (supported[y:b, x:a] <= 127)).sum())
        center = np.zeros_like(rendered)
        cv2.polylines(
            center, [np.rint(points - [x, y]).astype(np.int32)], item["closed"], 255, 1, cv2.LINE_AA
        )
        center_pixels = int((center > 127).sum())
        center_unexplained = int(((center > 127) & (supported[y:b, x:a] <= 127)).sum())
        checks.append(
            {
                "id": item["id"],
                "source_supported": center_pixels > 0 and center_unexplained == 0,
                "rendered_pixels": center_pixels,
                "unexplained_pixels": center_unexplained,
                "width_envelope_pixels": count,
                "width_envelope_unexplained_pixels": unexplained,
            }
        )
    return {
        "version": 1,
        "method": "independent-source-raster-support/1",
        "source_sha256": source["sha256"],
        "tolerance_pixels": 2,
        "checks": checks,
        "semantics": "not_verified",
        "quality_accepted": False,
        "scope": (
            "Only these proposed centerlines; width/rendered appearance require CAD visual "
            "and full residual checks. No literal, symbol meaning or complete coverage certified."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("native", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--path-support", action="store_true")
    args = parser.parse_args()
    raw = args.native.read_bytes()
    request = json.loads(raw)
    result = (
        path_support(args.image, request) if args.path_support else compare(args.image, request)
    )
    result["input_sha256"] = hashlib.sha256(raw).hexdigest()
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
