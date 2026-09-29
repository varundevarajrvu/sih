"""ner -- V1b `ner-service` (docs/v2/ARCHITECTURE.md contract C3).

A separate, loopback-only FastAPI app providing GLiNER-based free-text PII
detection (person names, addresses, DOB, account numbers -- plus email/phone
as a recall backstop to regex) for the Dhristi v2 privacy pipeline. Never
shares a process with `server/` (which may talk to a cloud VLM); this
package makes no outbound network calls at all.

See ner/README.md for how to run it, and docs/v2/ARCHITECTURE.md contract
C3 / the "V0a gliner-spike" phase result for why this exists as a separate
local process rather than in-browser ONNX.
"""
