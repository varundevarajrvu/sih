# =============================================================================
#  Dhristi -- stop the demo environment
#
#  Stops ONLY the processes THIS pair of scripts started this run, by PID,
#  read from demo-pids.json (written by start-demo.ps1). Never kills a
#  process merely because it happens to be listening on 8000/5500/5501/8757 --
#  an earlier version of this script did exactly that and killed two of the
#  user's OWN long-running v1 demo servers, which start-demo.ps1 had itself
#  correctly reported as "already in use -- leaving it alone" moments before.
#  If a port has no tracked PID (nothing here started it, or it was started
#  before PID tracking existed), this script now says so and leaves it
#  strictly alone -- it does NOT fall back to guessing from the port.
#
#  Usage:  .\stop-demo.ps1
# =============================================================================

$ErrorActionPreference = "SilentlyContinue"

$pidFile = Join-Path $PSScriptRoot "demo-pids.json"

Write-Host ""
Write-Host "  Dhristi -- stopping demo environment" -ForegroundColor Cyan
Write-Host "  ------------------------------------" -ForegroundColor DarkGray

if (-not (Test-Path $pidFile)) {
    Write-Host "  No demo-pids.json found -- nothing tracked to stop." -ForegroundColor DarkGray
    Write-Host "  (Either start-demo.ps1 was never run, or every port it saw was already" -ForegroundColor DarkGray
    Write-Host "  in use and left alone. This script will not guess and kill by port.)" -ForegroundColor DarkGray
    Write-Host ""
    exit 0
}

$tracked = @()
try {
    $raw = Get-Content -Path $pidFile -Raw -ErrorAction Stop
    if ($raw -and $raw.Trim().Length -gt 0) {
        $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
        # ConvertFrom-Json on a single-element JSON array can return a bare
        # object rather than an array in some PowerShell versions -- force
        # array shape so the loop below is uniform regardless.
        $tracked = @($parsed)
    }
} catch {
    Write-Host "  WARNING: demo-pids.json exists but could not be parsed -- leaving everything" -ForegroundColor Yellow
    Write-Host "  alone rather than guessing. ($($_.Exception.Message))" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

if ($tracked.Count -eq 0) {
    Write-Host "  demo-pids.json is empty -- nothing was tracked to stop." -ForegroundColor DarkGray
    Write-Host ""
    exit 0
}

# Closes the `powershell -NoExit` window start-demo.ps1 opened for this entry
# (recorded as windowPid). Only closes it if it is still a powershell process
# whose command line names this entry's port -- never an arbitrary process
# that happens to have reused the PID.
function Close-DemoWindow($entry) {
    if (-not $entry.windowPid) { return }
    $w = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f [int]$entry.windowPid) -ErrorAction SilentlyContinue
    if (-not $w) { return }
    if ($w.Name -ne "powershell.exe" -or $w.CommandLine -notmatch [regex]::Escape([string]$entry.port)) {
        Write-Host ("   ??   {0,-5} window pid {1} is not the demo window any more -- left alone" -f $entry.port, $entry.windowPid) -ForegroundColor Yellow
        return
    }
    Stop-Process -Id $entry.windowPid -Force -ErrorAction SilentlyContinue
    Write-Host ("   OK   {0,-5} closed its demo window (pid {1})" -f $entry.port, $entry.windowPid) -ForegroundColor Green
}

foreach ($entry in $tracked) {
    $port = $entry.port
    $label = $entry.label
    # NOTE: deliberately NOT named $pid -- that is a read-only automatic
    # variable in PowerShell (the current process id), and assigning to it
    # throws at runtime. A parse check does not catch that.
    $trackedPid = $entry.pid

    $proc = Get-Process -Id $trackedPid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host ("   --   {0,-5} {1} (tracked pid {2} is no longer running -- nothing to stop)" -f $port, $label, $trackedPid) -ForegroundColor DarkGray
        Close-DemoWindow $entry
        continue
    }

    # Extra check, belt-and-braces: confirm this PID is STILL the process
    # actually listening on the port we recorded it against. A PID can in
    # principle be reused by an unrelated process after the original one
    # exits; this does not change WHICH pid gets killed (we only ever kill
    # the tracked one), it only changes whether we warn that the situation
    # looks different from what we started.
    $currentListenerPid = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    if ($currentListenerPid -and $currentListenerPid -ne $trackedPid) {
        Write-Host ("   ??   {0,-5} {1} (tracked pid {2} is running but port {0} is now owned by pid {3} -- stopping only the TRACKED pid, as recorded)" -f $port, $label, $trackedPid, $currentListenerPid) -ForegroundColor Yellow
    }

    try {
        Stop-Process -Id $trackedPid -Force -ErrorAction Stop
        Write-Host ("   OK   {0,-5} {1} (stopped {2}, pid {3})" -f $port, $label, $proc.ProcessName, $trackedPid) -ForegroundColor Green
    } catch {
        Write-Host ("   FAIL {0,-5} {1} (pid {2}) -- {3}" -f $port, $label, $trackedPid, $_.Exception.Message) -ForegroundColor Red
    }
    Close-DemoWindow $entry
}

# Tracking is single-use -- a stale file from a run that's already been
# stopped must never be replayed against whatever now happens to be running
# on these ports (e.g. after the user manually restarted one server by hand).
Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue

# --- Reminder, not an action: deleting dumps is the user's call -------------
$dumpDir = Join-Path $PSScriptRoot "server\debug_dumps"
if (Test-Path $dumpDir) {
    $count = (Get-ChildItem $dumpDir -File -ErrorAction SilentlyContinue | Measure-Object).Count
    if ($count -gt 0) {
        Write-Host ""
        Write-Host "  NOTE: server\debug_dumps\ still holds $count file(s)." -ForegroundColor Yellow
        Write-Host "  Those are transmitted page images and can contain real PII." -ForegroundColor Yellow
        Write-Host "  Delete when done:  Remove-Item -Recurse -Force '$dumpDir'" -ForegroundColor Yellow
    }
}

Write-Host ""
