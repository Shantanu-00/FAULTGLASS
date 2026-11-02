from __future__ import annotations

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool


def create_pool(url: str, *, max_size: int = 5) -> AsyncConnectionPool:
    return AsyncConnectionPool(
        url,
        min_size=1,
        max_size=max_size,
        open=False,
        kwargs={"autocommit": True, "row_factory": dict_row, "prepare_threshold": None},
    )
