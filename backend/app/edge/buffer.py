from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from .observation import Observation


@dataclass(frozen=True)
class Batch:
    ids: list[int]
    run_id: str | None
    observations: list[Observation]


class OutboxBuffer:
    def __init__(self, path: str | Path, *, max_rows: int = 200_000):
        self._max_rows = max_rows
        self._db = sqlite3.connect(str(path))
        self._db.execute("pragma journal_mode = wal")
        self._db.execute(
            "create table if not exists outbox (id integer primary key autoincrement, run_id text, payload text not null)"
        )
        self._db.commit()

    def add(self, run_id: str | None, observations: list[Observation]) -> None:
        self._db.executemany(
            "insert into outbox (run_id, payload) values (?, ?)",
            [(run_id, json.dumps(o.to_json())) for o in observations],
        )
        overflow = self.count() - self._max_rows
        if overflow > 0:
            self._db.execute("delete from outbox where id in (select id from outbox order by id limit ?)", (overflow,))
        self._db.commit()

    def next_batch(self, limit: int) -> Batch | None:
        first = self._db.execute("select run_id from outbox order by id limit 1").fetchone()
        if first is None:
            return None
        rows = self._db.execute(
            "select id, payload from outbox where run_id is ? order by id limit ?", (first[0], limit)
        ).fetchall()
        return Batch([r[0] for r in rows], first[0], [Observation.from_json(json.loads(r[1])) for r in rows])

    def remove(self, ids: list[int]) -> None:
        self._db.executemany("delete from outbox where id = ?", [(i,) for i in ids])
        self._db.commit()

    def count(self) -> int:
        return self._db.execute("select count(*) from outbox").fetchone()[0]

    def close(self) -> None:
        self._db.close()
