# Meta Model API and Muse Code docs (mirror)

Fetched 2026-11-01 from `https://dev.meta.ai/llms.txt` (154 Markdown pages, saved with the
same paths minus `/docs/`) and the public cookbook repo `meta-models/meta-model-cookbook`
(`samples-cookbook-repo/`, images/video and the robotics sample removed). Re-fetch rather than
editing; these are third-party docs and may change. Muse Wonder is a **preview** model.

Model API: base URL `https://api.meta.ai/v1`, key in `MODEL_API_KEY` (OpenAI-SDK compatible).
Muse Code headless/CI uses `META_API_KEY`.

## Read first (for FAULTGLASS)

| Need | Doc |
| --- | --- |
| Models, IDs, availability, Wonder notes | `models.md` |
| First call, any-SDK setup | `quickstart.md`, `authentication.md` |
| Prices, rate limits | `pricing-rate-limits.md` |
| Wonder loop: Responses API, continuation | `protocols/responses.md`, `reasoning.md` |
| Tool calling (the pause/resume tools) | `tool-calling.md`, `tool-search.md`, `structured-output.md` |
| Gauge/valve photos | `image-understanding.md`, `file-handling.md` |
| Locate gauges/handles | `media-segmentation.md`, `sam/*.md` |
| Marathi audio | `speech-to-text.md`, `api-reference/voice/*.md` |
| Errors and retries | `error-handling.md`, `cookbook/error-handling-retry.md` |
| Muse Code overview, headless, SDK | `muse-code.md`, `muse-code/extending.md`, `muse-code/auth.md` |
| Muse Code safety model | `muse-code/permissions.md` |

## Muse Wonder (`muse-wonder-1.0`)

- Text/image/video/audio/PDF in, text out; 1,048,576-token context; Model API Standard mode only, plus Muse Code.
- Reasoning effort `minimal` to `max` (`none` is rejected with HTTP 400). Supports tool calling, structured output, search grounding.
- $4.00 input / $20.00 output / $0.20 cached input per 1M tokens. Not available in South Korea.
- "Muse Wonder Full" exists only inside Muse Code on the top subscription plans.

```python
import os
from openai import OpenAI

client = OpenAI(base_url="https://api.meta.ai/v1", api_key=os.environ["MODEL_API_KEY"])
resp = client.responses.create(
    model="muse-wonder-1.0",
    reasoning={"effort": "high"},
    input="FIT-301 reads 720 LPH against a 1000 LPH baseline. Which single check discriminates the causes?",
)
print(resp.output_text)
```

## Muse Code

Terminal/CI coding agent (not a Model API model ID). Install `curl -fsSL https://dev.meta.ai/install.sh | sh`,
run `muse` (interactive) or `muse exec "<prompt>"` (headless). `muse serve` + `@muse-code/sdk`
(docs: https://meta-models.github.io/muse-code-sdk, JS-rendered, not mirrored) drive it from code.
Approvals and an OS sandbox are on by default.

## Sample projects (`samples-cookbook-repo/`)

| Folder | Why it matters here |
| --- | --- |
| `02_agent_patterns/01_agent_loop_basics` | Loop with guards (max iterations, token budget) |
| `02_agent_patterns/02_interleaved_reasoning` | Reasoning carried across tool calls |
| `02_agent_patterns/03_managing_context` | Whole-turn context management |
| `02_agent_patterns/05_alert_fatigue_copilot` | Alert triage with a JSON-schema validator as oracle |
| `01_api_fundamentals/` | Chat/Responses/streaming/structured output/vision basics |
| `06_muse_voice/01_voice_api_fundamentals` | File and streaming transcription scripts |
| `07_sam/01_api_basics` | Segmenting an image from a noun phrase (Python and TS) |
| `04_muse_code/03_staged_approvals`, `05_immutable_guardrails` | Deterministic policy around an agent |
| `04_muse_code/02_deterministic_replay`, `01_append_only_audit_log` | Replay and audit-trail ideas |
| `03_use_cases/10_perception_grounding` | Locating objects in images |
