import asyncio

import pytest

from cader_mcp.config import ServerConfig
from cader_mcp.mcp_client import probe
from cader_mcp.smoke import run_smoke


def test_real_stdio_roundtrip_and_failure():
    report = asyncio.run(run_smoke())
    assert report["ok"], report


def test_unavailable_server_is_failure():
    config = ServerConfig(
        transport="streamable_http",
        url="http://127.0.0.1:1/mcp",
        timeout_seconds=1,
    )
    with pytest.raises((ExceptionGroup, TimeoutError)):
        asyncio.run(probe(config))
