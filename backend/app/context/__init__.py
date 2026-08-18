"""Race context: what was true at a given instant.

The voice pipeline answers *how did the driver sound*. This package answers *and
what was happening to them* — the track, the tyres, where on the lap they were,
and what the race was doing around them.

Everything here resolves from a single UTC instant. That is a deliberate choice:
a cached race and a live one differ only in where the dataframes come from, so
the same resolver serves both and live mode becomes a new provider rather than a
rewrite.

Layering:

    provider.py   how you get context      (the seam: cached now, live later)
    resolver.py   instant -> ClipContext   (delegates to the four builders)
    track.py      weather and grip
    tyre.py       modelled tyre state
    position.py   where on the lap, and telemetry there
    situation.py  flags, position, gaps
    biometrics.py optional second stress channel

The builders take dataframes, never file paths. That is what keeps the live seam
honest.
"""
