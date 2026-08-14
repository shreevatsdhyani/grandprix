"""Tests for timeline building logic.

Covers timeline.py which assembles data from multiple sources.
"""

import pytest
from app.data import timeline
from app.schemas import ScoringMode


class TestTimelineBuilding:
    """Test timeline building with real data."""

    def test_build_timeline_basic(self):
        """Test building timeline for valid session/driver."""
        result = timeline.build("2024-british-r", "HAM", ScoringMode.FUSION)

        assert result is not None
        assert result.driver == "HAM"
        assert result.session.session_id == "2024-british-r"
        assert result.mode == ScoringMode.FUSION
        assert len(result.points) > 0, "Should have lap points"

    def test_timeline_lap_sequence(self):
        """Test that lap numbers are sequential."""
        result = timeline.build("2024-british-r", "HAM", ScoringMode.FUSION)

        laps = [p.lap for p in result.points]
        assert laps == sorted(laps), "Laps should be in order"
        assert laps[0] >= 1, "First lap should be 1 or higher"

    def test_timeline_mode_switching(self):
        """Test that naive vs fusion modes both work."""
        naive = timeline.build("2024-british-r", "HAM", ScoringMode.NAIVE)
        fusion = timeline.build("2024-british-r", "HAM", ScoringMode.FUSION)

        assert naive.mode == ScoringMode.NAIVE
        assert fusion.mode == ScoringMode.FUSION

        # Both should have same lap structure
        assert len(naive.points) == len(fusion.points)

    def test_timeline_invalid_session(self):
        """Test error handling for invalid session."""
        with pytest.raises(KeyError):
            timeline.build("9999-fake-r", "HAM", ScoringMode.FUSION)

    def test_timeline_clips_structure(self):
        """Test that clips are properly structured."""
        result = timeline.build("2024-british-r", "HAM", ScoringMode.FUSION)

        for clip in result.clips:
            assert clip.clip_id is not None
            assert clip.transcript is not None
            assert clip.naive is not None
            assert clip.fusion is not None

    def test_timeline_strategy_calls(self):
        """Test that strategy calls are generated."""
        result = timeline.build("2024-british-r", "HAM", ScoringMode.FUSION)

        # Should have some strategy calls if there's data
        if result.clips:
            assert isinstance(result.strategy_calls, list)

    def test_timeline_lead_lag(self):
        """Test lead-lag analysis is included."""
        result = timeline.build("2024-british-r", "HAM", ScoringMode.FUSION)

        # Lead-lag may be None if not enough data
        if result.lead_lag:
            assert hasattr(result.lead_lag, 'peak_lag_laps')
            assert hasattr(result.lead_lag, 'peak_correlation')
            assert hasattr(result.lead_lag, 'n_samples')

    def test_timeline_baseline(self):
        """Test driver baseline is calculated."""
        result = timeline.build("2024-british-r", "HAM", ScoringMode.FUSION)

        # Baseline may be None if no calm clips
        if result.baseline:
            assert result.baseline.driver == "HAM"
            assert result.baseline.n_baseline_clips >= 0
            assert hasattr(result.baseline, 'f0_mean')
            assert hasattr(result.baseline, 'rms_mean')


class TestTimelineDataIntegrity:
    """Test data integrity and consistency."""

    def test_stress_values_in_range(self):
        """Test that stress values are 0-100."""
        result = timeline.build("2024-british-r", "HAM", ScoringMode.FUSION)

        for point in result.points:
            if point.stress_index is not None:
                assert 0 <= point.stress_index <= 100, \
                    f"Stress {point.stress_index} out of range at lap {point.lap}"

    def test_pace_delta_reasonable(self):
        """Test that pace deltas are reasonable."""
        result = timeline.build("2024-british-r", "HAM", ScoringMode.FUSION)

        for point in result.points:
            if point.delta_s is not None:
                # Pace delta should be within ±30s (arbitrary but reasonable)
                assert -30 <= point.delta_s <= 30, \
                    f"Pace delta {point.delta_s} seems unreasonable at lap {point.lap}"

    def test_no_duplicate_laps(self):
        """Test that each lap appears only once."""
        result = timeline.build("2024-british-r", "HAM", ScoringMode.FUSION)

        laps = [p.lap for p in result.points]
        assert len(laps) == len(set(laps)), "Duplicate laps found"

    def test_clip_lap_mapping(self):
        """Test that clip laps match timeline laps."""
        result = timeline.build("2024-british-r", "HAM", ScoringMode.FUSION)

        timeline_laps = {p.lap for p in result.points}
        clip_laps = {c.lap for c in result.clips if c.lap is not None}

        # All clip laps should be in timeline
        assert clip_laps.issubset(timeline_laps), \
            f"Clip laps {clip_laps - timeline_laps} not in timeline"
