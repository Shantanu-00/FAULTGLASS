import pathlib
import re

import pglast
import pytest

from app.plant import load_pack
from app.plant.memory import BLOCK_LIMIT, build_memory
from app.plant.rows import to_rows

ROOT = pathlib.Path(__file__).resolve().parents[1]
PACK = ROOT / "plants" / "waterplant"


@pytest.fixture(scope="module")
def blocks():
    return {b.kind: b.body_md for b in build_memory(load_pack(PACK))}


def test_five_blocks_each_under_limit(blocks):
    assert set(blocks) == {"topology", "observability", "human_tasks", "floor_plan", "glossary"}
    assert all(len(body) <= BLOCK_LIMIT for body in blocks.values())


def test_no_micron_rating_is_stated(blocks):
    assert not any(re.search(r"micron", body, re.IGNORECASE) for body in blocks.values())


def test_human_tasks_list_sixteen_manual_valves_and_six_dials(blocks):
    valves = re.findall(r"^- (V-\d+|NV-\d+) ", blocks["human_tasks"], re.MULTILINE)
    dials = re.findall(r"^- (PI-\d+|FI-\d+)\. Where to stand", blocks["human_tasks"], re.MULTILINE)
    assert len(valves) == 16 and len(dials) == 6
    assert "psi" in blocks["human_tasks"] and "bar" not in blocks["human_tasks"].split("## DIAL")[1]


def test_floor_plan_states_legs_and_approximation(blocks):
    assert "APPROXIMATE" in blocks["floor_plan"]
    assert "Leg 1 (L1): 23 x 6 m" in blocks["floor_plan"]
    assert "Leg 2 (L2): 6 x 10 m" in blocks["floor_plan"]


def test_release_rows_match_the_pack():
    pack = load_pack(PACK)
    rows = to_rows(pack, "00000000-0000-0000-0000-000000000001", "x" * 64)
    assert len(rows["plant_assets"]) == 52 and len(rows["plant_edges"]) == 60
    assert len(rows["plant_routes"]) == 9 and len(rows["instruments"]) == 20


@pytest.mark.parametrize("name", ["01_plant_release.sql", "02_plant_memory.sql"])
def test_generated_seed_parses(name):
    path = ROOT / "supabase" / "seed" / name
    if not path.exists():
        pytest.skip("run backend/scripts/build_seed_topology.py first")
    assert pglast.parse_sql(path.read_text(encoding="utf-8"))
