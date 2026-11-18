import asyncio

import pytest


def test_harness_errors_checkpoints_and_budget():
    pytest.importorskip("deepagents")
    from cader.harness_spike import run_spike

    report = asyncio.run(run_spike())
    assert report["ok"], report
    assert report["model_calls"] == 3
    assert report["primary_tool_calls"] == 2
