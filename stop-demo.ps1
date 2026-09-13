# =============================================================================
#  Dhristi -- stop the demo environment
#
#  Stops whatever is listening on 8000 / 5500 / 5501, by PID from the port
#  rather than by killing every python.exe on the machine (which would take
#  down unrelated work and is a genuinely bad thing for a script to do).
#
#  Usage:  .\stop-demo.ps1
# =============================================================================

$ErrorActionPreference = "SilentlyContinue"

$ports = @(
    @{ Port = 8000; Label = "api server" },
    @{ Port = 5500; Label = "demo pages" },
    @{ Port = 5501; Label = "cross-origin pages" }
)

Write-Host ""
Write-Host "  Dhristi -- stopping demo environment" -ForegroundColor Cyan
Write-Host "  ------------------------------------" -ForegroundColor DarkGray

foreach ($p in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $p.Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        Write-Host ("   --   {0,-5} {1} (not running)" -f $p.Port, $p.Label) -ForegroundColor DarkGray
        continue
    }
    # NOTE: deliberately NOT named $pid -- that is a read-only automatic
    # variable in PowerShell (the current process id), and assigning to it
    # throws at runtime. A parse check does not catch that.
    foreach ($procId in ($conns.OwningProcess | Select-Object -Unique)) {
        try {
            $proc = Get-Process -Id $procId -ErrorAction Stop
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Host ("   OK   {0,-5} {1} (stopped {2}, pid {3})" -f $p.Port, $p.Label, $proc.ProcessName, $procId) -ForegroundColor Green
        } catch {
            Write-Host ("   FAIL {0,-5} {1} (pid {2}) -- {3}" -f $p.Port, $p.Label, $procId, $_.Exception.Message) -ForegroundColor Red
        }
    }
}

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
