import base64
import io

import pytest
from PIL import Image, ImageDraw

from app.evidence.differential import compute_differential
from app.evidence.gauge import (
    GaugePipeline, WonderGaugeReader, WonderRead, is_ambiguous, largest_detection, masked_crop_data_url, parse_psi)
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


def disk_raster(size, radius):
    """Box-local 0/1 raster: a disk of `radius` centred in a size x size box."""
    c = (size - 1) / 2
    return bytes(1 if (x - c) ** 2 + (y - c) ** 2 <= radius ** 2 else 0
                 for y in range(size) for x in range(size))


def dial(x, y, s, radius=None, confidence=None):
    return Detection(object_id=0, frame=0, box=(x, y, x + s, y + s), frame_size=(800, 600),
                     confidence=confidence, mask_h=s, mask_w=s,
                     raster=disk_raster(s, radius or s // 2 - 4))


def photo_bytes():
    image = Image.new("RGB", (800, 600), (30, 90, 200))
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def decode_url(url):
    assert url.startswith("data:image/jpeg;base64,")
    return Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGB")


def close(pixel, expected, tol=14):
    return all(abs(a - b) <= tol for a, b in zip(pixel, expected))


class FakeReader:
    def __init__(self, values, reasoning="BETWEEN: 20 and 40\nPSI: 24"):
        self.values = values
        self.reasoning = reasoning
        self.calls = []

    async def read_gauge(self, crop_url, tag, location_note):
        self.calls.append((crop_url, tag, location_note))
        return WonderRead(value=self.values.get(tag), reasoning=self.reasoning)


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


def test_masked_crop_blanks_outside_the_box_local_mask_and_keeps_inside():
    image = Image.new("RGB", (800, 600), (30, 90, 200))
    det = dial(100, 120, 200, radius=90)
    url, applied = masked_crop_data_url(image, det)
    crop = decode_url(url)
    assert applied is True
    assert 700 <= max(crop.size) <= 800
    w, h = crop.size
    assert close(crop.getpixel((w // 2, h // 2)), (30, 90, 200))
    assert close(crop.getpixel((w // 2, int(h * 0.2))), (30, 90, 200))
    for corner in [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]:
        assert close(crop.getpixel(corner), (236, 236, 236))


def test_masked_crop_dilation_keeps_the_pixels_just_outside_the_mask_edge():
    image = Image.new("RGB", (400, 400), (30, 90, 200))
    det = dial(100, 100, 200, radius=80)
    url, _ = masked_crop_data_url(image, det)
    crop = decode_url(url)
    w, h = crop.size
    just_outside = int(w / 2 + (80 + 1) / 216 * w)
    assert close(crop.getpixel((just_outside, h // 2)), (30, 90, 200))
    assert close(crop.getpixel((int(w / 2 + 86 / 216 * w), h // 2)), (236, 236, 236))


def test_masked_crop_uses_the_mask_bounds_when_they_differ_from_the_box():
    image = Image.new("RGB", (800, 600), (30, 90, 200))
    det = Detection(object_id=0, frame=0, box=(100, 100, 300, 300), frame_size=(800, 600),
                    mask_h=100, mask_w=100, raster=bytes([1]) * (100 * 100),
                    mask_bounds=(100, 100, 200, 200))
    crop = decode_url(masked_crop_data_url(image, det)[0])
    w, h = crop.size
    assert close(crop.getpixel((int(w * 0.25), int(h * 0.25))), (30, 90, 200))
    assert close(crop.getpixel((int(w * 0.8), int(h * 0.8))), (236, 236, 236))


def test_masked_crop_without_a_raster_falls_back_to_the_plain_box_crop():
    image = Image.new("RGB", (800, 600), (30, 90, 200))
    det = Detection(object_id=0, frame=0, box=(100, 120, 300, 320), frame_size=(800, 600))
    url, applied = masked_crop_data_url(image, det)
    crop = decode_url(url)
    assert applied is False
    assert close(crop.getpixel((3, 3)), (30, 90, 200))


def test_masked_crop_rejects_a_raster_of_the_wrong_length_and_an_empty_mask():
    image = Image.new("RGB", (800, 600), (30, 90, 200))
    wrong = Detection(object_id=0, frame=0, box=(100, 120, 300, 320), frame_size=(800, 600),
                      mask_h=10, mask_w=10, raster=bytes(5))
    empty = Detection(object_id=0, frame=0, box=(100, 120, 300, 320), frame_size=(800, 600),
                      mask_h=10, mask_w=10, raster=bytes(100))
    assert masked_crop_data_url(image, wrong)[1] is False
    assert masked_crop_data_url(image, empty)[1] is False


def test_parse_psi_reads_the_psi_line_strictly():
    assert parse_psi("The tip is past 20.\nSCALE: red psi\nBETWEEN: 20 and 40\nPSI: 24") == 24.0
    assert parse_psi("psi: 17.5") == 17.5
    assert parse_psi("**PSI:** 22") == 22.0
    assert parse_psi("PSI: 18\nPSI: 21") == 21.0
    assert parse_psi("PSI: UNREADABLE") is None
    assert parse_psi("PSI: 140") is None
    assert parse_psi("PSI: -5") is None
    assert parse_psi("The needle is near 24 psi") is None
    assert parse_psi("BETWEEN: 20 and 40") is None
    assert parse_psi("") is None


async def test_wonder_reader_sends_only_the_masked_crop_and_keeps_the_reasoning():
    class Reply:
        text = "Pointer between 20 and 40.\nSCALE: red psi\nBETWEEN: 20 and 40\nPSI: 23.5"

    class FakeWonder:
        def __init__(self):
            self.calls = []

        async def create(self, input_items, tools, *, reasoning_effort):
            self.calls.append((input_items, tools, reasoning_effort))
            return Reply()

    wonder = FakeWonder()
    answer = await WonderGaugeReader(wonder).read_gauge("data:image/jpeg;base64,AAAA", "PI-201", "inlet gauge")
    assert answer.value == 23.5 and "BETWEEN: 20 and 40" in answer.reasoning
    items, tools, effort = wonder.calls[0]
    content = items[0]["content"]
    assert effort == "medium" and tools == []
    assert [c["type"] for c in content] == ["input_text", "input_image"]
    assert "PI-201" in content[0]["text"] and "inlet gauge" in content[0]["text"] and "RED" in content[0]["text"]
    Reply.text = "x" * 2000 + "\nPSI: UNREADABLE"
    unread = await WonderGaugeReader(wonder).read_gauge("data:image/jpeg;base64,AAAA", "PI-201", "")
    assert unread.value is None and len(unread.reasoning) == 600


async def test_wonder_reader_retries_once_on_an_empty_reply():
    replies = ["", "PSI: 14"]

    class FakeWonder:
        calls = 0

        async def create(self, input_items, tools, *, reasoning_effort):
            FakeWonder.calls += 1
            return type("Reply", (), {"text": replies.pop(0)})()

    answer = await WonderGaugeReader(FakeWonder()).read_gauge("data:image/jpeg;base64,AAAA", "PI-201", "")
    assert answer.value == 14.0 and FakeWonder.calls == 2


def test_largest_detection_picks_the_dial_that_fills_the_photo():
    small, big = box(50, 40, 40), box(200, 150, 160)
    assert largest_detection([small, big]) is big
    assert largest_detection([]) is None


def test_two_similar_dials_are_ambiguous_but_a_small_second_dial_is_not():
    assert is_ambiguous([box(0, 0, 100), box(300, 0, 80)]) is True
    assert is_ambiguous([box(0, 0, 100), box(300, 0, 70)]) is False
    assert is_ambiguous([box(0, 0, 100)]) is False
    assert is_ambiguous([]) is False


async def test_pipeline_reads_the_dial_in_one_photo():
    pack = load_pack(PACK_DIR)
    inlet = next(i for i in pack.instruments if i.tag == "PI-201")
    reader = FakeReader({"PI-201": 24.0})
    sam = FakeSam([dial(100, 120, 300), box(600, 40, 40)])
    reading = await GaugePipeline(sam=sam, reader=reader).read_photo(photo_bytes(), inlet)
    assert reading.status == "read" and reading.value == 24.0 and reading.mask_applied is True
    assert reading.box == (100, 120, 400, 420) and "PSI: 24" in reading.wonder_reasoning
    assert sam.concepts == ["pressure gauge"]
    assert len(reader.calls) == 1 and reader.calls[0][1] == "PI-201"
    sent = decode_url(reader.calls[0][0])
    assert close(sent.getpixel((2, 2)), (236, 236, 236))
    payload = reading.to_json()
    assert set(payload) == {"tag", "box", "sam_confidence", "mask_applied", "value", "wonder_reasoning", "status"}


async def test_pipeline_never_invents_a_value():
    pack = load_pack(PACK_DIR)
    inlet = next(i for i in pack.instruments if i.tag == "PI-201")
    missing = await GaugePipeline(sam=FakeSam([]), reader=FakeReader({})).read_photo(photo_bytes(), inlet)
    assert missing.status == "not_found" and missing.value is None and missing.box is None
    unread = await GaugePipeline(sam=FakeSam([dial(100, 120, 300)]), reader=FakeReader({})).read_photo(photo_bytes(), inlet)
    assert unread.status == "unreadable" and unread.value is None and unread.wonder_reasoning

    reader = FakeReader({"PI-201": 24.0})
    two = await GaugePipeline(sam=FakeSam([dial(50, 100, 300), dial(430, 100, 280)]), reader=reader).read_photo(photo_bytes(), inlet)
    assert two.status == "ambiguous" and two.value is None and reader.calls == []


async def test_pipeline_without_a_raster_reads_the_plain_crop():
    pack = load_pack(PACK_DIR)
    inlet = next(i for i in pack.instruments if i.tag == "PI-201")
    plain = Detection(object_id=0, frame=0, box=(100, 120, 400, 420), frame_size=(800, 600))
    reading = await GaugePipeline(sam=FakeSam([plain]), reader=FakeReader({"PI-201": 24.0})).read_photo(photo_bytes(), inlet)
    assert reading.status == "read" and reading.mask_applied is False


def test_differential_flags_a_restricted_bank_only_at_the_limit():
    pack = load_pack(PACK_DIR)
    healthy = compute_differential({"PI-201": 24.0, "PI-202": 16.0}, pack.instruments)
    assert healthy.dp_psi == 8.0 and healthy.normal_dp_psi == 8.0 and healthy.limit_dp_psi == 12.0
    assert healthy.restricted is False
    assert compute_differential({"PI-201": 27.0, "PI-202": 16.0}, pack.instruments).restricted is False
    fault = compute_differential({"PI-201": 32.0, "PI-202": 15.0}, pack.instruments)
    assert fault.dp_psi == 17.0 and fault.restricted is True
    assert compute_differential({"PI-201": 24.0}, pack.instruments) is None
