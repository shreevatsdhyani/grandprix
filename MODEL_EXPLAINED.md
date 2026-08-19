# How the Mood Prediction Works

A plain-language walkthrough of how a radio clip becomes **Calm**, **Stressed**, or **Tired**.

---

## What happens to a clip

**1. Clean it up.**
Convert to a standard format, cut the dead air at the start and end, and set every clip to the same volume. That last bit matters — otherwise a loud recording looks like a loud driver.

**2. Find the actual talking.**
A small model marks which parts are speech and which are engine noise. It also notes *what fraction* of the clip was speech, because long pauses are a tiredness clue.

**3. Listen three different ways.**
Three separate models each form an opinion:

| Branch | What it looks at | What it notices |
|---|---|---|
| **Voice mechanics** | pitch, loudness, wobble, pauses | *how* he's speaking |
| **Tone of voice** | the raw audio | angry / sad / happy / neutral |
| **Words** | the transcript | the emotion in what he said |

**4. Compare him to himself.**
This is the clever part. Instead of asking "is this voice high-pitched?", it asks **"is this higher than *this driver's* own normal?"** Every driver has a personal baseline built from their calm radio calls. Without it, a naturally loud driver would look permanently stressed.

**5. Combine and decide.**
All three opinions go into one small trained model, which outputs three percentages — Calm, Stressed, Tired — and picks the highest. The stress index is just how much of that weight landed on Stressed and Tired.

---

## Why three states and not two

The tone-of-voice model has no "tired" option — it was trained on emotions, and tiredness isn't an emotion. The voice-mechanics branch is what makes Tired detectable at all, because stressed and tired are near-opposites:

- **Stressed** → pitch up, voice jumpy, loud, fast
- **Tired** → pitch down, voice *flat*, quiet, slow, long gaps

The trained model learned exactly this. Flat pitch is its single strongest signal for Tired.

---

## Existing clips vs new uploads

- **Existing clip:** the answer was computed once and saved to a file. The app just reads that file. Nothing re-runs. That's the `cached` tag in the UI.
- **New upload:** everything above runs fresh, ~3 seconds, then gets saved too.

The cache never expires. If you change how the model works, old clips keep showing old answers until those saved files are deleted.

---

## Two things that are quietly broken

**Speaking speed isn't working.**
The transcriber isn't returning word timings, so "how fast is he talking" is always blank. The model learned to ignore it entirely. We're running on 7 signals instead of 8 — and we've lost one of the three tiredness clues.

**It can't tell excitement from anger.**
Nothing in the system measures whether an emotion is positive or negative — only how *activated* the voice is. Alonso shouting "that's P3!" and a driver shouting in rage look identical. That's why the celebration clip comes back Stressed at 89%.

---

## The honest caveat

The "88.7% accuracy" number isn't what it sounds like.

Nobody listened to these clips and labelled them. An earlier hand-written rule labelled all 854 of them, and then the current model was trained to copy that rule. So 88.7% means **"it copies the rule well"** — not "it's right about drivers." The 45% figure for the single-model comparison is scored against those same self-made labels, which tilts the comparison in fusion's favour.

The underlying idea is sound and the engineering is careful. But if someone asks in a demo, the accurate phrasing is: *"we distilled an interpretable rule into a classifier"* — not *"we validated it at 88.7%."*
