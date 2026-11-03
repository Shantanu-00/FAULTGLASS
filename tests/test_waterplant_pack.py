import pathlib
import uuid

import pytest

from app.plant import load_pack
from app.plant.briefing import observability
from app.plant.loader import content_hash
from app.plant.rows import to_rows

ROOT = pathlib.Path(__file__).resolve().parents[1]
PACK = ROOT / "plants" / "waterplant"


@pytest.fixture(scope="module")
def pack():
    return load_pack(PACK)


def test_two_dual_scale_gauges_on_the_cartridge_bank(pack):
    gauges = [i for i in pack.instruments if i.tag.startswith("PI-20")]
    assert [g.tag for g in gauges] == ["PI-201", "PI-202"]
    for g in gauges:
        assert g.observe == "field_photo" and g.unit == "psi"
        assert {s.unit for s in g.display_scales} == {"kg/cm2", "psi"}
    assert "inlet" in gauges[0].name and "outlet" in gauges[1].name


def test_inlet_is_expected_above_outlet_by_the_normal_differential(pack):
    by = {i.tag: i for i in pack.instruments}
    assert by["PI-201"].limits.nominal - by["PI-202"].limits.nominal == 8


def test_only_the_plc_points_are_streamed(pack):
    o = observability(pack)
    assert sorted(o["streamed"]) == sorted(
        [
            "YS-101", "YS-301", "YS-401", "LSL-101", "LSH-401", "PSL-301", "PSH-301", "AIT-301",
            "PIT-301", "PIT-302", "JI-301", "FIT-301", "ST-RO", "FC-RO",
        ]
    )
    assert "FI-301" in o["field_only"] and "FI-302" in o["field_only"]


def test_hp_pump_trip_is_the_only_remote_hint_about_the_cartridge_bank(pack):
    blind = {b["asset"]: b for b in observability(pack)["blind_assets"]}
    assert "PSL-301" in blind["CB-2B"]["nearby_streamed"]
    assert blind["CB-3F"]["nearby_streamed"] == []
    assert "PI-201" in blind["CB-1F"]["nearby_field"]


@pytest.mark.parametrize("n", [1, 2, 3])
def test_each_media_vessel_has_three_distinct_valve_modes(pack, n):
    routes = {r.id: r for r in pack.routes}
    modes = [routes[f"RT-M{n}-{m}"] for m in ("SERVICE", "BACKWASH", "RINSE")]
    assert {r.kind for r in modes} == {"service", "backwash", "rinse"}
    settings = [tuple(sorted(r.requires.items())) for r in modes]
    assert len(set(settings)) == 3
    for r in modes:
        assert set(r.requires) == {f"V-{n}{n}{k}" for k in range(1, 6)}
    backwash = routes[f"RT-M{n}-BACKWASH"].requires
    assert backwash[f"V-{n}{n}3"] == "open" and backwash[f"V-{n}{n}4"] == "open"
    assert backwash[f"V-{n}{n}1"] == "closed" and backwash[f"V-{n}{n}2"] == "closed"


def test_service_flow_passes_through_every_media_vessel_in_order(pack):
    order = ["MGF-101", "ACF-102", "SOF-103", "PF-101", "HDR-CB-IN"]
    chain = {e.from_.split(".")[0]: e.to.split(".")[0] for e in pack.edges}
    # follow the main line through service valves; valve and tee hops are skipped
    seen = []
    node = "P-101"
    for _ in range(80):
        nxt = [e.to.split(".")[0] for e in pack.edges if e.from_.split(".")[0] == node and e.medium != "drain"
               and e.medium != "backwash"]
        if not nxt:
            break
        node = nxt[0]
        if node in order:
            seen.append(node)
    assert seen == order


def test_cartridge_lines_are_front_then_back(pack):
    for k in range(1, 5):
        assert any(e.from_ == f"CB-{k}F.out" and e.to == f"CB-{k}B.in" for e in pack.edges)


def test_layout_places_everything_and_is_marked_approximate(pack):
    assert pack.layout.approximate
    front_z = {pack.layout.placements[f"CB-{k}F"].z for k in range(1, 5)}
    back_z = {pack.layout.placements[f"CB-{k}B"].z for k in range(1, 5)}
    assert len(front_z) == len(back_z) == 1 and front_z != back_z


def test_unverified_items_are_flagged_not_hidden(pack):
    assert any("0.2 micron" in q for q in pack.manifest.open_questions)
    assert pack.asset("CB-1F").spec["micron_rating_verified"] is False
    assert {e.basis for e in pack.edges if e.id.startswith("E-CB-MID")} == {"assumed"}


def test_rows_import_ready(pack):
    rows = to_rows(pack, str(uuid.uuid4()), content_hash(pack))
    assert len(rows["instruments"]) == 20 and len(rows["plant_edges"]) == len(pack.edges)
    assert rows["plant_releases"][0]["layout"]["approximate"] is True


def test_scene_export_carries_structure_but_no_readings_or_limits(pack):
    from app.plant.scene import scene_model

    m = scene_model(pack)
    assert len(m["assets"]) == len(pack.assets) and len(m["edges"]) == len(pack.edges)
    for i in m["instruments"]:
        assert "limits" not in i and "nominal" not in str(i)
    blind = {a["id"] for a in m["assets"] if a["blind"]}
    assert {"CB-1F", "CB-3B", "MGF-101"} <= blind
    assert set(m["layout"]["placements"]) >= {a.id for a in pack.assets if a.role != "group"}
