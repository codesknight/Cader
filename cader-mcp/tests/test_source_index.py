import hashlib

import pytest

from cader_mcp.source_index import coherent_paths, merge_labels, native_text_candidate, tiles


def test_overlapping_perception_has_disjoint_complete_ownership():
    grid = list(tiles(1700, 900))
    assert len(grid) == 6
    assert (
        sum((t["owner"][2] - t["owner"][0]) * (t["owner"][3] - t["owner"][1]) for t in grid)
        == 1700 * 900
    )
    assert grid[0]["view"][2] > grid[1]["owner"][0]
    assert grid[-1]["view"][2:] == [1700, 900]


def test_duplicate_ocr_is_merged_but_conflicting_case_is_preserved():
    values = [
        {"text": text, "bounds": box, "score": score}
        for text, box, score in [
            ("10kΩ", [10, 20, 90, 40], 0.9),
            ("10KΩ", [11, 20, 89, 40], 0.8),
            ("9V", [100, 20, 140, 40], 0.95),
        ]
    ]
    merged = merge_labels(values)
    assert len(merged) == 2
    assert merged[0]["text"] == "10kΩ"
    assert merged[0]["alternatives"] == [{"text": "10KΩ", "score": 0.8}]
    assert merged == merge_labels(list(reversed(values)))


def test_single_glyph_and_stacked_layout_stay_source_geometry_not_guessed_text():
    assert not native_text_candidate({"text": "X", "bounds": [0, 0, 10, 10]})
    assert not native_text_candidate({"text": "一", "bounds": [0, 0, 10, 10]})
    assert not native_text_candidate({"text": "12/34", "bounds": [0, 0, 20, 40]})
    assert native_text_candidate({"text": "10kΩ", "bounds": [0, 0, 40, 12]})


def test_connected_walk_preserves_every_source_edge_and_never_bridges_pen_up():
    def path(i, points, width=1):
        return {"id": str(i), "points": points, "closed": False, "stroke_width": width}

    original = [
        path(1, [[0, 0], [10, 0]]),
        path(2, [[10, 0], [20, 0]]),
        path(3, [[10, 0], [10, 10]]),
        path(4, [[100, 0], [110, 0]]),
        path(5, [[20, 0], [30, 0]], 3),
    ]
    joined = coherent_paths(original)
    assert len(joined) == 3

    def edges(paths):
        result = set()
        for p in paths:
            points = p["points"] + [p["points"][0]] if p["closed"] else p["points"]
            result.update(
                tuple(sorted((tuple(a), tuple(b))))
                for a, b in zip(points, points[1:], strict=False)
            )
        return result

    assert edges(joined) == edges(original)
    assert all(a != b for a, b in edges(joined))


def test_source_support_rejects_a_shifted_path_without_certifying_semantics(tmp_path):
    np = pytest.importorskip("numpy")
    cv2 = pytest.importorskip("cv2")
    from cader_mcp.source_residual import path_support

    image = np.full((100, 100), 255, np.uint8)
    cv2.line(image, (10, 50), (90, 50), 0, 1)
    path = tmp_path / "source.png"
    cv2.imwrite(str(path), image)
    request = {
        "source": {
            "width": 100,
            "height": 100,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        },
        "items": [
            {
                "id": "path",
                "kind": "path",
                "points": [[10, 50], [90, 50]],
                "stroke_width": 1,
                "closed": False,
            }
        ],
    }
    assert path_support(path, request)["checks"][0]["source_supported"]
    request["items"][0]["points"] = [[10, 60], [90, 60]]
    result = path_support(path, request)
    assert not result["checks"][0]["source_supported"]
    assert result["quality_accepted"] is False
    assert result["semantics"] == "not_verified"


def test_native_residual_catches_a_missing_branch_without_claiming_acceptance(tmp_path):
    np = pytest.importorskip("numpy")
    cv2 = pytest.importorskip("cv2")
    from cader_mcp.source_residual import compare

    image = np.full((100, 100), 255, np.uint8)
    cv2.line(image, (10, 50), (90, 50), 0, 1)
    cv2.line(image, (50, 50), (50, 90), 0, 1)
    path = tmp_path / "source.png"
    cv2.imwrite(str(path), image)
    source = {"width": 100, "height": 100, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    base = {
        "type": "AcDb2dPolyline",
        "coordinate_dimension": 3,
        "closed": False,
        "normal": [0, 0, 1],
        "elevation": 0,
        "constant_width": 10,
    }
    native = {
        "source": source,
        "snapshot_sha256": "fixture-native-hash",
        "document": "fixture",
        "verified_text_entity_ids": [],
        "entities": [{**base, "object_id": 1, "coordinates": [100, 500, 0, 900, 500, 0]}],
    }
    missing = compare(path, native)
    assert not missing["geometry_residual_clear"]
    assert missing["missing"]
    native["entities"].append({**base, "object_id": 2, "coordinates": [500, 500, 0, 500, 100, 0]})
    complete = compare(path, native)
    assert complete["geometry_residual_clear"]
    assert complete["quality_accepted"] is False
    assert complete["semantics"] == "not_verified"
    native["source"]["sha256"] = "wrong"
    with pytest.raises(ValueError, match="REFERENCE_CHANGED"):
        compare(path, native)
