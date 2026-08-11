"""Health and readiness.

`offline_ready` is the field that matters. The GrandPrix round is offline and we
assume venue wifi fails, so demo morning starts by hitting this endpoint and
confirming it is True.
"""

from __future__ import annotations

from fastapi import APIRouter

from app import config
from app.schemas import HealthResponse

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
    models = {
        config.STT_MODEL: _model_cached(config.STT_MODEL),
        config.SER_MODEL: _model_cached(config.SER_MODEL),
        config.TEXT_EMOTION_MODEL: _model_cached(config.TEXT_EMOTION_MODEL),
    }
    sessions_cached = any(config.FASTF1_CACHE_DIR.iterdir())

    return HealthResponse(
        status="ok" if config.USE_FIXTURES or all(models.values()) else "degraded",
        version=config.VERSION,
        models_loaded=models,
        offline_ready=all(models.values()) and sessions_cached,
    )
