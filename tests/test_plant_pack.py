import copy
import pathlib
import uuid

import pglast
import pytest
from pglast import ast, enums

from app.plant import PlantPack, load_pack
from app.plant.briefing import observability
from app.plant.loader import content_hash
from app.plant.rows import to_rows
from app.plant.validate import validate_pack

ROOT = pathlib.Path(__file__).resolve().parents[1]
PACK_DIR = ROOT / "plants" / "demo-water"
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))


@pytest.fixture(scope="module")
def pack() -> PlantPack:
    return load_pack(PACK_DIR)


def mutated(pack: PlantPack, edit) -> list[str]:
    data = copy.deepcopy(pack.model_dump(mode="json", by_alias=True))
    edit(data)
    return validate_pack(PlantPack.model_validate(data))


def test_demo_pack_is_valid_and_hash_is_stable(pack):
    assert validate_pack(pack) == []
    assert content_hash(pack) == content_hash(load_pack(PACK_DIR))


def test_shape_matches_the_plant(pack):
    assert {a.section for a in pack.assets} == {"A", "B", "C", "D"}
    assert len(pack.instruments) == 16
    o = observability(pack)
    assert len(o["streamed"]) == 12
    assert sorted(o["field_only"]) == ["PDG-101", "PI-101", "PI-201A", "PI-201B"]
    assert set(o["manual_valves"]) == {"V-201A", "HV-201", "NV-301"}


def test_cartridge_bank_is_the_dark_zone(pack):
    blind = {b["asset"]: b for b in observability(pack)["blind_assets"]}
    for cf in ("CF-201A", "CF-201B"):
        assert cf in blind
        assert {"PI-201A", "PI-201B"} <= set(blind[cf]["nearby_field"])
        assert "PSL-201" in blind[cf]["nearby_streamed"]
    assert "FIT-301" not in sum((b["nearby_field"] for b in blind.values()), [])


def test_tee_exposes_one_inlet_and_two_outlets(pack):
    tee = pack.asset("TEE-201")
    assert sorted(tee.ports.values()) == ["in", "out", "out"]


def test_every_edge_is_in_exactly_one_flow_direction(pack):
    ends = [e.from_ for e in pack.edges] + [e.to for e in pack.edges]
    assert len(ends) == len(set(ends))


@pytest.mark.parametrize("name, edit, expect", [
    ("wrong direction", lambda d: d["edges"][0].update({"to": "TK-101.out_bottom"}), "out port but used as to"),
    ("port reused", lambda d: d["edges"][1].update({"to": "TK-101.in_top"}), "already used"),
    ("unknown asset", lambda d: d["edges"][0].update({"from": "XX-1.out"}), "unknown asset XX-1"),
    ("dangling port", lambda d: d["edges"].pop(), "not connected"),
    ("gauge with a source", lambda d: [i for i in d["instruments"] if i["tag"] == "PI-201A"][0].update({"source": "SRC-PLC1"}), "no source, address or scaling"),
    ("gauge without location", lambda d: [i for i in d["instruments"] if i["tag"] == "PI-201A"].__getitem__(0).update({"location_note": None}), "needs location_note"),
    ("telemetry without source", lambda d: [i for i in d["instruments"] if i["tag"] == "FIT-301"][0].update({"source": "SRC-FIELD"}), "streaming source"),
    ("bad modbus address", lambda d: [i for i in d["instruments"] if i["tag"] == "FIT-301"][0].update({"address": {"node_id": "x"}}), "bad modbus_tcp address"),
    ("register collision", lambda d: [i for i in d["instruments"] if i["tag"] == "FIT-302"][0].update({"address": {"table": "input", "offset": 1, "dtype": "uint16"}}), "already used"),
    ("attach to nothing", lambda d: [i for i in d["instruments"] if i["tag"] == "LT-01"][0].update({"attach": {"asset": "NOPE"}}), "does not exist"),
    ("route off path", lambda d: d["routes"][0]["edges"].append("E-B06"), "not on a path"),
    ("route needs non-valve", lambda d: d["routes"][0]["requires"].update({"P-301": "open"}), "not a manual valve"),
    ("duplicate tag", lambda d: d["instruments"].append(copy.deepcopy(d["instruments"][0])), "duplicate instrument id LT-01"),
])
def test_validator_rejects(pack, name, edit, expect):
    errors = mutated(pack, edit)
    assert any(expect in e for e in errors), (name, errors)


def test_limits_must_be_ordered(pack):
    def edit(d):
        [i for i in d["instruments"] if i["tag"] == "LT-01"][0]["limits"]["low_alarm"] = 80
    with pytest.raises(ValueError, match="low_trip <= low_alarm"):
        mutated(pack, edit)


def _tables():
    """Columns per table from the migrations, parsed by the real Postgres parser."""
    tables = {}
    for f in MIGRATIONS:
        for raw in pglast.parse_sql(f.read_text()):
            stmt = raw.stmt
            if isinstance(stmt, ast.CreateStmt):
                cols = {
                    c.colname: c for c in stmt.tableElts if isinstance(c, ast.ColumnDef)
                }
                tables[stmt.relation.relname] = cols
    return tables


def _required(cols) -> set[str]:
    """NOT NULL (or primary key) columns that have no default, so an insert must supply them."""
    need = set()
    for name, col in cols.items():
        kinds = {c.contype for c in (col.constraints or ())}
        has_default = enums.ConstrType.CONSTR_DEFAULT in kinds or enums.ConstrType.CONSTR_IDENTITY in kinds
        if (enums.ConstrType.CONSTR_NOTNULL in kinds or enums.ConstrType.CONSTR_PRIMARY in kinds) and not has_default:
            need.add(name)
    return need


def test_rows_match_the_database_schema(pack):
    tables = _tables()
    rows = to_rows(pack, str(uuid.uuid4()), content_hash(pack))
    assert set(rows) <= set(tables)
    for table, table_rows in rows.items():
        assert table_rows, table
        known = set(tables[table])
        for r in table_rows:
            assert set(r) <= known, (table, set(r) - known)
        missing = _required(tables[table]) - set(table_rows[0])
        assert not missing, (table, missing)
    assert len(rows["instruments"]) == 16


def test_migrations_define_the_telemetry_contract():
    tables = _tables()
    assert {"edge_nodes", "telemetry", "telemetry_latest"} <= set(tables)
    assert {"observed_at", "received_at", "quality", "provenance", "ingest_id"} <= set(tables["telemetry"])
