import pathlib
import socket
import uuid

import pgserver
import psycopg
import pytest
from psycopg.conninfo import make_conninfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
PACK_DIR = ROOT / "plants" / "waterplant"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def pg_template(tmp_path_factory):
    server = pgserver.get_server(tmp_path_factory.mktemp("pg"), cleanup_mode="stop")
    base = server.get_uri()
    with psycopg.connect(base, autocommit=True) as admin:
        admin.execute("create database template_app")
    template_url = make_conninfo(base, dbname="template_app")
    with psycopg.connect(template_url, autocommit=True) as conn:
        for path in MIGRATIONS:
            conn.execute(path.read_text(encoding="utf-8"))
    yield base
    server.cleanup()


@pytest.fixture
def db_url(pg_template):
    name = f"t_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(pg_template, autocommit=True) as admin:
        admin.execute(f'create database "{name}" template template_app')
    yield make_conninfo(pg_template, dbname=name)
    with psycopg.connect(pg_template, autocommit=True) as admin:
        admin.execute(f'drop database "{name}" with (force)')


@pytest.fixture
def conn(db_url):
    with psycopg.connect(db_url, autocommit=True) as c:
        yield c
