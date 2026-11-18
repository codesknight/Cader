"""Bounded MCP discovery and a deliberately narrow read-only AutoCAD probe."""

from contextlib import asynccontextmanager

import anyio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamable_http_client

from cader.config import ServerConfig


@asynccontextmanager
async def connect(config: ServerConfig):
    with anyio.fail_after(config.timeout_seconds):
        if config.transport == "stdio":
            parameters = StdioServerParameters(
                command=config.command,
                args=config.args,
                cwd=config.cwd,
            )
            async with stdio_client(parameters) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    yield session
        else:
            async with streamable_http_client(config.url) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    yield session


async def discover(session: ClientSession) -> list[dict]:
    tools = []
    cursor = None
    seen = set()
    for _ in range(100):
        page = await session.list_tools(cursor=cursor)
        tools.extend(tool.model_dump(mode="json", exclude_none=True) for tool in page.tools)
        cursor = page.nextCursor
        if not cursor:
            break
        if cursor in seen:
            raise ValueError("Repeated tools/list cursor")
        seen.add(cursor)
    else:
        raise ValueError("tools/list exceeded 100 pages")
    names = [tool["name"] for tool in tools]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate MCP tool names")
    return sorted(tools, key=lambda item: item["name"])


async def probe(config: ServerConfig, *, call: bool = False) -> dict:
    import json

    async with connect(config) as session:
        tools = await discover(session)
        report = {"ok": True, "transport": config.transport, "tools": tools}
        if call:
            # Never infer permission from descriptions or upstream annotations.
            if "list_layers" not in {tool["name"] for tool in tools}:
                raise ValueError("AutoCAD read-only probe requires list_layers")
            result = await session.call_tool("list_layers", {})
            if result.isError:
                raise ValueError("AutoCAD list_layers returned an MCP tool error")
            text = "".join(item.text for item in result.content if item.type == "text")
            layers = json.loads(text)
            if not isinstance(layers, list) or not all(isinstance(x, str) for x in layers):
                raise ValueError("list_layers did not return a JSON array of names")
            report["read_only_call"] = {"tool": "list_layers", "layer_count": len(layers)}
        return report
