# `__skills/` — Reusable Implementation Procedures

This directory contains [Anthropic Agent Skills](https://github.com/anthropics/skills) (folder-per-skill, `SKILL.md` with YAML frontmatter) used by the implementation plans in [`__plans/`](../__plans/). Each skill encodes a *procedure* (step order, gotchas, validation) and points at the corresponding design spec under [`__specs/`](../__specs/) for the *rationale*.

> Read [`__plans/00-overview.md`](../__plans/00-overview.md) first — it maps each skill to the phase that invokes it.

---

## Provenance

Per-skill provenance (custom-written vs downloaded), a one-line purpose, build phase, and the spec each implements live in a single source of truth: **[`../SKILLS_GALLERY.md`](../SKILLS_GALLERY.md)** at the repo root.

**16 skills — 13 custom-written · 3 downloaded** (Apache-2.0, vendored from `anthropics/skills@690f15c`).

---

## Convention

Every skill folder contains:

```
<skill-name>/
├── SKILL.md          # frontmatter: name, description (must include "Use when..."), optional license
└── (supporting files referenced by SKILL.md)
```

**Writing a new skill**: invoke [`skill-creator`](./skill-creator/) for the template + best practices, or copy an existing written skill's shape. The `description:` field is what an LLM matches against to auto-invoke — include both *what it does* and *when to use it*.

**Frontmatter validation**:

```bash
for f in __skills/*/SKILL.md; do
  head -10 "$f" | grep -qE '^name:' && head -10 "$f" | grep -qE '^description:' \
    || echo "MISSING required frontmatter: $f"
done
```

**Vendoring upstream updates**: re-clone `anthropics/skills`, diff against the vendored copy, decide per-skill whether to take the update; bump the commit SHA in this README and in [`NOTICE`](./NOTICE).

---

## License

Vendored skills retain their upstream Apache-2.0 license (`LICENSE.txt` inside each folder, attributed in [`NOTICE`](./NOTICE)). Written skills are part of this repository and follow the repo's license.
