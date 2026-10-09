# PWA Layout — Build Result

**Date:** 2025-07-17
**Status:** ✅ PASS

## Checks performed

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm run build:pwa` | ✅ Success (17.19s) |
| `npm run build` (desktop) | ✅ Success (19.75s) |
| Desktop bundle contains `drawerOpen` | ❌ NOT found (correct — PWA-only) |
| Desktop bundle contains `bottomTabs` | ❌ NOT found (correct — PWA-only) |

## Bundle output (desktop)

- `dist/assets/index-CVC2htCn.js` — 1,564.31 kB (gzip: 408.08 kB)
- `dist/assets/index-AZ5ZxdIw.css` — 99.56 kB (gzip: 16.03 kB)

## Bundle output (PWA)

- `dist/assets/index-BBNyq2_F.js` — 1,564.28 kB (gzip: 408.08 kB)

## Warnings (pre-existing, not regressions)

- Some chunks exceed 500 kB — pre-existing, unrelated to PWA layout changes.
- Dynamic/static import overlap for `axios`, `api.ts`, `settings.store.ts` — pre-existing.
