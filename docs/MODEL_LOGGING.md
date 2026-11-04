# Recording real model calls in CloudWatch

The backend emits structured metadata for each attempted Wonder or Spark request.
The demo forwarder collects those records from Lightsail into a single CloudWatch
log group. It does not manufacture requests or successful responses.

```text
Meta / Baseten HTTP call
  -> backend JSON stdout
  -> Lightsail: api / watcher / investigator logs
  -> deploy/forward_model_logs.py (keep running in AWS CloudShell)
  -> CloudWatch /faultglass/model-calls
  -> AWS console Live Tail
```

## What was missing

The API, watcher and investigator are separate containers. The API container's
access log cannot show the investigator's requests. Previously, the model clients
did not emit per-request events, HTTP client request logging was suppressed, and
the watcher logged idle/baseline skips at DEBUG. `PYTHONUNBUFFERED=1` was already
set in the image; enabling it again would not supply the missing events.

Lightsail exposes each container's stdout/stderr separately and retains the latest
three days. The current deployment has no CloudWatch forwarding configuration.
See [AWS's Lightsail log documentation](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-viewing-container-service-container-logs.html).

## Before starting

1. Build and deploy a backend image containing the new instrumentation. The
   existing `.github/workflows/backend-image.yml` builds on a backend change;
   deploy that image with the existing `deploy/deploy.sh` flow. Merely building an
   image does not update a running Lightsail deployment.
2. Open AWS CloudShell in the intended AWS account; the Python collector uses
   Python 3 and the AWS CLI already available there. No package installation is
   needed. Never put AWS access keys into the frontend or application containers.
   For the optional Windows collector, use PowerShell 7.2+ and AWS CLI v2 with an
   approved local profile.
3. Use the correct region and service. Defaults are `eu-west-3` and `faultglass`.
   The profile must be able to read the source logs and write the destination.

At implementation time, this workspace had no usable AWS CLI profile; the default
profile was missing. No live deployment, CloudWatch creation or end-to-end model
call was verified from this workspace.

## Start in AWS CloudShell

These new local files must first reach GitHub, and the backend image containing
the logging changes must be built and deployed. Running the collector against an
older image cannot create missing model-call events. The following commands fetch
the repository and start collection; they do not deploy the backend:

```bash
aws sts get-caller-identity
git clone https://github.com/Shantanu-00/FAULTGLASS.git
cd FAULTGLASS
python3 deploy/forward_model_logs.py --region eu-west-3 --service faultglass --group /faultglass/model-calls --initialize
```

If the repository is already present in CloudShell, enter that checkout and run
`git pull --ff-only` instead of cloning it again. Use the existing deployment
configuration when rolling out the updated image; `deploy/deploy.sh` requires a
configured repository `.env` and should not be run blindly in a fresh CloudShell.

The collector uses CloudShell's AWS credentials; no `aws configure` or pasted keys
are needed. Keep this CloudShell process running throughout the recording. In
another browser tab, open CloudWatch in `eu-west-3`, select Live Tail and choose
`/faultglass/model-calls`. `--initialize` creates a Standard group and source
streams; it sets seven-day retention only for a newly created group. Later runs
can omit `--initialize`. `--once` collects a single poll. Ctrl+C stops collection.
The CloudShell session must stay active; this is not a permanent cloud service.

## Optional: start from Windows

From the repository root in PowerShell, replace `demo` with your actual profile:

```powershell
aws sts get-caller-identity --profile demo
pwsh -NoProfile -File ./deploy/forward-model-logs.ps1 -Profile demo -Initialize
```

`-Initialize` creates the Standard log group `/faultglass/model-calls` and the
streams `faultglass/api`, `faultglass/watcher` and `faultglass/investigator`. It
sets seven-day retention only when it creates a new group; an existing group's
retention is preserved. Repeating initialization is safe for an existing Standard
group and existing streams. Change `-RetentionDays` to choose a new group's policy.

Later sessions can omit initialization:

```powershell
pwsh -NoProfile -File ./deploy/forward-model-logs.ps1 -Profile demo
```

Keep that terminal and computer running during recording. Ctrl+C stops
forwarding. `-Once` reads every page and forwards currently available records once,
then exits; it is useful for a pre-recording check. `-Service`, `-Region`,
`-LogGroup`, `-Containers`, `-PollSeconds` and `-LookbackMinutes` are configurable.
Omit `-Profile` to use the normal AWS credential chain if it is already configured.

The forwarder polls every five seconds and initially includes ten minutes of
history. Its start cutoff stays fixed during the session so later-arriving source
entries are revisited. It reads all pages, sorts uploads by event time and marks
accepted events sent only after CloudWatch confirms them. Partial rejections
acknowledge accepted entries, quarantine expired/too-old entries with a warning,
and keep future entries retryable. Duplicate records in overlapping
polls are suppressed in memory. Restarting the forwarder can replay its lookback
window; a network failure after AWS accepts a request can also produce a duplicate.
Use `call_id` plus `event` to recognize these records. This is a bounded demo
collector, not a persistent production logging service. Long sessions cause more
source records to be reread; restart deliberately between rehearsals.

## Permissions

Use a CloudShell or local identity with these permissions. Substitute the account ID, region and
group name in the resource scopes. Keep initialization permissions separate from
routine forwarding if your AWS setup requires it.

| Purpose | IAM actions | Scope |
| --- | --- | --- |
| Read source container logs | `lightsail:GetContainerLog` | `Resource: "*"`; AWS does not support a resource ARN for this action. Restrict `aws:RequestedRegion` to the demo region. |
| Create the destination | `logs:CreateLogGroup`, `logs:PutRetentionPolicy` | The `/faultglass/model-calls` log group ARN, using the resource syntax required by the action. |
| Validate destination class during initialization | `logs:DescribeLogGroups` | `Resource: "*"`, restricted to the demo region. |
| Create streams and upload | `logs:CreateLogStream`, `logs:PutLogEvents` | `arn:aws:logs:eu-west-3:ACCOUNT_ID:log-group:/faultglass/model-calls:log-stream:faultglass/*` |

The person viewing Live Tail also needs `logs:StartLiveTail` and
`logs:StopLiveTail`, and the console's log-group/stream listing permissions.
Insights queries require `logs:StartQuery`, `logs:GetQueryResults` and
`logs:StopQuery`. Apply each action's supported resource scope from the
[CloudWatch Logs authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_logs.html)
and the [Lightsail authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_lightsail.html).

## Show the telemetry in the video

1. Open CloudWatch in `eu-west-3`, choose **Logs -> Live Tail**, select
   `/faultglass/model-calls` and start the session. Live Tail requires a Standard
   log group and incurs session charges; ingestion and storage have their own
   CloudWatch charges. It streams newly ingested records rather than the complete
   historical view. See [AWS Live Tail documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogs_LiveTail.html).
2. Start the application demo and keep the app open so the simulation heartbeat
   stays active. Let baseline learning finish. The watcher does not call Spark
   before an eligible running simulation has data.
3. Watch `model_call.started` followed by `model_call.succeeded` for provider
   `baseten`, model `meta-models/muse-spark-open-1026`. A successful API response is
   separate from whether Python accepts the model's verdict as a valid flag.
4. Trigger the supported production-drift scenario. Once Spark raises an incident,
   show Wonder calls with the same incident correlation and their tool names.
5. When a field task requests evidence, use the contextual inlet, outlet, audio or
   lever sample control and then submit normally. Selection alone does not make a
   model call. Field analysis calls run in the API container; continued
   investigation calls run in the investigator container.
6. Show `watcher.assessed` alongside the calls: its bounded `measurements` object
   records each available sensor's `current` and `baseline`, with Spark's parsed
   verdict, validated tags and Python's outcome (`normal`, `rejected`, `duplicate`,
   `flagged` or `watched`). These are assessment snapshots, not every raw telemetry
   point. Pair them with the app's process chart and investigation trace;
   `run_id` and `incident_id` link the views. Plant telemetry in this demo is
   simulated, while model requests are real.

