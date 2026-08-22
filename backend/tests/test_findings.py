"""Tests for the findings layer.

The citation gate is the important one. A language model writing about a lap that
does not exist has lost track of the data, and everything else it said in that
response is suspect — so the finding is discarded rather than shown, and the count
of discards is reported rather than swallowed.

None of these tests call Groq. The prompt-building and validation are pure
functions over a Timeline, which is the whole reason they are separated from the
API call.
"""

from __future__ import annotations

from app.pipeline import findings
from app.schemas import (
    AcousticSignal,
    ClipAnalysis,
    ClipContext,
    Mood,
    MoodResult,
    ProsodySignal,
    ScoringMode,
    SessionContext,
    SessionMeta,
    SignalBreakdown,
    TextSignal,
    Timeline,
    TimelinePoint,
    TrackConditions,
    Transcript,
    TyreState,
)


def _mood(mood: Mood, stress: float, mode: ScoringMode) -> MoodResult:
    return MoodResult(
        mood=mood,
        confidence=0.8,
        stress_index=stress,
        probabilities={Mood.CALM: 0.2, Mood.STRESSED: 0.5, Mood.TIRED: 0.3},
        mode=mode,
        fitted=True,
    )


def _clip(clip_id: str, lap: int | None, text: str, stress: float = 80.0) -> ClipAnalysis:
    return ClipAnalysis(
        clip_id=clip_id,
        driver="HAM",
        session_id="2024-british-r",
        lap=lap,
        duration_s=4.0,
        audio_url=f"/api/clips/{clip_id}",
        transcript=Transcript(text=text, stt_model="test"),
        signals=SignalBreakdown(
            prosody=ProsodySignal(
                score=50, f0_mean_z=0, f0_std_z=0, rms_mean_z=0, speech_rate_z=0, pause_ratio_z=0
            ),
            acoustic=AcousticSignal(score=50, probabilities={}, top_label="neutral", model_id="t"),
            text=TextSignal(score=50, probabilities={}, top_label="neutral", model_id="t"),
        ),
        fusion=_mood(Mood.STRESSED, stress, ScoringMode.FUSION),
        naive=_mood(Mood.STRESSED, stress, ScoringMode.NAIVE),
    )


def _timeline(n_laps: int = 10) -> Timeline:
    """A small but complete timeline: 10 laps, one racing clip, one post-race clip."""
    points = [
        TimelinePoint(
            lap=lap,
            delta_s=0.1 * lap,
            stress_index=80.0 if lap == 5 else None,
            mood=Mood.STRESSED if lap == 5 else None,
            clip_id="clip-racing" if lap == 5 else None,
            track=TrackConditions(track_temp_c=30.0 - lap, rainfall=lap > 6),
            tyre=TyreState(compound="SOFT", tyre_age_laps=lap, stint_number=1),
        )
        for lap in range(1, n_laps + 1)
    ]
    clips = [
        _clip("clip-racing", 5, "No grip at all out here."),
        _clip("clip-post", n_laps, "Get in there! What a race!", stress=97.0),
    ]
    contexts = {
        "clip-racing": ClipContext(
            clip_id="clip-racing", utc="2024-07-07T15:00:00", lap=5, phase="racing"
        ),
        "clip-post": ClipContext(
            clip_id="clip-post", utc="2024-07-07T15:40:00", lap=None, phase="post_race"
        ),
    }
    return Timeline(
        session=SessionMeta(
            session_id="2024-british-r",
            year=2024,
            event_name="British Grand Prix",
            session_type="R",
            drivers=["HAM"],
        ),
        driver="HAM",
        mode=ScoringMode.FUSION,
        points=points,
        clips=clips,
        strategy_calls=[],
        session_context=SessionContext(
            session_id="2024-british-r", built_at="2024-07-07T18:00:00", source="test"
        ),
        clip_contexts=contexts,
    )


# --- the citation gate ----------------------------------------------------


def test_drops_findings_citing_laps_that_do_not_exist():
    tl = _timeline(n_laps=10)
    raw = [
        {
            "rank": 1,
            "severity": "warning",
            "headline": "Real finding",
            "detail": "About lap 5.",
            "laps": [5],
            "domains": ["stress"],
            "evidence": ["stress 80 on lap 5"],
            "confidence": 0.8,
        },
        {
            "rank": 2,
            "severity": "critical",
            "headline": "Invented finding",
            "detail": "About a lap that never happened.",
            "laps": [58],
            "domains": ["stress"],
            "evidence": ["stress 99 on lap 58"],
            "confidence": 0.9,
        },
    ]
    kept, dropped = findings.validate(raw, tl)

    assert dropped == 1
    assert [f.headline for f in kept] == ["Real finding"]


