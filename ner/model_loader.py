"""ner/model_loader.py -- background-thread GLiNER load.

Pattern ported from warden/entities.py's ModelState/load_model: load once in
a daemon thread so GET /health can answer immediately with loaded:false
while the cold load runs in the background instead of blocking the socket.
Measured cold load (spikes/gliner/bench_python_result.json,
uncontended-at-the-time): 110.05s for this exact model on this machine --
far too long to do on the request path or before the ASGI server starts
accepting connections.

IMPORTANT: torch and gliner are imported INSIDE functions here, never at
module top. That keeps `ner/model_loader.py` -- and everything that imports
it, including ner/app.py and ner/ner_engine.py -- importable in a Python
environment that has fastapi but not torch (this repo's server/.venv is
exactly that environment; the phase brief says to try it first). Only
actually calling load_model() requires torch/gliner to be installed.
"""

from __future__ import annotations

import threading
import time
from typing import Optional

from . import config


class ModelState:
    def __init__(self) -> None:
        self.model = None
        self.loading = False
        self.load_error: Optional[str] = None
        self.load_seconds: Optional[float] = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self.model is not None


# Process-wide singleton, mirroring warden/entities.py's module-level STATE.
STATE = ModelState()


def _configure_torch_threads() -> None:
    import torch

    torch.set_num_threads(config.TORCH_THREADS)
    try:
        torch.set_num_interop_threads(max(1, config.TORCH_THREADS // 2))
    except RuntimeError:
        # set_num_interop_threads may only be called once, before any
        # parallel work has started. If something in this process already
        # touched torch's interop pool (a prior load, a test importing
        # torch first), leave it at its current value rather than crash the
        # load over a thread-tuning knob.
        pass


def load_model(state: ModelState = STATE) -> None:
    """Load GLiNER once. Safe to call from a background thread. Sets
    state.model on success, state.load_error on failure -- never raises, so
    a broken install degrades to "never becomes ready" (POST /ner keeps
    503ing, GET /health keeps reporting loaded:false + the error) rather
    than crashing the process.
    """
    with state._lock:
        if state.model is not None or state.loading:
            return
        state.loading = True
    try:
        _configure_torch_threads()
        from gliner import GLiNER  # imported here: see module docstring

        t0 = time.perf_counter()
        model = GLiNER.from_pretrained(config.MODEL_ID)
        model.eval()
        elapsed = time.perf_counter() - t0
        state.model = model
        state.load_seconds = elapsed
    except Exception as exc:  # noqa: BLE001 -- report, never crash the process
        state.load_error = f"{type(exc).__name__}: {exc}"
    finally:
        state.loading = False


def start_background_load(state: ModelState = STATE) -> threading.Thread:
    t = threading.Thread(target=load_model, args=(state,), daemon=True, name="ner-model-load")
    t.start()
    return t
