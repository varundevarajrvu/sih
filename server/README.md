# server — Phase 2c (`server-api`)

FastAPI `/analyze` endpoint for Dhristi (SIH 26171). Fully independent of the browser
extension — build, test, and run it standalone. See the repo root
`CLAUDE.md` (Section 4, Phase 2c) for the full contract and rationale.

## Setup

```bash
cd server
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
# .venv/bin/python -m pip install -r requirements.txt          # macOS/Linux
```

## Run

```bash
.venv/Scripts/python.exe -m uvicorn main:app --reload
```

`GET /health` and `POST /analyze` are the only two routes.

## Tests

```bash
# from the repo root
server/.venv/Scripts/python.exe -m pytest tests/
```

All tests run against the mock backend (`MockVLMClient`) by default — no
network, no model, no credentials required for any test in this repo.

## VLM backend — `VLM_BACKEND`

The server talks to a vision-language model through one swappable
interface (`vlm_client.VLMClient`), selected entirely by the `VLM_BACKEND`
environment variable. No code change is needed to switch backends.

| `VLM_BACKEND` value | Client | Notes |
|---|---|---|
| *(unset)* / `mock` | `MockVLMClient` | **Default.** Deterministic, no network, no model. What every test in this repo runs against. |
| `ollama` | `OllamaVLMClient` | Local `qwen2.5vl:7b` via Ollama's HTTP API (`OLLAMA_BASE_URL`, default `http://localhost:11434`). Written but never executed in this build — no vision model is pulled on the dev machine (only text-only models are installed, and RAM is too tight for a 7B VLM anyway). |
| `claude` | `ClaudeVLMClient` | Cloud Claude model via the official `anthropic` SDK. Chosen first because it returns real structured/grounding-oriented output. Pay-as-you-go — no free tier. See below. |
| `gemini` | `GeminiVLMClient` | Cloud Gemini model via the official `google-genai` SDK. Chosen second, additively, specifically because Google offers a **free tier** and a hackathon demo shouldn't need a paid key to run. See below. |

```bash
# examples
VLM_BACKEND=claude ANTHROPIC_API_KEY=sk-ant-...        .venv/Scripts/python.exe -m uvicorn main:app
VLM_BACKEND=gemini GEMINI_API_KEY=AIzaSy...             .venv/Scripts/python.exe -m uvicorn main:app
```

Selecting a backend (constructing the client) never touches the network
or resolves credentials by itself — that only happens on the first real
`/analyze` call. So the server boots fine with `VLM_BACKEND=claude` or
`VLM_BACKEND=gemini` set and no key configured; the failure (a clean
`502` with `errorCode: "VLM_BACKEND_CALL_FAILED"`) only happens when a
request actually arrives.

## Claude backend — credentials and model

**This backend sends the already-redacted screenshot and the sanitized
DOM-derived prompt to Anthropic's API over the network.** That is the
explicit, intended design — see "Privacy" below — but it means real
image and text data leaves this machine when `VLM_BACKEND=claude` is
active and a request is actually served, which is not true for `mock` or
a local `ollama` backend.

- **API key**: set the `ANTHROPIC_API_KEY` environment variable. The
  server never reads or hardcodes this itself — a bare `anthropic.Anthropic()`
  client is constructed and the official SDK resolves credentials on its
  own. If it's missing when a request arrives, `/analyze` returns a
  `502` naming `ClaudeCredentialsMissing` rather than a raw SDK stack
  trace or a hang.
- **Model**: defaults to `claude-opus-4-8`. Override with the
  `ANTHROPIC_MODEL` environment variable if you need a different model id
  — use the exact id string, no date suffix.
- **Structured output**: every request is sent with `output_config`
  carrying a JSON schema that mirrors `schemas.ActionResponse` exactly
  (`action` constrained to `click`/`type`/`scroll`/`done`), so the model
  is constrained at generation time to return `{action, targetId, value}`
  and nothing else — this is what keeps the agent loop from breaking on
  prose.
- **Thinking / prefill**: neither is used. The `thinking` parameter is
  omitted entirely (not disabled — simply never sent), and no assistant
  message is ever prepended to seed the response; both are unsupported on
  this model family and would return a `400`.
- Not yet run against a live API in this repo — no key is configured on
  the dev machine. Fully unit-tested against a stubbed/injected fake
  client instead (`tests/unit/test_claude_vlm_client.py`): request shape,
  response parsing, and every error branch (model-not-found, rate limit,
  other API errors, connection errors, missing credentials) are all
  covered without network access.