def test_drops_findings_with_no_lap_citation():
    """An uncheckable claim is also unclickable, so it has no place in the UI."""
    tl = _timeline()
    raw = [
        {
            "rank": 1,
            "severity": "info",
            "headline": "Vague",
            "detail": "The driver seemed fine overall.",
            "laps": [],
            "domains": ["stress"],
            "evidence": [],
            "confidence": 0.9,
        }
    ]
    kept, dropped = findings.validate(raw, tl)
    assert kept == []
    assert dropped == 1


def test_renumbers_ranks_contiguously_after_drops():
    """A list that jumps 1, 2, 4 invites the reader to wonder what is missing."""
    tl = _timeline()
    raw = [
        {"rank": 1, "severity": "info", "headline": "A", "detail": "d", "laps": [1], "domains": [], "evidence": [], "confidence": 0.5},
        {"rank": 2, "severity": "info", "headline": "B", "detail": "d", "laps": [99], "domains": [], "evidence": [], "confidence": 0.5},
        {"rank": 3, "severity": "info", "headline": "C", "detail": "d", "laps": [3], "domains": [], "evidence": [], "confidence": 0.5},
    ]
    kept, dropped = findings.validate(raw, tl)
    assert dropped == 1
    assert [f.rank for f in kept] == [1, 2]
    assert [f.headline for f in kept] == ["A", "C"]


def test_strips_domains_the_context_does_not_contain():
    """The model invents domain names; only ones backed by data survive."""
    tl = _timeline()
    raw = [
        {
            "rank": 1,
            "severity": "info",
            "headline": "A",
            "detail": "d",
            "laps": [5],
            "domains": ["stress", "tyre", "temperature", "biometrics"],
            "evidence": [],
            "confidence": 0.5,
        }
    ]
    kept, _ = findings.validate(raw, tl)
    assert set(kept[0].domains) == {"stress", "tyre"}


def test_clamps_confidence_into_range():
    tl = _timeline()
    raw = [
        {"rank": 1, "severity": "info", "headline": "A", "detail": "d", "laps": [1], "domains": [], "evidence": [], "confidence": 4.2},
        {"rank": 2, "severity": "info", "headline": "B", "detail": "d", "laps": [2], "domains": [], "evidence": [], "confidence": -1},
    ]
    kept, _ = findings.validate(raw, tl)
    assert [f.confidence for f in kept] == [1.0, 0.0]


def test_malformed_findings_are_dropped_not_raised():
    tl = _timeline()
    raw = [
        {"rank": 1, "severity": "nonsense-severity", "headline": "A", "detail": "d", "laps": [1], "domains": [], "evidence": [], "confidence": 0.5},
        {"laps": "not-a-list"},
    ]
    kept, dropped = findings.validate(raw, tl)
    assert kept == []
    assert dropped == 2


# --- the context block ----------------------------------------------------


def test_context_block_is_byte_deterministic():
    """The response cache is worthless if identical data renders differently."""
    tl = _timeline()
    a = findings.build_context_block(tl, ScoringMode.FUSION)
    b = findings.build_context_block(tl, ScoringMode.FUSION)
    assert a == b


def test_context_block_separates_post_race_radio():
    tl = _timeline()
    block = findings.build_context_block(tl, ScoringMode.FUSION)

    assert "POST-FLAG RADIO" in block
    assert "RADIO CALLS DURING RACING LAPS" in block
    # The victory shout must be labelled, not filed as race stress.
    assert "POST-RACE" in block


def test_context_block_warns_about_phase_conflicts():
    """`index.csv` files post-race radio against a lap; the block must say so.

    Without this the model reads a 97/100 stress reading on the final lap of a race
    the driver won and reports a driver falling apart.
    """
    tl = _timeline(n_laps=10)
    block = findings.build_context_block(tl, ScoringMode.FUSION)

    assert "DATA CAVEATS" in block
    assert "clip-post" in block
    assert "off-lap radio" in block


def test_context_block_states_tyre_figures_are_modelled():
    tl = _timeline()
    block = findings.build_context_block(tl, ScoringMode.FUSION)
    assert "MODELLED" in block
    assert "no tyre sensor data exists" in block


def test_context_block_says_biometrics_are_absent():
    """Silence would invite the model to speculate about heart rate."""
    tl = _timeline()
    block = findings.build_context_block(tl, ScoringMode.FUSION)
    assert "DRIVER BIOMETRICS: none uploaded" in block


def test_compact_block_is_smaller_but_keeps_the_laps_that_matter():
    tl = _timeline(n_laps=40)
    full = findings.build_context_block(tl, ScoringMode.FUSION)
    compact = findings.build_context_block(tl, ScoringMode.FUSION, compact=True)

    assert len(compact) < len(full)
    # Lap 5 has the radio call, so it survives compaction.
    lines = [l for l in compact.splitlines() if l.strip().startswith("5 |")]
    assert lines, "the lap with radio must survive compaction"


# --- the token budget -----------------------------------------------------


