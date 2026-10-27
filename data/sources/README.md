# Licensed sources

Each source is a `<id>.txt` (exact bytes, hashed) plus `<id>.json` metadata (license, attribution, sha256, retrieval time, transcription notes). `packages/sources` refuses to load a text whose hash no longer matches. Line endings are protected by `.gitattributes`.

| Id | Page | Use |
|---|---|---|
| `nasa-grc-equations-of-motion` | NASA Glenn, Beginner's Guide to Aeronautics — Equations of Motion | Supported demo source: constant force and mass, a = F/m, V = a·t + Vo, x = a·t²/2 + Vo·t + xo |
| `nasa-grc-speed-of-sound` | NASA Glenn — Speed of Sound Interactive (article sections only) | Stage 2: deliberately unsupported. Stage 5: supported by `speed-of-sound-v1` (a = sqrt(gamma * R * T)) |
| `nasa-grc-lift-equation` | NASA Glenn — Lift Equation | Stage 5 supported source for `lift-equation-v1` (L = Cl * (rho * V^2 / 2) * A) |
| `nasa-grc-ballistic-flight-equations` | NASA Glenn — Ballistic Flight Equations | Stage 5 supported source for `projectile-v1` (y = V0 * t - g * t^2 / 2, ymax = V0^2 / (2 * g)) |
| `nasa-grc-flight-equations-with-drag` | NASA Glenn — Flight Equations with Drag | Stage 5 deliberately unsupported: real physics (drag, terminal velocity) that no tested engine models; the pipeline should decline rather than force projectile-v1 |

## License basis (checked 2026-10-27)
NASA Images and Media Usage Guidelines (https://www.nasa.gov/nasa-brand-center/images-and-media/): NASA content is generally not subject to US copyright and may be used for educational purposes with NASA acknowledged as the source. Its **AI applications** section permits use in AI tools on conditions this project follows:
- Disclose that the tool includes NASA source material, without implying NASA review or permission.
- Attribute AI outputs to the AI product, never "according to NASA".
- No NASA insignia with AI-generated content; mark AI-generated products as such.
- NASA is not responsible for the accuracy of AI outputs.

No NASA images, logos or third-party copyrighted figures are stored; text only.

## Rejected candidate
OpenStax *College Physics 2e* §4.3 (planned originally): the page now states the book is **CC BY-NC-SA 4.0** and "may not be used in the training of large language models or otherwise be ingested into large language models or generative AI offerings without OpenStax's prior written permission." Not used.

Stage 5 sources were retrieved 2026-10-27 with the same transcription rules (equations transcribed as printed, including any typos in the original page).
