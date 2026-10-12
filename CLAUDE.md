# Glyphsmith: working notes for Claude Code

Project 2 of 11 from "Project PRDs: 11 Builds for Claude Code". Slug `glyphsmith`.

## Commands

- `npm run dev` serves on port 4102 (3000, 8000 and 5432 are taken on this machine)
- `npm test` runs all tests, `npm run typecheck` runs tsc, `npm run build` makes a static site in `dist/`
- `npm run font -- --hand Hurried` builds a font from a demo hand without a browser
- `npm run art` regenerates the template SVG and the synthetic sample photo
- `npm run demo` records `docs/demo.gif` against a running dev server, and saves the font the browser exported to `dist-font/`
- Python validation needs `python3.12 -m venv .venv && .venv/bin/pip install fonttools brotli`, then `npm run validate`
- `swift scripts/coretext-check.swift Font.ttf out.png` asks macOS to load and render a font

## Shared conventions

- **Repo:** one repo per project, named by its slug, MIT license, README.md with a demo GIF and a one-command quickstart.
- **Default stack:** TypeScript with Vite or Next.js for web, Python (FastAPI) for ML and audio services. A PRD overrides this where it says so.
- **Creative direction:** portfolio pieces, each with a distinct visual identity from its style bible.
- **Image requests:** Claude Code does not generate images. Every image is requested from Ayaan in `/assets/prompts.md` with an asset ID, the exact prompt, size, format, save path under `/assets/generated`, and what it is for.
- **Quality bar:** typed code, at least 3 automated tests per milestone, no secrets in git, ARCHITECTURE.md of at most one page.
- **Definition of done:** runs from a clean clone with one command, passes all acceptance tests, deployed or recorded demo, README lists limitations and the next three ideas.

## How the image rule was applied here

Ayaan asked for this build to run with as few stops as possible, so the five images were requested in `assets/prompts.md` without waiting. The hero, posters and template are drawn in code until delivered files appear in `assets/generated`.

## Writing

No em dashes anywhere. README prose should sound like a person: varied sentences, no rule-of-three lists, no "it's not X, it's Y" constructions.

## Things that will bite

- Never put a control on top of a drawing canvas. A redo button in the corner once ate the first touch of every "d" stem.
- `calibrate` must not be called on every sample change after the tenth letter, or one redraw moves all 90 glyphs.
- `hash()` needs its finishing mix. Plain FNV-1a gives near-identical values for labels that differ in the last character.
- Scripts run under Node cannot use Vite's `?raw` import. Use `scripts/lib/skeleton-node.ts`.
- gifenc is CommonJS: default-import it and destructure.
