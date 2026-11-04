#Requires -Version 7.2
<#
.SYNOPSIS
Forward real FAULTGLASS model-call metadata from Lightsail to CloudWatch.
.EXAMPLE
./deploy/forward-model-logs.ps1 -Profile demo -Initialize
.EXAMPLE
./deploy/forward-model-logs.ps1 -Profile demo -Once
.NOTES
Keep this process running during the recording. No AWS keys enter the containers.
The fixed start time and in-memory deduplication are intended for a demo session,
not an unattended production log pipeline. See docs/MODEL_LOGGING.md.
#>
[CmdletBinding()]
param(
    [ValidatePattern('^[a-z0-9][a-z0-9-]{0,62}$')][string]$Service = 'faultglass',
    [string]$Region = 'eu-west-3',
    [string]$Profile,
    [ValidatePattern('^[.\-_/A-Za-z0-9#]+$')][string]$LogGroup = '/faultglass/model-calls',
    [string[]]$Containers = @('api', 'watcher', 'investigator'),
    [ValidateRange(1, 60)][int]$PollSeconds = 5,
    [ValidateRange(0, 1440)][int]$LookbackMinutes = 10,
    [ValidateSet(1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365)][int]$RetentionDays = 7,
    [switch]$Initialize,
    [switch]$Once
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-LogAws {
    param([string[]]$Arguments)
    $common = @('--region', $Region, '--output', 'json', '--no-cli-pager',
        '--cli-connect-timeout', '5', '--cli-read-timeout', '15')
    if ($Profile) { $common += @('--profile', $Profile) }
    # Do not echo AWS output on error; CLI diagnostics can include request values.
    $raw = & aws @Arguments @common 2>&1
    if ($LASTEXITCODE -ne 0) {
        $detail = $raw -join "`n"
        $code = 'AwsCommandFailed'
        if ($detail -match '\(([A-Za-z][A-Za-z0-9]+)\) when calling') { $code = $Matches[1] }
        elseif ($detail -match 'config profile.*could not be found') { $code = 'ProfileNotFound' }
        elseif ($detail -match 'Unable to locate credentials|SSO session.*expired|Token has expired') { $code = 'CredentialsUnavailable' }
        throw "[AWS:$code] $($Arguments[0]) $($Arguments[1]) failed. Check the profile, region, service name and IAM permissions."
    }
    $json = $raw -join "`n"
    if ([string]::IsNullOrWhiteSpace($json)) { return @{} }
    return ConvertFrom-Json -InputObject $json -AsHashtable -Depth 30
}

function Initialize-LogDestination {
    $created = $false
    try {
        $null = Invoke-LogAws @('logs', 'create-log-group', '--log-group-name', $LogGroup,
            '--log-group-class', 'STANDARD')
        $created = $true
    }
    catch {
        if ($_.Exception.Message -notmatch '\[AWS:ResourceAlreadyExistsException\]') { throw }
    }
    # Live Tail requires the Standard class. Preserve existing retention settings.
    $groups = Invoke-LogAws @('logs', 'describe-log-groups', '--log-group-name-prefix', $LogGroup)
    $group = @($groups.logGroups | Where-Object { $_.logGroupName -eq $LogGroup })
    if ($group.Count -ne 1) { throw "CloudWatch log group '$LogGroup' was not found." }
    if ($group[0].ContainsKey('logGroupClass') -and $group[0].logGroupClass -ne 'STANDARD') {
        throw "CloudWatch Live Tail requires a STANDARD log group. Choose a different -LogGroup."
    }
    if ($created) {
        $null = Invoke-LogAws @('logs', 'put-retention-policy', '--log-group-name', $LogGroup,
            '--retention-in-days', "$RetentionDays")
    }
    foreach ($container in $Containers) {
        try {
            $null = Invoke-LogAws @('logs', 'create-log-stream', '--log-group-name', $LogGroup,
                '--log-stream-name', "$Service/$container")
        }
        catch {
            if ($_.Exception.Message -notmatch '\[AWS:ResourceAlreadyExistsException\]') { throw }
        }
    }
}

function ConvertTo-SafeLogEvent {
    param([string]$Message, [string]$Container)
    if ($Message.Length -gt 32768) { return $null }
    try { $record = ConvertFrom-Json -InputObject $Message.Trim() -AsHashtable -Depth 12 }
    catch { return $null }
    if ($record -isnot [System.Collections.IDictionary]) { return $null }
    if (-not $record.Contains('schema') -or -not $record.Contains('event') -or -not $record.Contains('timestamp')) { return $null }
    $isCall = $record.schema -eq 'faultglass.model_call.v1'
    $isState = $record.schema -eq 'faultglass.watcher_state.v1'
    $isAssessment = $record.schema -eq 'faultglass.watcher_assessment.v1'
    if (-not ($isCall -or $isState -or $isAssessment)) { return $null }
    if ($isCall -and $record.event -notin @('model_call.started', 'model_call.succeeded', 'model_call.failed')) { return $null }
    if ($isState -and $record.event -ne 'watcher.state_changed') { return $null }
    if ($isAssessment -and ($record.event -ne 'watcher.assessed' -or
            -not $record.Contains('verdict') -or $record.verdict -notin @('NORMAL', 'WATCH', 'FLAG') -or
            -not $record.Contains('outcome') -or $record.outcome -notin @('normal', 'rejected', 'duplicate', 'flagged', 'watched'))) { return $null }
    $time = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$record.timestamp, [ref]$time)) { return $null }
    $identifier = '^[A-Za-z0-9_.:/@+\-]{1,160}$'
    if ($isCall) {
        foreach ($required in @('call_id', 'provider', 'model', 'operation')) {
            if (-not $record.Contains($required) -or [string]$record[$required] -notmatch $identifier) { return $null }
        }
        if ([string]$record.call_id -notmatch '^[a-fA-F0-9]{32}$') { return $null }
    }
    elseif ($isState -and (-not $record.Contains('state') -or [string]$record.state -notmatch $identifier)) { return $null }

    # Rebuild an allowlisted record: never forward arbitrary application log fields.
    $safe = [ordered]@{
        schema = $record.schema; event = $record.event
        timestamp = $time.ToUniversalTime().ToString('o')
        source_container = $Container; lightsail_service = $Service
    }
    foreach ($key in @('call_id', 'provider', 'model', 'operation', 'service', 'plant_id', 'run_id',
            'incident_id', 'task_id', 'purpose', 'provider_request_id', 'error_type', 'state')) {
        if ($record.Contains($key) -and $record[$key] -is [string] -and $record[$key] -match $identifier) {
            $safe[$key] = $record[$key]
        }
    }
    foreach ($key in @('step', 'duration_ms', 'http_status', 'tool_call_count')) {
        if ($record.Contains($key) -and ($record[$key] -is [long] -or $record[$key] -is [int]) -and $record[$key] -ge 0) {
            $safe[$key] = $record[$key]
        }
    }
    if ($record.Contains('tool_names') -and $record.tool_names -is [array]) {
        $safe.tool_names = @($record.tool_names | Where-Object { $_ -is [string] -and $_ -match $identifier } | Select-Object -First 64)
    }
    if ($record.Contains('usage') -and $record.usage -is [System.Collections.IDictionary]) {
        $usage = [ordered]@{}
        foreach ($key in @('input_tokens', 'output_tokens', 'total_tokens', 'prompt_tokens', 'completion_tokens')) {
            if ($record.usage.Contains($key) -and ($record.usage[$key] -is [long] -or $record.usage[$key] -is [int]) -and $record.usage[$key] -ge 0) {
                $usage[$key] = $record.usage[$key]
            }
        }
        if ($usage.Count) { $safe.usage = $usage }
    }
    if ($isAssessment) {
        $safe.verdict = $record.verdict; $safe.outcome = $record.outcome
        if ($record.Contains('validated_tags') -and $record.validated_tags -is [array]) {
            $safe.validated_tags = @($record.validated_tags | Where-Object { $_ -is [string] -and $_ -match $identifier } | Select-Object -First 16)
        }
        if ($record.Contains('measurements') -and $record.measurements -is [System.Collections.IDictionary]) {
            $measurements = [ordered]@{}
            foreach ($tag in @($record.measurements.Keys | Sort-Object | Select-Object -First 16)) {
                if ([string]$tag -notmatch $identifier -or $record.measurements[$tag] -isnot [System.Collections.IDictionary]) { continue }
                $reading = [ordered]@{}
                foreach ($key in @('current', 'baseline')) {
                    $value = $record.measurements[$tag][$key]
                    if (($value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal]) -and
                            [double]::IsFinite([double]$value) -and [Math]::Abs([double]$value) -le 1e12) {
                        $reading[$key] = $value
                    }
                }
                if ($reading.Count) { $measurements[$tag] = $reading }
            }
            $safe.measurements = $measurements
        }
    }
    $text = ConvertTo-Json -InputObject $safe -Depth 8 -Compress
    $identity = if ($isCall) { "$Container|$($record.call_id)|$($record.event)" } else { "$Container|$text" }
    $key = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($identity)))
    return @{ Key = $key; Timestamp = $time.ToUnixTimeMilliseconds(); Message = $text }
}

