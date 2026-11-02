# Cancel a response

Cancel an in-progress response. Only responses created for background processing can be cancelled.

## POST /responses/{response\_id}/cancel

Cancel a background model response by ID.

### Parameters

#### Path parameters

| Field         | Type   | Required | Description                       |
| ------------- | ------ | -------- | --------------------------------- |
| `response_id` | string | Yes      | The ID of the response to cancel. |

### Response

`HTTP 200` — OK

#### Content Type: application/json

[`CancelResponseResponse`](https://dev.meta.ai/docs/api-reference/responses/schemas#cancel-response-response)

**Python (OpenAI SDK)**

```python
import os

from openai import OpenAI

client = OpenAI(
    base_url="https://api.meta.ai/v1",
    api_key=os.environ["MODEL_API_KEY"],
)

response = client.responses.cancel("resp_abc123")

print(response.model_dump_json(indent=2))
```

**Python (requests)**

```python
import json
import os

import requests

response = requests.post(
    "https://api.meta.ai/v1/responses/resp_abc123/cancel",
    headers={"Authorization": f"Bearer {os.environ['MODEL_API_KEY']}"},
)
response.raise_for_status()
print(json.dumps(response.json(), indent=2))
```

**curl**

```shell
curl -X POST "https://api.meta.ai/v1/responses/resp_abc123/cancel" \
  -H "Authorization: Bearer $MODEL_API_KEY"
```

For usage examples and background-processing guidance, see the [Responses](https://dev.meta.ai/docs/protocols/responses) feature page.
