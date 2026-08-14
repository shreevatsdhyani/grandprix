"""The Silent Co-Driver — API entrypoint.

Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load environment variables from .env file
load_dotenv()

from app import config
from app.routers import analyse, clips, health, session

log = logging.getLogger(__name__)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the models before anyone asks for them.

    `pipeline.models.warm` documented that it was "called at startup to pay the
    cost before anyone is watching" — and nothing called it. The bill therefore
    landed on the first upload of the demo: ~20 s of model loading on top of
    inference, behind a button that just says "Analysing…". Warming here moves
    that cost to `uvicorn` boot.

    Off-thread and best-effort: a model that fails to load must not stop the API
    from starting, because /api/health is exactly how we'd diagnose it.
    """
    from app.pipeline import models

    async def _warm() -> None:
        try:
            loaded = await asyncio.to_thread(models.warm)
            log.info("Models warmed: %s", loaded)
        except Exception:
            log.exception("Model warm-up failed; endpoints will load lazily")

    task = asyncio.create_task(_warm())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(
    title="The Silent Co-Driver",
    description=(
        "Reads driver stress from team-radio audio and turns it into pit-wall "
        "strategy calls. AI Race Month · GrandPrix, problem statement 1."
    ),
    version=config.VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(session.router)
app.include_router(analyse.router)
app.include_router(clips.router)

# Agent layer (feature-flagged)
if os.getenv("GP_AGENT", "0") == "1":
    from app.routers import agent
    app.include_router(agent.router)
    log.info("Agent layer enabled (GP_AGENT=1)")


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"service": "silent-co-driver", "version": config.VERSION, "docs": "/docs"}
