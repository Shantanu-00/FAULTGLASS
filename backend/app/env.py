from __future__ import annotations

import os


def require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is required")
    return value


def optional(name: str, default: str) -> str:
    return os.environ.get(name) or default
