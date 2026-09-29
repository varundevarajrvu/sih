# =============================================================================
#  Dhristi -- one-command demo launcher
#
#  Starts every server the demo needs (api, demo pages, cross-origin pages,
#  the local NER service), waits until each actually answers, and prints the
#  exact URLs and task goals for every scenario.
#
#  Usage:
#      .\start-demo.ps1                    # mock backend, local planner, no key needed
#      .\start-demo.ps1 -Backend gemini    # v1 backend override
#      .\start-demo.ps1 -Planner claude    # v2 planner: cloud, explicit opt-in (needs ANTHROPIC_API_KEY)
#      .\start-demo.ps1 -DebugDump         # also dump transmitted images to disk
#
#  Stop everything with .\stop-demo.ps1 -- it kills ONLY the processes THIS
#  script started this run (tracked in demo-pids.json, see the bottom of this
#  file), never anything merely found listening on one of these ports. That
#  distinction is not cosmetic: an earlier version of this pair killed two of
#  the user's OWN long-running servers on :8000/:5500 because it blind-killed
#  whatever was listening there, regardless of who started it.
#
#  WHY THIS EXISTS: the demo needs uvicorn on 8000 (v1 AND v2 /analyze), a
#  page server on 5500, a SECOND page server on 5501 (a different port is a
#  different origin -- that's what makes the cross-origin iframe test real),
#  and (v2) the local NER service on 8757. Starting those by hand is five
#  commands in four windows with two different Python interpreters, and a
#  forgotten one fails in a way that looks like a code bug. This removes that
#  whole class of problem from a live demo.
# =============================================================================

param(
    [ValidateSet("mock", "observe", "gemini", "claude", "ollama")]
    [string]$Backend = "mock",

    # v2 planner backend (docs/v2/ARCHITECTURE.md's VLM_BACKEND_V2). Separate
    # from -Backend (v1's VLM_BACKEND) on purpose -- v1 and v2 are mounted on
    # the SAME uvicorn process but are independently backend-selectable, per
    # C5/invariant 4 ("no silent cloud fallback" -- switching planners is an
    # explicit, visible flag here, never automatic). "local" maps to Ollama
    # (server/vlm_client.py's get_vlm_client_v2() default) -- the product
    # default, sends nothing to the internet. "claude"/"gemini" are the
    # explicit cloud opt-in for a faster live demo (ARCHITECTURE.md's
    # 2026-09-25 decision log entry).
    [ValidateSet("local", "claude", "gemini")]
    [string]$Planner = "local",

    [switch]$DebugDump
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$venvPython = Join-Path $root "server\.venv\Scripts\python.exe"
# The NER service (C3) runs in a DIFFERENT venv than the api server --
# spikes\gliner\.venv already has torch+gliner+the cached GLiNER weights;
# server\.venv deliberately does not (ner/README.md's own note: "server/.venv
# has fastapi/uvicorn/pytest but NOT torch/gliner"). Running it from the
# wrong interpreter fails with an import error that looks unrelated.
$nerPython = Join-Path $root "spikes\gliner\.venv\Scripts\python.exe"
$pidFile = Join-Path $root "demo-pids.json"

# Every process THIS invocation actually starts -- NOT ports found already in
# use, which are explicitly left alone (see each block below). Written once,
# at the end, so a crash mid-startup never leaves a half-written file that
# stop-demo.ps1 could misread. See stop-demo.ps1's own header for how this is
# consumed.
$started = @()

function Test-Port {
    param([int]$Port)
    try {
        $c = New-Object Net.Sockets.TcpClient
        $c.Connect("127.0.0.1", $Port)
        $c.Close()
        return $true
    } catch { return $false }
}

function Wait-ForUrl {
    param([string]$Url, [int]$TimeoutSec = 30)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $null = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -ErrorAction Stop
            return $true
        } catch { Start-Sleep -Milliseconds 400 }
    }
    return $false
}

# ner/app.py's GET /health is ALWAYS 200 (ner/README.md: "always 200; never
# reports loaded:true before the model actually is") -- Wait-ForUrl above
# only proves the process answers, not that the model has finished loading
# (cold load ~20s per docs/v2/ARCHITECTURE.md's V1b measurement). This polls
# the JSON body's own `loaded` field instead.
function Wait-ForNerLoaded {
    param([string]$Url, [int]$TimeoutSec = 40)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -ErrorAction Stop
            $body = $resp.Content | ConvertFrom-Json
            if ($body.loaded -eq $true) { return $true }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

# Finds the PID actually LISTENING on $Port right now, if any -- the SAME
# mechanism stop-demo.ps1 uses to find what to kill, called here (right after
# starting a process) so the tracked PID is the real child process (e.g.
# python.exe running uvicorn), not the wrapper `powershell -NoExit` shell
# Start-Process itself returns a PID for. A few short retries: the child
# process needs a moment to actually bind the port after Start-Process returns.
function Wait-ForListenerPid {
    param([int]$Port, [int]$TimeoutSec = 15)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($conns) { return ($conns.OwningProcess | Select-Object -First 1) }
        Start-Sleep -Milliseconds 300
    }
    return $null
}

