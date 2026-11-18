"""M0 CLI. Failures are nonzero and never silently become skipped successes."""

import argparse
import asyncio
import importlib.metadata
import json
import platform
from pathlib import Path

from cader_mcp.config import load_server
from cader_mcp.mcp_client import probe
from cader_mcp.smoke import run_smoke


def main() -> None:
    parser = argparse.ArgumentParser(description="Cader research and smoke tooling")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("doctor", help="Local package diagnostics; no network or CAD calls")
    sub.add_parser("smoke", help="Offline real-MCP framing and failure smoke")
    mcp = sub.add_parser("mcp", help="Explicitly configured local MCP discovery/probe")
    mcp.add_argument("action", choices=["list", "smoke"])
    mcp.add_argument("--config", type=Path, required=True)
    mcp.add_argument("--server", default="autocad")
    args = parser.parse_args()
    try:
        if args.command == "doctor":
            report = {"ok": True, "python": platform.python_version(), "packages": {}}
            for package in ("cader-mcp", "mcp", "pydantic"):
                try:
                    report["packages"][package] = importlib.metadata.version(package)
                except importlib.metadata.PackageNotFoundError:
                    report["packages"][package] = None
        elif args.command == "smoke":
            report = asyncio.run(run_smoke())
        else:
            config = load_server(args.config, args.server)
            report = asyncio.run(probe(config, call=args.action == "smoke"))
    except Exception as exc:
        # Tool/server exceptions can contain paths, request bodies or secrets.
        report = {
            "ok": False,
            "error_type": type(exc).__name__,
            "hint": "Check explicit local configuration, dependencies and server stderr.",
        }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["ok"] else 1)
