import json
import os
import subprocess
import sys


def test_json_redirect_is_utf8_even_with_legacy_environment(tmp_path):
    """A real pipe reproduces locale-sensitive Windows JSON encoding."""
    environment = dict(os.environ, PYTHONUTF8="0", PYTHONIOENCODING="gb18030")
    script = """
import sys
from unittest.mock import patch
from cader_mcp.cli import main
sys.argv = ['cader-mcp', 'doctor']
with patch('cader_mcp.cli.platform.python_version', return_value='中文诊断'):
    main()
"""
    output = tmp_path / "report.json"
    with output.open("wb") as stream:
        result = subprocess.run(
            [sys.executable, "-c", script],
            stdout=stream,
            stderr=subprocess.PIPE,
            env=environment,
            check=False,
        )
    assert result.returncode == 0, result.stderr.decode("utf-8")
    assert json.loads(output.read_bytes().decode("utf-8"))["python"] == "中文诊断"


def test_argument_diagnostics_are_utf8():
    environment = dict(os.environ, PYTHONUTF8="0", PYTHONIOENCODING="gb18030")
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; from cader_mcp.cli import main; "
            "sys.argv=['cader-mcp','mcp','未知命令']; main()",
        ],
        capture_output=True,
        env=environment,
        check=False,
    )
    assert result.returncode == 2
    assert "未知命令" in result.stderr.decode("utf-8")
