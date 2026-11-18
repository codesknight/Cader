"""Offline protocol smoke; no model credentials or CAD process required."""

import json
import sys

from cader_mcp.config import ServerConfig
from cader_mcp.mcp_client import connect, discover


async def run_smoke() -> dict:
    config = ServerConfig(
        transport="stdio",
        command=sys.executable,
        args=["-m", "cader_mcp.smoke_server"],
    )
    async with connect(config) as session:
        tools = await discover(session)
        names = {tool["name"] for tool in tools}
        echo = await session.call_tool("general_ping", {"value": "cader-smoke"})
        text = "".join(x.text for x in echo.content if x.type == "text")
        failure = await session.call_tool("general_fail", {})
        checks = {
            "discovery": names == {"general_ping", "general_fail"},
            "round_trip": not echo.isError and json.loads(text)["value"] == "cader-smoke",
            "error_propagation": bool(failure.isError),
        }
    return {"ok": all(checks.values()), "kind": "offline-protocol", "checks": checks}
