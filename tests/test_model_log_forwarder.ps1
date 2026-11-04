#Requires -Version 7.2
# Offline integration checks. Every AWS command is replaced with an in-process fake.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../deploy/forward-model-logs.ps1"

function Assert-That([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "Assertion failed: $Message" }
}

$script:Mode = 'normal'
$script:Uploads = [System.Collections.Generic.List[object]]::new()
$script:RetentionCalls = 0
$script:ReadPages = 0
$timestamp = [DateTimeOffset]::UtcNow.AddSeconds(-30).ToString('o')
$script:Call = @{
    schema = 'faultglass.model_call.v1'; event = 'model_call.succeeded'
    timestamp = $timestamp; call_id = ('a' * 32); provider = 'meta'
    model = 'muse-wonder-1.0'; operation = 'responses'; duration_ms = 400
    incident_id = 'INC-test'; provider_request_id = 'request-123'
    usage = @{ input_tokens = 11; output_tokens = 7; authorization = 'PRIVATE'; total_tokens = -1 }
    authorization = 'PRIVATE'; prompt = 'PRIVATE'; reasoning = 'PRIVATE'
} | ConvertTo-Json -Compress -Depth 5
$script:State = @{
    schema = 'faultglass.watcher_state.v1'; event = 'watcher.state_changed'
    timestamp = [DateTimeOffset]::UtcNow.AddSeconds(-20).ToString('o'); state = 'no-run'
} | ConvertTo-Json -Compress
$script:Assessment = @{
    schema = 'faultglass.watcher_assessment.v1'; event = 'watcher.assessed'
    timestamp = [DateTimeOffset]::UtcNow.AddSeconds(-10).ToString('o')
    run_id = 'run-test'; incident_id = 'INC-test'; verdict = 'FLAG'; outcome = 'flagged'
    validated_tags = @('FIT-301'); model_summary = 'PRIVATE'
    measurements = @{ 'FIT-301' = @{ current = 1500.5; baseline = 2000; prompt = 'PRIVATE' }; 'PIT-301' = @{ current = 'PRIVATE'; baseline = 1e13 } }
} | ConvertTo-Json -Compress -Depth 6

function Invoke-LogAws {
    param([string[]]$Arguments)
    switch ($Arguments[1]) {
        'get-container-log' {
            $script:ReadPages++
            if ($Arguments -contains '--page-token') {
                if ($script:Mode -eq 'fail-read') { throw '[AWS:ThrottlingException] mocked page failure' }
                return @{ logEvents = @(@{ message = $script:Call }, @{ message = $script:State }, @{ message = $script:Assessment }) }
            }
            return @{
                logEvents = @(@{ message = $script:Call }, @{ message = 'ordinary application log' },
                    @{ message = '{"schema":"unrelated","event":"model_call.succeeded"}' })
                nextPageToken = 'page-two'
            }
        }
        'put-log-events' {
            if ($script:Mode -eq 'fail-upload') { throw '[AWS:ThrottlingException] mocked upload failure' }
            $path = $Arguments[3].Substring('file://'.Length)
            $script:Uploads.Add((Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -AsHashtable))
            if ($script:Mode -eq 'partial') {
                return @{ rejectedLogEventsInfo = @{ tooOldLogEventEndIndex = 0; tooNewLogEventStartIndex = 2 } }
            }
            return @{}
        }
        'create-log-group' {
            if ($script:Mode -eq 'existing') { throw '[AWS:ResourceAlreadyExistsException] exists' }
            return @{}
        }
        'describe-log-groups' {
            return @{ logGroups = @(@{ logGroupName = $LogGroup; logGroupClass = 'STANDARD' }) }
        }
        'put-retention-policy' { $script:RetentionCalls++; return @{} }
        'create-log-stream' {
            if ($script:Mode -eq 'existing') { throw '[AWS:ResourceAlreadyExistsException] exists' }
            return @{}
        }
        default { throw "Unexpected offline AWS command: $($Arguments[1])" }
    }
}