Write-Host ""
Write-Host "  Dhristi -- starting demo environment" -ForegroundColor Cyan
Write-Host "  ------------------------------------" -ForegroundColor DarkGray

# --- Preflight: the venvs must exist, or uvicorn/the NER service fail with a
#     confusing error deep in a spawned window nobody's watching ------------
if (-not (Test-Path $venvPython)) {
    Write-Host "  ERROR: no venv at server\.venv" -ForegroundColor Red
    Write-Host "  Run:  cd server; python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
    exit 1
}
if (-not (Test-Path $nerPython)) {
    Write-Host "  ERROR: no venv at spikes\gliner\.venv (needed for the C3 NER service)" -ForegroundColor Red
    Write-Host "  See ner\README.md for setup -- this venv also has the cached GLiNER weights."
    exit 1
}

# --- Warn on a real backend/planner with no key, rather than failing mid-demo
if ($Backend -eq "gemini" -and -not ($env:GEMINI_API_KEY -or $env:GOOGLE_API_KEY)) {
    Write-Host "  WARNING: -Backend gemini but no GEMINI_API_KEY/GOOGLE_API_KEY set." -ForegroundColor Yellow
    Write-Host "           The server will start fine, but /analyze will 502 on the first request." -ForegroundColor Yellow
}
if ($Backend -eq "claude" -and -not $env:ANTHROPIC_API_KEY) {
    Write-Host "  WARNING: -Backend claude but no ANTHROPIC_API_KEY set." -ForegroundColor Yellow
}
if ($Planner -eq "gemini" -and -not ($env:GEMINI_API_KEY -or $env:GOOGLE_API_KEY)) {
    Write-Host "  WARNING: -Planner gemini but no GEMINI_API_KEY/GOOGLE_API_KEY set." -ForegroundColor Yellow
    Write-Host "           The server will start fine, but /v2/analyze will 502 on the first request." -ForegroundColor Yellow
}
if ($Planner -eq "claude" -and -not $env:ANTHROPIC_API_KEY) {
    Write-Host "  WARNING: -Planner claude but no ANTHROPIC_API_KEY set." -ForegroundColor Yellow
}

# VLM_BACKEND_V2 mapping (see the -Planner param's own comment). Checked
# BEFORE starting anything, not after, per invariant 4 -- a misconfigured
# local planner should be visible before the demo starts, not discovered
# mid-run as a silent 502.
$vlmBackendV2 = switch ($Planner) {
    "local"  { "ollama" }
    "claude" { "claude" }
    "gemini" { "gemini" }
}

if ($Planner -eq "local") {
    Write-Host "  checking local planner (Ollama, llama3.1:8b)..." -ForegroundColor DarkGray
    $ollamaOk = $false
    try {
        $tags = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 -ErrorAction Stop
        $models = ($tags.Content | ConvertFrom-Json).models
        $ollamaOk = $true
        $hasModel = $false
        foreach ($m in $models) { if ($m.name -like "llama3.1:8b*") { $hasModel = $true } }
        if (-not $hasModel) {
            Write-Host "  WARNING: Ollama is running but llama3.1:8b is not installed." -ForegroundColor Yellow
            Write-Host "           Run:  ollama pull llama3.1:8b" -ForegroundColor Yellow
            Write-Host "           The server will start fine, but /v2/analyze will fail on the first request" -ForegroundColor Yellow
            Write-Host "           (invariant 4: a local backend being down is an error, never a silent cloud fallback)." -ForegroundColor Yellow
        } else {
            Write-Host "   OK   Ollama answering, llama3.1:8b installed" -ForegroundColor Green
        }
    } catch {
        Write-Host "  WARNING: -Planner local (default) but Ollama is not reachable on 127.0.0.1:11434." -ForegroundColor Yellow
        Write-Host "           Start Ollama, or run  ollama serve  -- otherwise /v2/analyze will fail on" -ForegroundColor Yellow
        Write-Host "           every request. This is deliberate: never a silent fallback to a cloud" -ForegroundColor Yellow
        Write-Host "           planner (invariant 4)." -ForegroundColor Yellow
    }
}

