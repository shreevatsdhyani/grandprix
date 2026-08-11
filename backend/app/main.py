"""The Silent Co-Driver — API entrypoint.

Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.routers import analyse, clips, health, session

app = FastAPI(
    title="The Silent Co-Driver",
    description=(
        "Reads driver stress from team-radio audio and turns it into pit-wall "
        "strategy calls. AI Race Month · GrandPrix, problem statement 1."
    ),
    version=config.VERSION,
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


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"service": "silent-co-driver", "version": config.VERSION, "docs": "/docs"}
