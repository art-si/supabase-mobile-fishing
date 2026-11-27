---
name: web-design-guidelines
description: Review the fishing app's H5 and cross-platform UI for accessibility, typography, touch targets, safe areas, responsive layout, content handling, and performance. Use for relevant interface reviews and fixes.
---

# Web Interface Guidelines

Review the requested UI files against the latest rules at:

`https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`

Fetch the source before each review when internet access is available. Apply rules that map to Uni-app and the enabled target platforms; do not force React-specific syntax onto Vue or mini-program output.

Follow `docs/design-direction.md` and existing Pro `Mobile*` components first. Keep platform safe areas and native capabilities; H5 is the visual baseline. External rules are review guidance, not authorization to introduce features or replace the design system.

## Uni-app Mapping

- Treat `wd-button` or native `button` as the semantic action primitive. Flag action handlers placed on plain `view`/`text` when a button is practical.
- Check accessible names for icon-only controls, labels for inputs, focus-visible behavior on H5, and non-color status cues.
- Check `env(safe-area-inset-*)`, touch target size, intentional tap highlight, and popup scroll containment.
- Check long Chinese text, identifiers, addresses, missing values, numeric alignment, and accidental horizontal overflow.
- Check explicit image dimensions, appropriate loading behavior, `prefers-reduced-motion`, and enumerated transitions.
- Accept Uni-app lifecycle, navigation, and conditional compilation patterns when they provide the platform-equivalent behavior.

## Review Workflow

1. Read the requested files plus the shared tokens and relevant child components.
2. Fetch and apply the current guideline rules.
3. Verify rendered behavior in a real browser when practical.
4. Fix issues when the user requested implementation; otherwise report concise findings grouped by file as `file:line - issue`.
5. Mark clean files with `✓ pass` and state any platform or browser verification limitation.
