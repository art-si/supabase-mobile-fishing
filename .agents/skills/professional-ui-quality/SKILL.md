---
name: professional-ui-quality
description: Review and improve the fishing app's Uni-app interfaces against its existing H5 baseline, shared Pro components, accessibility, responsive layout, and cross-platform screenshot evidence.
---

# Professional UI Quality

Treat visual and interaction quality as part of feature completion. Follow `docs/design-direction.md`: simple, practical, calm, content first, readable outdoors and at night. Use the existing H5 pages as the visual baseline for WeChat and Capacitor.

## Use The Existing System

- Use `src/domain/appearance.ts`, `src/styles/fishing-tokens.scss`, and the Pro `Mobile*` components as the source of truth. Keep shared fixes in Pro's `packages/mobile-core/src`; never edit generated `src/_mobile-core`.
- Extend the nearest shared token or component before duplicating a broadly useful pattern in a page.
- Use the existing platform system font stack and tabular numerals. Preserve the three fishing skins and their light/dark semantic colors.
- Build hierarchy with typography, spacing, grouping, borders, and tonal contrast before adding decoration.
- Keep one clear primary action per region. De-emphasize secondary and destructive actions.

## Mobile Design Rules

- Use a 4/8/12/16/24/32px spacing rhythm, translated consistently to `rpx`.
- Keep equivalent actions at the existing `--tms-control-height` and `--fishing-control-radius`; touch targets use `--fishing-target` (48px). Visual icons may be smaller than their controls.
- Respect every `env(safe-area-inset-*)` edge used by a full-bleed header, footer, popup, or bottom navigation.
- Use `min-width: 0`, wrapping, line clamping, or truncation deliberately. Never allow accidental horizontal scrolling.
- Avoid tiny low-contrast labels. Status must include text or an icon, not color alone.
- Treat hover as progressive enhancement; always design active, disabled, loading, and focus-visible states.

## Required Workflow

1. Read the target page, child modules, fishing tokens, `docs/design-direction.md`, and relevant local Apple Design / UI UX Pro Max references.
2. Identify the primary task, primary action, hierarchy, high-frequency data, and narrowest supported viewport.
3. Reuse or extend shared components and tokens. Do not introduce a competing local design system.
4. Implement relevant loading, empty, error/retry, disabled, busy, success, long-text, missing-value, and dense-data states.
5. Run typecheck and an H5 build. Review the focused diff and scan for duplicated patterns or accidental encoding changes.
6. Inspect actual H5 screenshots at 320/375/440px, landscape, wide, dark, and large text. Check focus, popups, internal clipping, and console errors. Compare actual WeChat/Capacitor rendering where available; preserve each platform's real safe areas and native capabilities.
7. Iterate on visible defects before handoff. If browser verification is blocked, state that the visual gate remains unverified.

## Acceptance Checklist

- The workflow purpose and next action are immediately understandable.
- Type hierarchy clearly separates title, section, body, metadata, and status.
- Cards and sections align to a coherent grid and spacing rhythm.
- Equivalent buttons share height, radius, typography, icon gap, and state behavior.
- Long Chinese names, addresses, identifiers, and large numbers remain usable.
- Loading, empty, error, retry, disabled, and completion states look intentional.
- No new horizontal overflow or console errors appear at mobile width.
- Record local demo, API-contract, simulator, and physical-device evidence separately. Never treat an H5 build or screenshot as native-device acceptance.