function Send-LogBatch {
    param([array]$Events, [string]$Container, [System.Collections.Generic.HashSet[string]]$Sent)
    if (-not $Events.Count) { return 0 }
    $payload = @{
        logGroupName = $LogGroup; logStreamName = "$Service/$Container"
        logEvents = @($Events | ForEach-Object { @{ timestamp = $_.Timestamp; message = $_.Message } })
    }
    $file = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($file, (ConvertTo-Json -InputObject $payload -Depth 10 -Compress), [Text.UTF8Encoding]::new($false))
        $result = Invoke-LogAws @('logs', 'put-log-events', '--cli-input-json', "file://$file")
        $oldEnd = -1; $newStart = $Events.Count
        if ($result.ContainsKey('rejectedLogEventsInfo')) {
            $rejected = $result.rejectedLogEventsInfo
            foreach ($key in @('expiredLogEventEndIndex', 'tooOldLogEventEndIndex')) {
                if ($rejected.ContainsKey($key)) { $oldEnd = [Math]::Max($oldEnd, [int]$rejected[$key]) }
            }
            if ($rejected.ContainsKey('tooNewLogEventStartIndex')) { $newStart = [int]$rejected.tooNewLogEventStartIndex }
        }
        $accepted = 0
        for ($index = 0; $index -lt $Events.Count; $index++) {
            # Expired entries are terminally quarantined in the session dedup set.
            if ($index -le $oldEnd) { $null = $Sent.Add($Events[$index].Key) }
            elseif ($index -lt $newStart) { $null = $Sent.Add($Events[$index].Key); $accepted++ }
        }
        if ($oldEnd -ge 0) { Write-Warning "Quarantined $($oldEnd + 1) expired/too-old events; they were not forwarded. Check retention." }
        if ($newStart -lt $Events.Count) { Write-Warning 'CloudWatch rejected future timestamps; only those events will retry. Check the system clock.' }
        return $accepted
    }
    finally { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
}