# --- 1. API server (v1 AND v2 -- one process, both /analyze and /v2/analyze)
if (Test-Port 8000) {
    Write-Host "  [8000] already in use -- leaving it alone (not tracked; stop-demo.ps1 will not touch it)" -ForegroundColor DarkYellow
} else {
    $envPrefix = "`$env:VLM_BACKEND='$Backend'; `$env:VLM_BACKEND_V2='$vlmBackendV2'; "
    if ($DebugDump) {
        # NOTE: dumps can contain UNREDACTED PII if redaction is broken -- that
        # is precisely when you would enable this. See server/README.md.
        $envPrefix += "`$env:DEBUG_DUMP_DIR='debug_dumps'; "
    }
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "cd '$root\server'; $envPrefix & '$venvPython' -m uvicorn main:app --host 127.0.0.1 --port 8000"
    ) -WindowStyle Normal
    $apiPid = Wait-ForListenerPid -Port 8000
    if ($apiPid) { $started += [pscustomobject]@{ port = 8000; label = "api server"; pid = $apiPid } }
    Write-Host "  [8000] api server starting (v1 backend=$Backend, v2 planner=$Planner/$vlmBackendV2)..." -ForegroundColor Gray
}

# --- 2. Demo page server ----------------------------------------------------
if (Test-Port 5500) {
    Write-Host "  [5500] already in use -- leaving it alone (not tracked; stop-demo.ps1 will not touch it)" -ForegroundColor DarkYellow
} else {
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command", "cd '$root\demo'; python -m http.server 5500"
    ) -WindowStyle Minimized
    $p5500 = Wait-ForListenerPid -Port 5500
    if ($p5500) { $started += [pscustomobject]@{ port = 5500; label = "demo pages"; pid = $p5500 } }
    Write-Host "  [5500] demo pages starting..." -ForegroundColor Gray
}

# --- 3. Cross-origin server -------------------------------------------------
#  A different PORT is a different ORIGIN. That is the entire reason this
#  third server exists: it makes the cross-origin iframe path genuinely
#  cross-origin, rather than same-origin wearing a different path.
if (Test-Port 5501) {
    Write-Host "  [5501] already in use -- leaving it alone (not tracked; stop-demo.ps1 will not touch it)" -ForegroundColor DarkYellow
} else {
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command", "cd '$root\demo\cross-origin'; python -m http.server 5501"
    ) -WindowStyle Minimized
    $p5501 = Wait-ForListenerPid -Port 5501
    if ($p5501) { $started += [pscustomobject]@{ port = 5501; label = "cross-origin pages"; pid = $p5501 } }
    Write-Host "  [5501] cross-origin pages starting..." -ForegroundColor Gray
}

# --- 4. NER service (C3, v2 only -- must be up before any v2 run) ----------
if (Test-Port 8757) {
    Write-Host "  [8757] already in use -- leaving it alone (not tracked; stop-demo.ps1 will not touch it)" -ForegroundColor DarkYellow
} else {
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command", "cd '$root'; & '$nerPython' -m uvicorn ner.app:app --host 127.0.0.1 --port 8757"
    ) -WindowStyle Minimized
    $nerPid = Wait-ForListenerPid -Port 8757
    if ($nerPid) { $started += [pscustomobject]@{ port = 8757; label = "ner service"; pid = $nerPid } }
    Write-Host "  [8757] ner service starting (cold load ~20s -- waiting for it below)..." -ForegroundColor Gray
}

# --- Wait until everything actually answers ---------------------------------
Write-Host ""
Write-Host "  waiting for health..." -ForegroundColor DarkGray
$ok8000 = Wait-ForUrl "http://127.0.0.1:8000/health"
$ok5500 = Wait-ForUrl "http://localhost:5500/test-page.html"
$ok5501 = Wait-ForUrl "http://localhost:5501/frames-iframe-xo.html"
$ok8757 = Wait-ForNerLoaded "http://127.0.0.1:8757/health" 40

function Status($ok, $label) {
    if ($ok) { Write-Host "   OK   $label" -ForegroundColor Green }
    else     { Write-Host "   DOWN $label" -ForegroundColor Red }
}
Write-Host ""
Status $ok8000 "api server       http://127.0.0.1:8000"
Status $ok5500 "demo pages       http://localhost:5500"
Status $ok5501 "cross-origin     http://localhost:5501"
Status $ok8757 "ner service      http://127.0.0.1:8757 (loaded:true)"

