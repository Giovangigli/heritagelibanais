# Héritage Libanais Studio

This repository holds the complete private Studio application:

- `apps/online`: editorial drafts and card editing, WordPress publishing, mailing, and Instagram work in progress.

See the app README for setup and hosting details. Local secrets belong in its ignored `.dev.vars` or environment variables; never commit credentials.

## Verification

With dependencies installed in `apps/online`, run `npm test`, `npm run lint`, and `npm run typecheck` from this directory.

See [FINAL_STUDIO_PLAN.md](FINAL_STUDIO_PLAN.md) for release gates and deferred social publishing work.

The WordPress theme and custom newsletter plugin live in the separate `Giovangigli/heritage-libanais-wordpress` repository. They deploy through WordPress separately from the private Studio.