$sent = [System.Collections.Generic.HashSet[string]]::new()
$count = Forward-ContainerLogs -Container investigator -StartTime 1 -Sent $sent
Assert-That ($count -eq 3 -and $script:ReadPages -eq 2) 'all pages are read and duplicate records collapse'
Assert-That ($sent.Count -eq 3 -and $script:Uploads.Count -eq 1) 'successful upload is acknowledged'
$payload = $script:Uploads[0]
Assert-That ($payload.logEvents.Count -eq 3) 'only the three allowed records are forwarded'
Assert-That ($payload.logEvents[0].timestamp -lt $payload.logEvents[1].timestamp) 'CloudWatch event order is chronological'
$model = $payload.logEvents[0].message | ConvertFrom-Json -AsHashtable
Assert-That ($model.source_container -eq 'investigator' -and $model.incident_id -eq 'INC-test') 'correlation and source survive'
Assert-That ($model.usage.input_tokens -eq 11 -and -not $model.usage.ContainsKey('total_tokens')) 'numeric usage is allowlisted'
Assert-That (($payload | ConvertTo-Json -Depth 12) -notmatch 'PRIVATE') 'arbitrary prompt, reasoning and credential fields are stripped'
$parsedAssessment = $payload.logEvents[2].message | ConvertFrom-Json -AsHashtable
Assert-That ($parsedAssessment.verdict -eq 'FLAG' -and $parsedAssessment.outcome -eq 'flagged') 'parsed verdict and deterministic outcome survive'
Assert-That ($parsedAssessment.measurements['FIT-301'].current -eq 1500.5 -and -not $parsedAssessment.measurements.ContainsKey('PIT-301')) 'bounded numeric telemetry survives without arbitrary sensor fields'
$count = Forward-ContainerLogs -Container investigator -StartTime 1 -Sent $sent
Assert-That ($count -eq 0 -and $script:Uploads.Count -eq 1) 'overlapping polls do not re-upload acknowledged events'

$script:Mode = 'fail-upload'
$retry = [System.Collections.Generic.HashSet[string]]::new()
$failed = $false
try { $null = Forward-ContainerLogs -Container watcher -StartTime 1 -Sent $retry }
catch { $failed = $true }
Assert-That ($failed -and $retry.Count -eq 0) 'failed uploads stay retryable'
$script:Mode = 'normal'
$count = Forward-ContainerLogs -Container watcher -StartTime 1 -Sent $retry
Assert-That ($count -eq 3 -and $retry.Count -eq 3) 'the next poll retries the complete failed batch'

$script:Mode = 'fail-read'
$unread = [System.Collections.Generic.HashSet[string]]::new()
$before = $script:Uploads.Count
$failed = $false
try { $null = Forward-ContainerLogs -Container api -StartTime 1 -Sent $unread }
catch { $failed = $true }
Assert-That ($failed -and $unread.Count -eq 0 -and $script:Uploads.Count -eq $before) 'a failed page never advances collection or sends an incomplete poll'

$script:Mode = 'existing'
Initialize-LogDestination
Assert-That ($script:RetentionCalls -eq 0) 'existing log group retention is preserved'
$script:Mode = 'normal'
Initialize-LogDestination
Assert-That ($script:RetentionCalls -eq 1) 'new log groups receive the chosen retention policy'

$script:Mode = 'partial'
$partial = [System.Collections.Generic.HashSet[string]]::new()
$events = @($script:Call, $script:State, $script:Assessment) | ForEach-Object { ConvertTo-SafeLogEvent -Message $_ -Container api }
$accepted = Send-LogBatch -Events $events -Container api -Sent $partial -WarningAction SilentlyContinue
Assert-That ($accepted -eq 1 -and $partial.Count -eq 2) 'partial rejection acknowledges accepted events and quarantines stale events'
Assert-That (-not $partial.Contains($events[2].Key)) 'future events remain retryable'

$bad = ConvertTo-SafeLogEvent -Message '{"schema":"faultglass.model_call.v1","event":"model_call.succeeded","timestamp":"bad"}' -Container api
Assert-That ($null -eq $bad) 'malformed model records are ignored'
Write-Host 'PASS: pagination, deduplication, safe export, retry, failed-page recovery, retention and malformed records (offline; no AWS calls).'
