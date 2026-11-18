"""Deterministic protocol fixture. This is not a CAD backend."""

from mcp.server.fastmcp import FastMCP

server = FastMCP("cader-smoke-fixture")


@server.tool()
def general_ping(value: str) -> dict:
    """Echo a value through real MCP framing."""
    return {"value": value, "backend": "fixture"}


@server.tool()
def general_fail() -> str:
    """Return an intentional tool execution error for client validation."""
    raise ValueError("intentional smoke failure")


if __name__ == "__main__":
    server.run()
