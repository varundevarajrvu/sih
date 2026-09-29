"""ner/config.py -- environment setup for the V1b ner-service (contract C3).

Imported FIRST, transitively, by every other module in this package
(model_loader, ner_engine, app, bench), before torch/gliner are ever
imported anywhere in the process -- so the HF_HOME / offline env vars below
are guaranteed to be set before those libraries read them at import time.
This module itself imports nothing beyond the stdlib, so importing `ner` at
all never requires torch or gliner to be installed (server/.venv has
neither) -- only actually loading the model (model_loader.load_model())
does.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SPIKE_DIR = REPO_ROOT / "spikes" / "gliner"

# Reuse the V0a spike's cache -- 1.1 GB of urchade/gliner_multi_pii-v1
# weights already on disk at spikes/gliner/.hf. Never re-download; do not
# repoint this without first copying the cache, per this phase's brief.
os.environ.setdefault("HF_HOME", str(SPIKE_DIR / ".hf"))

# C3: "no outbound network calls." Both env vars set belt-and-braces --
# HF_HUB_OFFLINE is what current `huggingface_hub`/`transformers` check;
# TRANSFORMERS_OFFLINE is the older name some code paths still read. Both
# must be set before `transformers`/`huggingface_hub` are imported anywhere
# in the process, which is why config.py (imported first) is where this
# lives rather than model_loader.py.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "0")

MODEL_ID = "urchade/gliner_multi_pii-v1"

# Loopback only -- hardcoded, not read from the environment, so there is no
# config path that can accidentally widen the bind address. See ner/app.py's
# __main__ block: uvicorn.run() is always called with this exact HOST.
HOST = "127.0.0.1"
PORT = int(os.environ.get("NER_PORT", "8757"))

# i5-1334U: 10 cores (2P+8E) / 12 logical threads. Half the logical thread
# count leaves headroom for whatever else is running on this dev machine
# (a Chromium benchmark, the extension's own WebGPU inference, another
# agent's process) while still giving torch enough intra-op parallelism to
# matter on a ~1.1 GB CPU-only model. Overridable for the bench script to
# try other values without editing code.
TORCH_THREADS = int(os.environ.get("NER_TORCH_THREADS", "6"))

CACHE_MAX_ENTRIES = int(os.environ.get("NER_CACHE_MAX_ENTRIES", "512"))

# C3 request-shape limits, enforced by ner/app.py's Pydantic model.
MAX_TEXTS_PER_REQUEST = 200
MAX_TEXT_CHARS = 4000

MODEL_BATCH_SIZE = int(os.environ.get("NER_BATCH_SIZE", "8"))
