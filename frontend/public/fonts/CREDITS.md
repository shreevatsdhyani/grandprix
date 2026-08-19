# Font credits

All faces here are [SIL Open Font License 1.1](https://openfontlicense.org), from
Google Fonts. They ship in the repo so the demo runs with no network — a webfont
request that fails takes the whole type system with it, and the GrandPrix round
is judged offline.

Each file is the **latin subset only** (`U+0000-00FF, U+0131, U+0152-0153,
U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F,
U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD`). The UI is
English-only, so the Cyrillic, Greek and Vietnamese subsets are not shipped.

| File | Family | Weight | Upstream |
| --- | --- | --- | --- |
| `barlow-400-latin.woff2` | Barlow | 400 | [Barlow](https://fonts.google.com/specimen/Barlow) |
| `barlow-500-latin.woff2` | Barlow | 500 | " |
| `barlow-600-latin.woff2` | Barlow | 600 | " |
| `barlow-cond-500-latin.woff2` | Barlow Condensed | 500 | [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed) |
| `barlow-cond-600-latin.woff2` | Barlow Condensed | 600 | " |
| `barlow-cond-700-latin.woff2` | Barlow Condensed | 700 | " |
| `robotomono-var-latin.woff2` | Roboto Mono | variable 100–700 | [Roboto Mono](https://fonts.google.com/specimen/Roboto+Mono) |

Roboto Mono is a variable font, so the single file covers every weight the UI
asks for (400 / 500 / 600 / 700). Barlow and Barlow Condensed are static
instances, so each weight is a separate file — **only the weights listed above
exist**. Asking for Barlow 700 or Barlow Condensed 800 makes the browser
synthesise a fake bold, which looks visibly wrong next to the real 600.

## Provenance

These were extracted from the design artifact `Silent Co-Driver F1.html` at the
repo root, which embeds them base64-encoded in its `__bundler/manifest` block, so
no download was needed. To regenerate:

```python
import re, json, base64, zlib, pathlib
txt = open('Silent Co-Driver F1.html', encoding='utf-8').read()
d = json.loads(re.search(r'<script type="__bundler/manifest">(.*?)</script>', txt, re.S).group(1))

WANT = {
    'barlow-400-latin.woff2':      'ee17c7af-dc09-460f-be79-e064caaa4bba',
    'barlow-500-latin.woff2':      'b3022c9d-40f3-4814-b4f2-4fd416fd6ca4',
    'barlow-600-latin.woff2':      '65e5c237-bb73-4891-bd8d-0655def413e1',
    'barlow-cond-500-latin.woff2': '2b3c8ef1-0ed8-43fa-828e-907250751e79',
    'barlow-cond-600-latin.woff2': '02fb250b-db5f-4266-acf9-581d1989b8c6',
    'barlow-cond-700-latin.woff2': 'c7e9da83-95e6-4f06-9470-8a97422aa134',
    'robotomono-var-latin.woff2':  '6e4ac462-32f4-4cf6-9e1a-824f600ca4d8',
}
out = pathlib.Path('frontend/public/fonts')
for name, uuid in WANT.items():
    e = d[uuid]
    raw = base64.b64decode(e['data'])
    if e.get('compressed'):
        raw = zlib.decompress(raw)
    assert raw[:4] == b'wOF2'
    (out / name).write_bytes(raw)
```

The manifest keys the same family/weight once per unicode subset; the uuids above
are the latin ones. If the artifact is ever regenerated the uuids change, so
match on the `@font-face` rule whose `unicode-range` starts `U+0000-00FF`.

Failing that, the files are stock Google Fonts and can be re-fetched from
`fonts.googleapis.com` — but do that at build time, never at runtime.
