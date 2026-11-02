from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass

from psycopg_pool import AsyncConnectionPool


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


@dataclass(frozen=True)
class EdgeNode:
    edge_node_id: str
    plant_id: str


class EdgeNodeRepository:
    def __init__(self, pool: AsyncConnectionPool):
        self._pool = pool

    async def provision(self, edge_node_id: str, plant_id: str, name: str) -> str:
        key = secrets.token_urlsafe(32)
        async with self._pool.connection() as conn:
            await conn.execute(
                """
                insert into edge_nodes (edge_node_id, plant_id, name, api_key_hash)
                values (%s, %s, %s, %s)
                on conflict (edge_node_id) do update set api_key_hash = excluded.api_key_hash, name = excluded.name
                """,
                (edge_node_id, plant_id, name, hash_key(key)),
            )
        return key

    async def authenticate(self, edge_node_id: str, key: str) -> EdgeNode | None:
        async with self._pool.connection() as conn:
            cur = await conn.execute(
                "select plant_id, api_key_hash from edge_nodes where edge_node_id = %s", (edge_node_id,)
            )
            row = await cur.fetchone()
        if row is None or not hmac.compare_digest(row["api_key_hash"], hash_key(key)):
            return None
        return EdgeNode(edge_node_id=edge_node_id, plant_id=row["plant_id"])

    async def touch(self, edge_node_id: str, software_version: str | None = None) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                "update edge_nodes set last_seen_at = now(), software_version = coalesce(%s, software_version) "
                "where edge_node_id = %s",
                (software_version, edge_node_id),
            )
