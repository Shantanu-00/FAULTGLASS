"""Percent-encode the password in DATABASE_URL (repo-root .env) and test the connection.

A raw `[`, `]`, `@`, `:`, `/`, `?`, `#` or `%` in the password breaks connection URIs. This
rewrites only the password part of the DATABASE_URL line, leaves every other line untouched,
and never prints the password.

usage: cd backend && uv run python scripts/fix_database_url.py [--no-connect]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import quote

ENV = Path(__file__).resolve().parents[2] / ".env"


def encode_url(url: str) -> str:
    scheme, sep, rest = url.partition("://")
    if not sep:
        raise SystemExit("DATABASE_URL has no scheme://")
    userinfo, at, hostpart = rest.rpartition("@")  # the password may itself contain '@'
    if not at:
        raise SystemExit("DATABASE_URL has no user:password@host part")
    user, colon, password = userinfo.partition(":")
    if not colon:
        raise SystemExit("DATABASE_URL has no password")
    only_valid_escapes = all(re.fullmatch(r"%[0-9A-Fa-f]{2}", m) for m in re.findall(r"%.{0,2}", password))
    encoded = quote(password, safe="%") if only_valid_escapes else quote(password, safe="")
    return f"{scheme}://{user}:{encoded}@{hostpart}"


def main() -> int:
    lines = ENV.read_text().splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.startswith("DATABASE_URL="):
            raw = line.split("=", 1)[1].strip().strip("'\"")
            fixed = encode_url(raw)
            changed = fixed != raw
            if changed:
                lines[i] = f"DATABASE_URL={fixed}\n"
                ENV.write_text("".join(lines))
            break
    else:
        print("DATABASE_URL not found in .env")
        return 1
    print("password encoding:", "rewritten" if changed else "already valid")

    if "--no-connect" in sys.argv:
        return 0
    import psycopg

    try:
        with psycopg.connect(fixed, connect_timeout=10, prepare_threshold=None) as conn:
            conn.execute("select 1")
            tables = conn.execute(
                "select count(*) from information_schema.tables where table_schema = 'public'"
            ).fetchone()[0]
    except Exception as exc:
        print("connect failed:", type(exc).__name__, str(exc).splitlines()[0][:200].replace(fixed, "***"))
        return 1
    print(f"connect ok, public tables: {tables}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
