SYNTHETIC - written for the demo, not an approved site procedure

# SOP-GEN-006: Manual valve position verification by photo

Rule: lever angle is taken from a photo, never by eye. Shoot the lever and the pipe it sits on in one frame, from a fixed spot. Segmentation (SAM 3.1) locates the lever and pipe; code measures the angle. A person's estimate does not count as verification.

Lever angle table (yellow quarter-turn levers): 0 deg = parallel to pipe = open; 45 deg = half, 50% of travel (a stage of the staged close, not a route state); 90 deg = perpendicular to pipe = closed, 100% of travel:

| Valve | Service | Backwash | Rinse |
| --- | --- | --- | --- |
| V-111 | 0 | 90 | 0 |
| V-112 | 0 | 90 | 90 |
| V-113 | 90 | 0 | 90 |
| V-114 | 90 | 0 | 90 |
| V-115 | 90 | 90 | 0 |

ACF-102 (V-221 to V-225) and SOF-103 (V-331 to V-335) use the same pattern with their own tags.

Steps:
1. Set the route under test: service, backwash or rinse.
2. Photograph each valve in the route with its pipe in frame.
3. Code measures each angle from the lever and pipe masks and compares with the table.
4. A mismatch is reported with tag, measured angle and expected angle. The operator corrects it and re-photographs.
5. Only the verifier's pass counts. The model never marks a valve correct.

Note: NV-301 is a needle valve, not a quarter-turn lever, and is not in this table. Numbers printed on some levers (e.g. #14, #17) are not mapped to V-tags; use the V-tags only.
