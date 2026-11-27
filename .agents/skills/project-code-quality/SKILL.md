---
name: project-code-quality
description: Keep fishing app changes maintainable, preserve the shared Pro ownership boundary, reuse existing modules, and verify affected H5 and WeChat behavior. Use for source changes and code reviews.
---

# Project Code Quality

Keep every change maintainable at repository scale, not merely functional in the edited file.

## Inspect Before Editing

1. Read `AGENTS.md`, the target module, related types, and the closest established implementation.
2. Run `git status --short` and preserve unrelated user changes.
3. Search with `rg` for existing utilities, components, tokens, dependencies, duplicated patterns, imports, and callers before adding code.
4. Load relevant domain skills. UI work uses the project's Apple Design and UI UX Pro Max references; use the local web guidelines for H5 concerns. Supabase work follows the available Supabase skill and the confirmed project `jupuypvmgjpnpntfetqv`.

## Keep Clear Ownership

- Follow existing ownership: provider/transport code in `src/services` and `src/platforms`, fishing policy in `src/domain`, reactive logic in `src/composables` and `src/stores`, fishing components in `src/components`, page orchestration in `src/pages`.
- General mobile UI/behavior belongs to Pro's `packages/mobile-core/src`. `src/_mobile-core` is generated; use the fixed source package or `MOBILE_PRO_ROOT` for integration.
- Expose one canonical implementation. Remove obsolete helpers, stale imports, and parallel old/new patterns after migrating callers.
- Extend the nearest shared abstraction when behavior is cross-cutting or needed by three or more callers.
- Do not add a wrapper that only renames an existing library or project utility.
- Keep generated `docs` output separate from source edits; regenerate it with the repository build rather than hand-editing assets.

## Protect User-Facing Errors

- Never render raw error objects, JSON dumps, stack traces, SQL, provider class names, or unexplained SDK messages.
- Branch on stable codes or status where available and provide concise Chinese workflow guidance with the next action.
- Preserve raw causes for controlled diagnostics without exposing them in the UI.
- Choose one notification owner to avoid duplicate toasts.

## Type And Async Integrity

- Use `unknown` plus narrowing at untrusted boundaries. Do not introduce broad `any`, double assertions, or untyped state to silence errors.
- Keep emits, public functions, API payloads, DTOs, and store state explicitly typed.
- Pair loading state with `finally`; prevent duplicate submissions and stale async results where relevant.
- Do not silently swallow unexpected failures. Return or throw according to the existing boundary contract.
- Preserve current Uni-app platform guards and avoid browser-only APIs outside H5-safe boundaries.

## Semantic And Interaction Quality

- Use `button`/`wd-button` for actions and platform navigation APIs for page transitions; do not attach primary actions to plain `view` or `text` nodes.
- Icon-only actions need an accessible name and visible focus treatment on H5.
- Never use `transition: all`; list animated properties and preserve the global reduced-motion fallback.
- Give content images an intentional accessible description where the target platform supports it and stable dimensions to avoid layout shift.
- Keep touch targets and safe-area handling consistent with the shared UI system.

## Refactor Completely

When consolidating code:

1. Move behavior into the canonical module.
2. Update every import and caller.
3. Delete the replaced implementation and obsolete tests.
4. Search globally for the old symbol, path, raw pattern, and duplicate implementation.
5. Review the diff for encoding, line-ending, generated-file, and unrelated changes.

## Verification Gate

Run focused checks before handoff:

```powershell
pnpm.cmd typecheck
pnpm.cmd build:h5
```

Also run focused checks and inspect `git diff --check`. For UI changes, inspect actual screenshots and the affected interaction. Build WeChat when cross-platform code changes. Use isolated output directories to preserve published assets, and report simulator/device limitations accurately. Do not require unrelated backend tests for a styling change.
