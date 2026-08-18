"""Groq access with model resolution.

Exists because Groq retires models without warning and a retired model returns a
404 rather than degrading. That has broken this app twice — see the comment on
`agent_config.GROQ_MODEL_CANDIDATES`.

The fix is to ask the platform what it actually serves, once per process, and pick
the first of our preferred models that is present. If the models endpoint is
unreachable we fall through to the first candidate and let the call fail with a
real error, rather than guessing.
"""

from __future__ import annotations

import logging
import os
import threading

from app import agent_config

log = logging.getLogger(__name__)

_lock = threading.Lock()
_resolved: str | None = None


class GroqUnavailable(RuntimeError):
    """Raised with a message safe to show a user."""


def client():
    """A configured Groq client, or a clear error explaining why not."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise GroqUnavailable("GROQ_API_KEY is not set.")
    try:
        from groq import Groq
    except ImportError as exc:  # pragma: no cover - environment problem
        raise GroqUnavailable("Groq SDK not installed — run: pip install groq") from exc
    return Groq(api_key=api_key)


def resolve_model(force: bool = False) -> str:
    """The first preferred model this account can actually use.

    Cached per process. One extra HTTP call at startup-ish cost, which buys us not
    silently serving 503s the next time a model is retired.
    """
    global _resolved
    with _lock:
        if _resolved is not None and not force:
            return _resolved

    fallback = agent_config.GROQ_MODEL_CANDIDATES[0]
    try:
        available = {m.id for m in client().models.list().data}
    except Exception as exc:
        # Not fatal: the caller's own request will surface the real problem with a
        # better message than we could invent here.
        log.warning("could not list Groq models (%s); assuming %s", exc, fallback)
        with _lock:
            _resolved = fallback
        return fallback

    chosen = next((m for m in agent_config.GROQ_MODEL_CANDIDATES if m in available), None)
    if chosen is None:
        chosen = fallback
        log.error(
            "none of %s are available on this Groq account (it serves %d models); "
            "trying %s anyway",
            agent_config.GROQ_MODEL_CANDIDATES,
            len(available),
            chosen,
        )
    elif chosen != fallback:
        log.warning("preferred model %s unavailable; using %s", fallback, chosen)
    else:
        log.info("using Groq model %s", chosen)

    with _lock:
        _resolved = chosen
    return chosen
