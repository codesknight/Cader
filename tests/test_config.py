import json

import pytest
from pydantic import ValidationError

from cader.config import ServerConfig, load_server


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/mcp",
        "http://127.0.0.1/mcp?key=secret",
        "http://user:secret@127.0.0.1/mcp",
        "https://127.0.0.1/mcp",
    ],
)
def test_reject_nonlocal_or_credential_urls(url):
    with pytest.raises(ValidationError):
        ServerConfig(transport="streamable_http", url=url)


def test_resolve_cwd_against_config(tmp_path):
    path = tmp_path / "mcp.json"
    path.write_text(
        json.dumps(
            {
                "servers": {
                    "cad": {
                        "transport": "stdio",
                        "command": "python",
                        "cwd": "backend",
                    }
                }
            }
        )
    )
    assert load_server(path, "cad").cwd == str(tmp_path / "backend")


def test_reject_ambiguous_transport():
    with pytest.raises(ValidationError):
        ServerConfig(transport="stdio", command="python", url="http://127.0.0.1/mcp")
