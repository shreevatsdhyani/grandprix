"""Health, readiness and model provenance.

`offline_ready` is the field that matters. The GrandPrix round is offline and we
assume venue wifi fails, so demo morning starts by hitting this endpoint and
confirming it is True.

`/api/model-card` sits here for the same reason: both endpoints answer "what is
this install actually running", off local disk, without loading a model.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from app import config
from app.schemas import HealthResponse, ModelCard

router = APIRouter(prefix="/api", tags=["health"])


def _model_cached(model_id: str) -> bool:
    """True when weights are already in the local HF cache.

    Checked by path rather than by loading, so this stays fast enough to poll.
    """
    from pathlib import Path

    hub = Path.home() / ".cache" / "huggingface" / "hub"
    return (hub / f"models--{model_id.replace('/', '--')}").exists()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    # All four models, VAD included. Leaving VAD out made `offline_ready` claim
    # more than it knew: a missing VAD file does not crash the pipeline, it
    # degrades it silently, so it is exactly the one that must be reported.
    models = {
        config.STT_MODEL: _model_cached(config.STT_MODEL),
        config.SER_MODEL: _model_cached(config.SER_MODEL),
        config.TEXT_EMOTION_MODEL: _model_cached(config.TEXT_EMOTION_MODEL),
        config.VAD_MODEL: _model_cached(config.VAD_MODEL),
    }
    sessions_cached = any(config.FASTF1_CACHE_DIR.iterdir())

    # `status` no longer passes just because fixtures are on — that made a
    # model-less install look healthy.
    return HealthResponse(
        status="ok" if all(models.values()) else "degraded",
        version=config.VERSION,
        models_loaded=models,
        offline_ready=all(models.values()) and sessions_cached,
    )


@router.get("/model-card", response_model=ModelCard)
def model_card() -> ModelCard:
    """The fusion head's own numbers, read off the weights the runtime scores with.

    Committed to the repo and a few KB, so this answers with no network and no
    model load — same offline assumption as everything else here.

    503 when the head is absent or predates these fields, matching how the rest
    of the app treats an unfitted head: `MoodResult.fitted` goes False and the UI
    admits it. The one thing this must never do is serve a number it cannot
    source, so a bad file is an error rather than a default.
    """
    # Same file, same constant the scorer uses — the headline and the model
    # cannot drift apart.
    from app.pipeline.fusion import MODEL_PATH

    if not MODEL_PATH.is_file():
        raise HTTPException(
            503, "No fitted fusion head. Run: python scripts/fit_fusion.py"
        )
    try:
        head = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
        return ModelCard(
            n_train=head["n_train"],
            cv_accuracy=head["cv_accuracy"],
            naive_accuracy=head["naive_accuracy"],
            features=head["features"],
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            503, f"Fusion head on disk carries no usable metrics: {exc}"
        ) from exc