## Gemini backend — credentials, model, and data usage

**This backend sends the already-redacted screenshot and the sanitized
DOM-derived prompt to Google's Gemini API over the network** — same
scope of data as the Claude backend, same reasoning (see "Privacy"
below), just a different destination.

- **API key**: get a free key at **https://aistudio.google.com/apikey**.
  Set the `GEMINI_API_KEY` environment variable. `GOOGLE_API_KEY` is also
  accepted by the underlying SDK (and takes priority if both are set) —
  verified directly in the installed `google-genai` source, not assumed.
  The server never reads or hardcodes either variable itself; a bare
  `genai.Client()` is constructed and the SDK resolves credentials on its
  own. If no key resolves, `/analyze` returns a clean `502` naming
  `GeminiCredentialsMissing` rather than a raw SDK stack trace.
- **Model**: defaults to `GEMINI_MODEL`'s value if set, otherwise
  `gemini-2.0-flash`. **This default is NOT verified against a live API
  call** — no credentials are available on this dev machine, and guessing
  a current model id from memory was explicitly out of bounds (Gemini's
  model lineup is exactly the kind of detail that goes stale). The value
  was instead read out of the installed SDK's own bundled source code,
  where it is used consistently as the canonical example across half a
  dozen files. If it turns out to be wrong or is retired, the model-not-
  found error tells you exactly how to list real, currently-valid ids:
  ```bash
  python -c "from google import genai; [print(m.name) for m in genai.Client().models.list()]"
  ```
  (requires `GEMINI_API_KEY`/`GOOGLE_API_KEY` to be set — this makes a
  real, lightweight API call). `vlm_client.list_gemini_models()` is the
  same helper, importable from Python.
- **Structured output**: every request sets `response_mime_type` to
  `application/json` and `response_json_schema` to the *same* JSON schema
  object used for the Claude backend (`ACTION_RESPONSE_JSON_SCHEMA`,
  itself derived from `schemas.ActionType` — one source of truth, not a
  second hand-copied enum), so the model is constrained at generation
  time to return `{action, targetId, value}` and nothing else.
- **Rate limits**: the Gemini free tier is aggressively rate-limited. A
  429 surfaces as `GeminiRateLimited`, its own distinguishable error type
  — worth watching for specifically during a live demo, since it's a
  routine failure mode on this backend, not a rare edge case.
- Not yet run against a live API in this repo — no key is configured on
  the dev machine. Fully unit-tested against a stubbed/injected fake
  client instead (`tests/unit/test_gemini_vlm_client.py`): request shape,
  response parsing, and every error branch (model-not-found, rate limit,
  other API errors, connection errors, missing credentials) are all
  covered without network access. (Missing-credentials is the one case
  tested against the *real* `google.genai.Client()` constructor rather
  than a fake — verified that constructing it with no resolvable key
  raises synchronously, client-side, before any network I/O.)

**Data usage — stated plainly, not softened:** Google's Gemini API free
tier may use data submitted through it to improve Google's products,
including model training, unless you're on a paid tier with different
terms. Check https://ai.google.dev/gemini-api/terms for the current
policy before relying on this for anything beyond a demo. **This is
acceptable for this project specifically because everything transmitted
through this backend is already redacted** — the password, the email,
the face, the ID card are never in the payload in the first place (see
"Privacy" below and the Section 5 egress tests in
`test_gemini_vlm_client.py`). A privacy project has to be explicit about
where its data goes, including when the answer is "a free tier that may
train on it" — the redaction guarantee is what makes that an acceptable
answer, not a reason to avoid stating it.

## Privacy (Section 5)

The one invariant that isn't negotiable: **nothing leaves this server's
outbound request except the already-redacted screenshot and the already-
sanitized DOM JSON the client sent it.** The server independently
re-checks this on every request (`find_pii_leaks()` in `schemas.py`) and
rejects a request with `400 PII_LEAK_DETECTED` if the client's own
redaction appears to have failed — defense in depth, not just trust in
the caller.

Swapping the VLM backend from local (mock/Ollama) to a cloud model
(Claude or Gemini) does not weaken this. Sending redacted data to a
cloud model — paid or free tier — under a verified no-raw-PII guarantee
is exactly the scenario this project exists to make safe, not an
exception to the rule.
