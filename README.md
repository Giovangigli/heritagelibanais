# Héritage Libanais Studio

This repository holds both studio applications in one project:

- `apps/online`: the online studio and publishing workflow.
- `apps/cards`: the card editing studio.

Each app remains independently deployable. See its README for setup and hosting details. Local secrets belong in each app's ignored `.dev.vars` or environment variables; never commit credentials.

## Verification

With dependencies installed in both app directories, run `npm test`, `npm run lint`, and `npm run typecheck` from this directory.

See [FINAL_STUDIO_PLAN.md](FINAL_STUDIO_PLAN.md) for release gates and deferred social publishing work.

The WordPress theme and custom newsletter plugin live in the separate `Giovangigli/heritage-libanais-wordpress` repository. They deploy through WordPress separately from the private Studio.