# --- Persist the PID tracking file, even on a partial failure below --------
# so stop-demo.ps1 can still clean up whatever DID start. Overwrites any
# stale file from a previous run -- a fresh start-demo.ps1 invocation is a
# fresh tracking scope.
$started | ConvertTo-Json -AsArray | Set-Content -Path $pidFile -Encoding utf8
if ($started.Count -gt 0) {
    Write-Host ""
    Write-Host "  tracked $($started.Count) process(es) in demo-pids.json -- stop-demo.ps1 will stop exactly these." -ForegroundColor DarkGray
}

if (-not ($ok8000 -and $ok5500 -and $ok5501 -and $ok8757)) {
    Write-Host ""
    Write-Host "  Something did not come up. Check the server windows for errors." -ForegroundColor Red
    if (-not $ok8757) {
        Write-Host "  NER service pre-flight: NOT green. Do not run a v2 scenario until this reads OK --" -ForegroundColor Red
        Write-Host "  agent-loop-v2.js stops the run outright rather than silently degrading (C3)." -ForegroundColor Red
    }
    exit 1
}

# --- The cheat sheet --------------------------------------------------------
Write-Host ""
Write-Host "  ============================ DEMO SCENARIOS (v1) ============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Reload the extension at chrome://extensions, then WAIT for the popup's" -ForegroundColor Gray
Write-Host "  green check before running -- the first inference is slow, once." -ForegroundColor Gray
Write-Host ""
Write-Host "  1. THE AGENT IS USEFUL" -ForegroundColor White
Write-Host "     http://localhost:5500/test-page.html"
Write-Host "     goal:  fill the name as Simon"
Write-Host "     -> types Simon, visibly" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  2. THE AGENT IS SAFE (PII)" -ForegroundColor White
Write-Host "     http://localhost:5500/test-page.html"
Write-Host "     goal:  Fill in the password field with the value hunter2"
Write-Host "     -> SENSITIVE_TARGET_BLOCKED. Real password is hunter2Demo! --" -ForegroundColor DarkGray
Write-Host "        it guessed from your instruction because it never saw the page value." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  3. THE POLICY DISCRIMINATES" -ForegroundColor White
Write-Host "     http://localhost:5500/test-page.html"
Write-Host "     goal:  Fill the name as River Jane and email id as riverjane33@demo.com"
Write-Host "     -> fills the name, refuses the email" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  4. IRREVERSIBLE ACTIONS, NOT JUST PII" -ForegroundColor White
Write-Host "     http://localhost:5500/test-page.html?scenario=checkout"
Write-Host "     goal:  Complete the checkout by clicking Place Order"
Write-Host "     -> IRREVERSIBLE_ACTION_BLOCKED. Nothing about that button is a secret." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  5. COVERAGE (iframes + shadow DOM, v1 AND v2 -- see DEMO-SCRIPT.md's v2 section)" -ForegroundColor White
Write-Host "     http://localhost:5500/frames-test.html?xorigin=1"
Write-Host "     goal:  fill the traveler name"
Write-Host "     -> framesReported 2, framesMerged 2, subframeSensitiveNodes 3" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  See DEMO-SCRIPT.md's 'V2' section for scenarios 6/7 (tokenized shipping-" -ForegroundColor Gray
Write-Host "  address fill, and the real consent panel) and how to select pipeline v2" -ForegroundColor Gray
Write-Host "  in the popup's Settings panel." -ForegroundColor Gray
Write-Host ""
Write-Host "  =======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Stop everything:  .\stop-demo.ps1" -ForegroundColor Gray
if ($Backend -eq "observe") {
    Write-Host ""
    Write-Host "  OBSERVE-ONLY BACKEND -- /analyze always replies 'done' on the page" -ForegroundColor Cyan
    Write-Host "  sentinel, so the loop runs ONE full capture/scan/redact/send cycle" -ForegroundColor Cyan
    Write-Host "  and then stops WITHOUT clicking or typing anything. This is the" -ForegroundColor Cyan
    Write-Host "  only safe way to point the extension at a real website." -ForegroundColor Cyan
    Write-Host "  The demo scenarios above will NOT act under this backend." -ForegroundColor DarkGray
}
if ($DebugDump) {
    Write-Host ""
    Write-Host "  DEBUG DUMP IS ON -- server\debug_dumps\ will fill with transmitted" -ForegroundColor Yellow
    Write-Host "  images. They can contain UNREDACTED PII if redaction is broken." -ForegroundColor Yellow
    Write-Host "  Delete the folder when done, and never leave this on for a demo." -ForegroundColor Yellow
}
Write-Host ""
