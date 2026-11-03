import io
import math

import pytest
from PIL import Image, ImageDraw

from app.evidence.differential import compute_differential
from app.evidence.gauge import GaugePipeline, largest_detection, needle_psi
from app.evidence.lever import build_track, classify_stage
from app.evidence.sam import Detection, SamReply, parse_sam_text
from app.plant import load_pack

from conftest import PACK_DIR


def test_parse_sam_text_reads_boxes_masks_and_confidence():
    text = ('<0f>0<|box;x1=10;y1=20;x2=110;y2=120;w=800;h=600;c=0.91|>'
            '<|mask;x=0;y=0;c=0.91;data=100,100,!abc|>,'
            '1<|box;x1=200;y1=20;x2=280;y2=100;w=800;h=600|><|mask;x=0;y=0;data=80,80,~xyz|>')
    dets = parse_sam_text(text)
    assert len(dets) == 2
    assert dets[0].box == (10, 20, 110, 120) and dets[0].confidence == pytest.approx(0.91)
    assert dets[0].mask_encoding == "!" and dets[1].mask_encoding == "~"
    assert parse_sam_text("") == []  # zero matches is a valid SAM outcome


def box(x, y, s=90):
    return Detection(object_id=0, frame=0, box=(x, y, x + s, y + s), frame_size=(800, 600))


def test_largest_detection_picks_the_dial_that_fills_the_photo():
    small, big = box(50, 40, 40), box(200, 150, 160)
    assert largest_detection([small, big]) is big
    assert largest_detection([]) is None


def test_differential_flags_a_restricted_bank_only_at_the_limit():
    pack = load_pack(PACK_DIR)
    healthy = compute_differential({"PI-201": 24.0, "PI-202": 16.0}, pack.instruments)
    assert healthy.dp_psi == 8.0 and healthy.normal_dp_psi == 8.0 and healthy.limit_dp_psi == 12.0
    assert healthy.restricted is False
    assert compute_differential({"PI-201": 27.0, "PI-202": 16.0}, pack.instruments).restricted is False
    fault = compute_differential({"PI-201": 32.0, "PI-202": 15.0}, pack.instruments)
    assert fault.dp_psi == 17.0 and fault.restricted is True
    assert compute_differential({"PI-201": 24.0}, pack.instruments) is None


def line_raster(w, h, angle_deg, cx=None, cy=None, length=38):
    """Raster with a line through the centre at angle_deg (image coords)."""
    cx, cy = (w / 2 if cx is None else cx), (h / 2 if cy is None else cy)
    raster = bytearray(w * h)
    rad = math.radians(angle_deg)
    for t in range(-length, length + 1):
        x, y = int(cx + t * math.cos(rad)), int(cy + t * math.sin(rad))
        if 0 <= x < w and 0 <= y < h:
            raster[y * w + x] = 1
    return bytes(raster)


def test_needle_psi_recovers_mid_scale_and_rejects_empty():
    det = Detection(object_id=0, frame=0, box=(0, 0, 100, 100), frame_size=(100, 100),
                    mask_h=100, mask_w=100, mask_encoding="!", mask_payload="x")
    # 50 psi: swept 135 deg from 225 -> math angle 90 (pointing up = image -y).
    # A real needle is one-sided from the hub; draw it that way.
    raster = bytearray(100 * 100)
    for t in range(0, 39):
        raster[(50 - t) * 100 + 50] = 1
    raster = bytes(raster)
    value = needle_psi(det, raster)
    assert value is not None and abs(value - 50) < 8
    assert needle_psi(det, bytes(100 * 100)) is None
    assert needle_psi(det, None) is None


class FakeReader:
    def __init__(self, values):
        self.values = values

    async def read_gauge(self, crop_url, tag, location_note):
        return self.values.get(tag)


class FakeSam:
    model = "sam-3.1"

    def __init__(self, gauge_dets):
        self.gauge_dets = gauge_dets
        self.concepts = []

    async def segment_image(self, image_url, concept):
        self.concepts.append(concept)
        if concept == "pressure gauge":
            return SamReply(detections=self.gauge_dets)
        return SamReply(detections=[])


async def test_pipeline_reads_the_dial_in_one_photo_and_marks_single_source():
    pack = load_pack(PACK_DIR)
    inlet = next(i for i in pack.instruments if i.tag == "PI-201")
    image = Image.new("RGB", (800, 600), "white")
    ImageDraw.Draw(image).ellipse((100, 120, 400, 420), outline="black", width=3)
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    pipeline = GaugePipeline(sam=FakeSam([box(100, 120, 300), box(600, 40, 40)]), reader=FakeReader({"PI-201": 24.0}))
    reading = await pipeline.read_photo(buf.getvalue(), inlet)
    assert reading.value == 24.0 and reading.status == "single_source" and reading.box[0] == 100
    # A dial SAM cannot find is reported, never invented.
    missing = await GaugePipeline(sam=FakeSam([]), reader=FakeReader({})).read_photo(buf.getvalue(), inlet)
    assert missing.status == "not_found" and missing.value is None
    # A dial the reader cannot read is reported as unreadable.
    unread = await GaugePipeline(sam=FakeSam([box(100, 120, 300)]), reader=FakeReader({})).read_photo(buf.getvalue(), inlet)
    assert unread.status == "unreadable" and unread.value is None


def lever_det(frame, angle_deg):
    raster = line_raster(100, 100, angle_deg)
    return (Detection(object_id=1, frame=frame, box=(0, 0, 100, 100), frame_size=(400, 100),
                      mask_h=100, mask_w=100, mask_encoding="!", mask_payload="x"), raster)


def test_lever_track_classifies_staged_sequence():
    # Patch decode_raster path: build_track decodes payloads itself, so use
    # detections whose payload decodes via monkeypatched helper instead.
    import app.evidence.lever as lever_mod

    rasters = {}
    lever, pipe = [], []
    pipe_raster = line_raster(100, 100, 0)
    for frame, angle in [(0, 0), (10, 5), (20, 45), (30, 48), (40, 90), (50, 88)]:
        det, raster = lever_det(frame, angle)
        lever.append(det)
        rasters[id(det)] = raster
        pipe_det = Detection(object_id=2, frame=frame, box=(0, 40, 100, 60), frame_size=(400, 100),
                             mask_h=100, mask_w=100, mask_encoding="!", mask_payload="x")
        pipe.append(pipe_det)
        rasters[id(pipe_det)] = pipe_raster
    original = lever_mod.decode_raster
    lever_mod.decode_raster = lambda d: rasters.get(id(d))
    try:
        track = build_track(lever, pipe)
    finally:
        lever_mod.decode_raster = original
    stages = [f.stage for f in track.frames]
    assert stages[0] == "OPEN" and "MID" in stages and stages[-1] == "CLOSED"
    assert track.staged_sequence_ok() is True
    assert classify_stage(None) == "UNCERTAIN" and classify_stage(25) == "BETWEEN"