function Forward-ContainerLogs {
    param([string]$Container, [long]$StartTime, [System.Collections.Generic.HashSet[string]]$Sent)
    $pending = [System.Collections.Generic.Dictionary[string, object]]::new()
    $pageTokens = [System.Collections.Generic.HashSet[string]]::new()
    $token = $null
    do {
        $arguments = @('lightsail', 'get-container-log', '--service-name', $Service,
            '--container-name', $Container, '--start-time', "$StartTime")
        if ($token) { $arguments += @('--page-token', $token) }
        $page = Invoke-LogAws $arguments
        foreach ($line in $page.logEvents) {
            $event = ConvertTo-SafeLogEvent -Message $line.message -Container $Container
            if ($event -and -not $Sent.Contains($event.Key)) { $pending[$event.Key] = $event }
        }
        $token = if ($page.ContainsKey('nextPageToken')) { $page.nextPageToken } else { $null }
        if ($token -and -not $pageTokens.Add($token)) { throw 'Lightsail returned a repeated page token. Retrying this source on the next poll.' }
    } while ($token)

    $batch = [System.Collections.Generic.List[object]]::new()
    $bytes = 0
    $uploaded = 0
    foreach ($event in @($pending.Values | Sort-Object Timestamp, Key)) {
        $eventBytes = [Text.Encoding]::UTF8.GetByteCount($event.Message) + 26
        if ($batch.Count -and ($bytes + $eventBytes -gt 1000000 -or $batch.Count -ge 10000)) {
            $uploaded += Send-LogBatch -Events $batch.ToArray() -Container $Container -Sent $Sent
            $batch.Clear(); $bytes = 0
        }
        $batch.Add($event); $bytes += $eventBytes
    }
    $uploaded += Send-LogBatch -Events $batch.ToArray() -Container $Container -Sent $Sent
    return $uploaded
}

function Start-ModelLogForwarder {
    foreach ($container in $Containers) {
        if ($container -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$') { throw 'Invalid container name.' }
    }
    if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw 'Install AWS CLI v2 and sign in to the intended AWS account first.' }
    if ($Initialize) { Initialize-LogDestination }
    $sent = [System.Collections.Generic.HashSet[string]]::new()
    # Keep this cutoff fixed so delayed Lightsail entries are revisited on every poll.
    $startTime = [DateTimeOffset]::UtcNow.AddMinutes(-$LookbackMinutes).ToUnixTimeSeconds()
    Write-Host "Forwarding $Service [$($Containers -join ', ')] to $LogGroup in $Region. Keep this window open; Ctrl+C stops."
    do {
        foreach ($container in $Containers) {
            try {
                $count = Forward-ContainerLogs -Container $container -StartTime $startTime -Sent $sent
                if ($count) { Write-Host "$([DateTimeOffset]::Now.ToString('HH:mm:ss')) $container : forwarded $count real telemetry events" }
            }
            catch {
                if ($Once -or $_.Exception.Message -match '\[AWS:(ProfileNotFound|CredentialsUnavailable|AccessDeniedException|AccessDenied|ResourceNotFoundException|InvalidInputException|UnrecognizedClientException)\]') { throw }
                Write-Warning "$container : $($_.Exception.Message) Will retry next poll."
            }
        }
        if (-not $Once) { Start-Sleep -Seconds $PollSeconds }
    } while (-not $Once)
}

# Dot-source to test the functions without starting a collector or contacting AWS.
if ($MyInvocation.InvocationName -ne '.') { Start-ModelLogForwarder }