Allow for Lightsail publication, the five-second polling interval and CloudWatch
ingestion delay. Keep the forwarder terminal available to see any retry warning.
No entries while idle can be expected; `watcher.state_changed` explains states
such as no active run or baseline learning.

Useful Live Tail filter patterns:

```text
{ $.schema = "faultglass.model_call.v1" }
{ $.event = "model_call.succeeded" }
{ $.provider = "baseten" }
{ $.incident_id = "INC-REPLACE-WITH-ACTUAL-ID" }
{ $.event = "watcher.assessed" }
```

For a historical view, open Logs Insights for this group:

```sql
fields @timestamp, source_container, provider, model, event, duration_ms,
       usage.input_tokens, usage.output_tokens, usage.prompt_tokens,
       usage.completion_tokens, http_status, provider_request_id,
       run_id, incident_id, call_id, tool_names
| filter schema = "faultglass.model_call.v1"
| sort @timestamp asc
| limit 200
```

```sql
fields @timestamp, run_id, incident_id, verdict, outcome, validated_tags, measurements
| filter schema = "faultglass.watcher_assessment.v1"
| sort @timestamp asc
| limit 100
```

```sql
filter schema = "faultglass.model_call.v1" and event = "model_call.succeeded"
| stats count_distinct(call_id) as calls, avg(duration_ms) as average_ms,
        pct(duration_ms, 95) as p95_ms by provider, model
```

The events include only allowlisted metadata and numeric assessment snapshots.
Tokens appear only when the provider returns usage. Prompts, images, audio, API
keys, model response text, tool arguments and encrypted/internal reasoning are
excluded. A `started` record with no terminal
record may indicate an in-flight request, process interruption or delayed log
delivery; do not present it as a successful call.

## Local verification

```bash
python3 -m unittest discover -s tests/unit -p test_cloudwatch_forwarder.py
```

```powershell
pwsh -NoProfile -File ./tests/test_model_log_forwarder.ps1
```

This test replaces every AWS operation with a local fake. It checks pagination,
deduplication, allowed metadata, retry after upload failure, failure during a paged
read, partial timestamp rejections and retention preservation. Passing it validates collector behavior, not live
AWS credentials or a deployed service.