def test_output_budget_leaves_room_under_the_quota():
    """Groq charges prompt + max_tokens against the per-minute quota up front."""
    from app import agent_config

    prompt = "x" * 12000  # ~3750 estimated tokens
    budget = findings.output_budget(prompt)

    assert findings.estimate_tokens(prompt) + budget <= agent_config.GROQ_TPM_LIMIT
    assert budget >= agent_config.FINDINGS_MIN_TOKENS


def test_output_budget_never_returns_a_useless_budget():
    """Even an enormous prompt yields a floor, so the caller can retry smaller."""
    from app import agent_config

    assert findings.output_budget("x" * 400000) == agent_config.FINDINGS_MIN_TOKENS


def test_rate_limit_and_truncation_errors_are_told_apart():
    truncated = RuntimeError("Error code: 400 - tool_use_failed")
    limited = RuntimeError("Error code: 413 - rate_limit_exceeded ... Request too large")

    assert findings._looks_truncated(truncated)
    assert not findings._looks_rate_limited(truncated)
    assert findings._looks_rate_limited(limited)


# ---------------------------------------------------------------------------
# The on-disk store
#
# The point of the store is that a briefing is written once per (session, driver,
# mode) and read forever after, so these lock the two things that would quietly
# break that: a key that ignores one of its three parts, and a corrupt file that
# hard-fails instead of falling back to regeneration.
# ---------------------------------------------------------------------------


def test_store_round_trips_and_keys_on_all_three_parts(tmp_path, monkeypatch):
    from app import config
    from app.data import findings_store

    monkeypatch.setattr(config, "FINDINGS_DIR", tmp_path)

    payload = {"session_id": "2024-italian-r", "driver": "GAS", "findings": [{"rank": 1}]}
    findings_store.save("2024-italian-r", "GAS", "fusion", payload)

    assert findings_store.load("2024-italian-r", "GAS", "fusion") == payload
    # Driver code is case-insensitive; everything else must miss.
    assert findings_store.load("2024-italian-r", "gas", "fusion") == payload
    assert findings_store.load("2024-italian-r", "GAS", "naive") is None
    assert findings_store.load("2024-monaco-r", "GAS", "fusion") is None
    assert findings_store.load("2024-italian-r", "HAM", "fusion") is None


def test_store_treats_unusable_files_as_a_miss(tmp_path, monkeypatch):
    from app import config
    from app.data import findings_store

    monkeypatch.setattr(config, "FINDINGS_DIR", tmp_path)

    (tmp_path / "2024-italian-r-GAS-fusion.json").write_text("{not json", encoding="utf-8")
    assert findings_store.load("2024-italian-r", "GAS", "fusion") is None

    # Valid JSON, but not a findings payload — also a miss, not a KeyError later.
    (tmp_path / "2024-italian-r-HAM-fusion.json").write_text("[]", encoding="utf-8")
    assert findings_store.load("2024-italian-r", "HAM", "fusion") is None


def test_store_never_writes_outside_its_directory(tmp_path, monkeypatch):
    from app import config
    from app.data import findings_store

    monkeypatch.setattr(config, "FINDINGS_DIR", tmp_path)

    findings_store.save("../../etc/passwd", "../HAM", "fusion", {"findings": []})
    written = list(tmp_path.iterdir())
    assert len(written) == 1
    assert written[0].parent == tmp_path


# ---------------------------------------------------------------------------
# Quota classification
#
# A per-minute limit and a per-day limit look almost identical in Groq's error
# text and mean opposite things: one clears in seconds, the other not until the
# day resets. Reading a daily rejection as transient is what made a prewarm run
# burn its whole allowance retrying, so the distinction is worth a test.
# ---------------------------------------------------------------------------

_TPD = (
    "Error code: 429 - Rate limit reached for model `openai/gpt-oss-120b` on "
    "tokens per day (TPD): Limit 200000, Used 198999, Requested 3352. "
    "Please try again in 16m55.632s."
)
_TPM = (
    "Error code: 429 - Rate limit reached on tokens per minute (TPM): "
    "Limit 8000, Used 7920. Please try again in 6.253s."
)


def test_daily_and_minute_quotas_are_told_apart():
    assert findings._looks_rate_limited(Exception(_TPD))
    assert findings._looks_rate_limited(Exception(_TPM))
    assert findings._is_daily_quota(Exception(_TPD))
    assert not findings._is_daily_quota(Exception(_TPM))
    # A genuine fault is neither, and must not be mistaken for a quota.
    assert not findings._looks_rate_limited(Exception("connection reset"))


def test_retry_hint_reads_both_minute_and_second_forms():
    # "16m55.632s" is the shape that a seconds-only regex silently misreads as
    # 55 seconds — a seventeen-minute wait turned into an instant retry.
    assert findings.quota_retry_hint(Exception(_TPD)) == 1015.632
    assert findings.quota_retry_hint(Exception(_TPM)) == 6.253
    assert findings.quota_retry_hint(Exception("no hint here")) is None
