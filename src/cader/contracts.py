"""Small shared contracts; no CAD or framework imports."""

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ErrorCode(StrEnum):
    UNSUPPORTED_CAPABILITY = "UNSUPPORTED_CAPABILITY"
    INVALID_ARGUMENT = "INVALID_ARGUMENT"
    DOCUMENT_CHANGED = "DOCUMENT_CHANGED"
    CAD_BUSY = "CAD_BUSY"
    TIMEOUT = "TIMEOUT"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    VERIFICATION_FAILED = "VERIFICATION_FAILED"
    UNKNOWN_WRITE_OUTCOME = "UNKNOWN_WRITE_OUTCOME"


class Task(BaseModel):
    id: str
    instruction: str
    workspace_id: str
    domain: str = "general"


class ToolResult(BaseModel):
    ok: bool
    data: dict[str, Any] = Field(default_factory=dict)
    error_code: ErrorCode | None = None
    retryable: bool = False
