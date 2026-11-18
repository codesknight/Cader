"""Explicit local MCP configuration, relative paths resolved against the config file."""

import json
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ServerConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    transport: Literal["stdio", "streamable_http"]
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    cwd: str | None = None
    url: str | None = None
    timeout_seconds: float = Field(default=30, gt=0, le=120)

    @model_validator(mode="after")
    def validate_transport(self):
        if self.transport == "stdio":
            if not self.command or self.url:
                raise ValueError("stdio requires command and forbids url")
        else:
            if self.command or self.args or self.cwd or not self.url:
                raise ValueError("HTTP requires url and forbids process options")
            parsed = urlsplit(self.url)
            if (
                parsed.scheme != "http"
                or parsed.hostname not in {"127.0.0.1", "::1"}
                or parsed.username
                or parsed.password
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("M0 supports only explicit loopback HTTP without credentials")
        return self


def load_server(path: Path, name: str) -> ServerConfig:
    raw = json.loads(path.read_text(encoding="utf-8"))
    config = ServerConfig.model_validate(raw["servers"][name])
    if config.cwd:
        config.cwd = str((path.resolve().parent / config.cwd).resolve())
    return config
