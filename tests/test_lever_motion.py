import math

from PIL import Image, ImageDraw

from app.evidence.lever import build_lever_motion
from app.evidence.sam import Detection
from app.evidence.valve import evaluate_lever_motion

FPS = 10.0
SIZE = (300, 400)
PIVOT = (150.0, 150.0)
LENGTH = 100.0
LEVER_ID, DRAIN_ID, HAND_ID, PIPE_ID = 1, 2, 7, 9


def detection(object_id, frame, draw):
    img = Image.new("L", SIZE, 0)
    draw(ImageDraw.Draw(img))
    bbox = img.getbbox()
    if bbox is None:
        return None
    crop = img.crop(bbox)
    raster = bytes(1 if v else 0 for v in crop.tobytes())
    return Detection(object_id=object_id, frame=frame, box=bbox, frame_size=SIZE,
                     mask_w=crop.size[0], mask_h=crop.size[1], raster=raster)


def lever_polygon(angle, shift, width=12.0):
    ux, uy = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    nx, ny = -uy * width / 2, ux * width / 2
    px, py = PIVOT[0] + shift[0], PIVOT[1] + shift[1]
    tx, ty = px + ux * LENGTH, py + uy * LENGTH
    return [(px + nx, py + ny), (tx + nx, ty + ny), (tx - nx, ty - ny), (px - nx, py - ny)]


def fist(angle, shift, along=0.85, radius=16):
    ux, uy = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    cx = PIVOT[0] + shift[0] + ux * LENGTH * along
    cy = PIVOT[1] + shift[1] + uy * LENGTH * along
    return [cx - radius, cy - radius, cx + radius, cy + radius]


def scene(angles, *, shake=False, drain=True, hand_away=False, grips=None):
    """Detections (handles, hands, pipes) for a lever following `angles`, one entry per frame."""
    handles, hands, pipes = [], [], []
    for i, angle in enumerate(angles):
        shift = (((i * 7) % 21) - 10, ((i * 5) % 13) - 6) if shake else (0, 0)
        handles.append(detection(LEVER_ID, i, lambda d: d.polygon(lever_polygon(angle, shift), fill=255)))
        if drain:
            handles.append(detection(DRAIN_ID, i, lambda d: d.rectangle(
                [40 + shift[0], 320 + shift[1], 100 + shift[0], 334 + shift[1]], fill=255)))
        pipes.append(detection(PIPE_ID, i, lambda d: d.rectangle(
            [230 + shift[0], 20 + shift[1], 250 + shift[0], 380 + shift[1]], fill=255)))
        if hand_away:
            box = [20 + shift[0], 20 + shift[1], 52 + shift[0], 52 + shift[1]]
        else:
            box = fist(angle, shift, along=grips[i] if grips else 0.85)
        hands.append(detection(HAND_ID, i, lambda d: d.ellipse(box, fill=255)))
    return handles, hands, pipes


def ramp(a, b, n):
    return [a + (b - a) * (k + 1) / n for k in range(n)]


def staged(hold_frames=25):
    return [0.0] * 10 + ramp(0, 45, 5) + [45.0] * hold_frames + ramp(45, 90, 5) + [90.0] * 15


def evaluate(handles, hands, pipes=()):
    motion = build_lever_motion(handles, hands, list(pipes), FPS)
    return motion, evaluate_lever_motion(motion, FPS)


def test_staged_two_moves_pass_and_still_handle_is_reference():
    handles, hands, _ = scene(staged())
    motion, policy = evaluate(handles, hands)
    assert motion.operated_ids == [LEVER_ID]
    assert motion.reference_ids == [DRAIN_ID] and motion.camera_reference == "handles"
    assert policy.status == "passed", policy.reasons
    assert policy.movements == 2 and policy.hold_s >= 2.0
    assert [s["kind"] for s in policy.segments] == ["still", "moving", "still", "moving", "still"]
    out = policy.to_json()
    assert out["required"].startswith("two hand-driven movements") and out["min_hold_s"] == 2.0
    assert "deg" not in str(out) and "angle" not in str(motion.to_json())


def test_staged_moves_pass_with_camera_shake():
    handles, hands, _ = scene(staged(), shake=True)
    _, policy = evaluate(handles, hands)
    assert policy.status == "passed", policy.reasons


def test_pipe_is_fallback_reference():
    handles, hands, pipes = scene(staged(), drain=False, shake=True)
    motion, policy = evaluate(handles, hands, pipes)
    assert motion.camera_reference == "pipe"
    assert policy.status == "passed", policy.reasons


def test_one_continuous_move_is_violated():
    handles, hands, _ = scene([0.0] * 10 + ramp(0, 90, 10) + [90.0] * 15)
    _, policy = evaluate(handles, hands)
    assert policy.status == "violated" and policy.movements == 1


def test_short_hold_is_violated():
    handles, hands, _ = scene(staged(hold_frames=12))
    _, policy = evaluate(handles, hands)
    assert policy.status == "violated", policy.reasons
    assert policy.movements == 2 and policy.hold_s < 2.0


def test_three_moves_are_uncertain():
    angles = staged() + ramp(90, 45, 5) + [45.0] * 15
    handles, hands, _ = scene(angles)
    _, policy = evaluate(handles, hands)
    assert policy.status == "uncertain" and policy.movements == 3


def test_regrip_on_still_lever_is_not_movement():
    grips = [0.85 if (i // 8) % 2 == 0 else 0.55 for i in range(50)]
    handles, hands, _ = scene([0.0] * 50, grips=grips)
    motion, policy = evaluate(handles, hands)
    assert not any(f.moving for f in motion.frames)
    assert policy.movements == 0 and policy.status == "uncertain"


def test_camera_shake_on_still_scene_is_not_movement():
    handles, hands, _ = scene([45.0] * 50, shake=True)
    motion, _ = evaluate(handles, hands)
    assert not any(f.moving for f in motion.frames)


def test_no_hand_contact_is_uncertain():
    handles, hands, _ = scene(staged(), hand_away=True)
    _, policy = evaluate(handles, hands)
    assert policy.status == "uncertain" and "hand" in policy.reasons[0]


def test_no_fixed_reference_is_uncertain():
    handles, hands, _ = scene(staged(), drain=False)
    motion, policy = evaluate(handles, hands)
    assert motion.camera_reference == "none"
    assert policy.status == "uncertain" and "fixed object" in policy.reasons[0]


def test_no_handle_or_fps_is_uncertain():
    assert evaluate_lever_motion(build_lever_motion([], [], [], FPS), FPS).status == "uncertain"
    handles, hands, _ = scene(staged())
    assert evaluate_lever_motion(build_lever_motion(handles, hands, [], FPS), None).status == "uncertain"


def test_split_object_ids_are_stitched():
    handles, hands, _ = scene(staged())
    handles = [Detection(object_id=5, frame=d.frame, box=d.box, frame_size=d.frame_size, mask_w=d.mask_w,
                         mask_h=d.mask_h, raster=d.raster)
               if d.object_id == LEVER_ID and d.frame >= 30 else d for d in handles]
    motion, policy = evaluate(handles, hands)
    assert motion.operated_ids == [LEVER_ID, 5]
    assert policy.status == "passed", policy.reasons


def test_lever_creeping_through_the_pause_does_not_pass():
    angles = [0.0] * 10 + ramp(0, 30, 5) + ramp(30, 60, 25) + ramp(60, 90, 5) + [90.0] * 15
    handles, hands, _ = scene(angles)
    _, policy = evaluate(handles, hands)
    assert policy.status != "passed", policy.reasons
