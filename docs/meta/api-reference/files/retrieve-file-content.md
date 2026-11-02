# Retrieve file content

Download the raw contents of a previously uploaded file by its ID.

## GET /files/{file\_id}/content

Download the contents of an uploaded file.

### Parameters

#### Path parameters

| Field     | Type   | Required | Description                       |
| --------- | ------ | -------- | --------------------------------- |
| `file_id` | string | Yes      | Identifier of the file to act on. |

### Response

`HTTP 200` — The file content as raw bytes.

#### Content Type: application/octet-stream

`string (binary)`

```shell
curl -X GET "https://api.meta.ai/v1/files/file_abc123/content" \
  -H "Authorization: Bearer $MODEL_API_KEY"
```

For file metadata, see [Retrieve a file](https://dev.meta.ai/docs/api-reference/files/retrieve-file).
