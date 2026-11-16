# upgrade-registry fixture

Offline npm registry for scenario `11-upgrade`. It exists so the e2e suite can
exercise the real `dsh-opentui upgrade` chain — `npm view` for the plan and
`dsh plugin add --save-exact` -> `pnpm add` for the install — without touching
a real registry.

## Shape

- `build-fixture.mjs` — reads the shipped `PLUGIN_SET` from the source tree's
  `packages/shell/scripts/lib/provision-plan.mjs`, writes one stub tarball per
  plugin at its shipped pin, and bumps ONE package by a patch version (argument
  `--bump`, default `@aiwayds/dsh-cron`). Output:
  - `tarballs/<slug>-<version>.tgz` — gzipped tar with a `package/` root, no
    dependencies, no install scripts, no `engines`
  - `packuments/<slug>.json` — packument with `dist-tags.latest`, the single
    served `versions[v]` and the `dist.integrity`/`dist.shasum` of that tarball
  - `meta.json` — bump/current/target, served plugins, and the scratch profile
    manifest (dependencies at shipped pins + `dsh.profile.bundles`)
- `serve.mjs` — `node:http` server bound to `127.0.0.1:0`. Serves
  `GET /<name>` (packument; percent-encoded scoped names work too) and
  `GET /<name>/-/<file>.tgz` (tarball bytes); everything else is 404. It
  rewrites `dist.tarball` with the live origin and prints
  `REGISTRY http://127.0.0.1:<port>` on stdout so the scenario can read the
  port.

## Why the extra wiring in the scenario

- Query path: `DSH_UPGRADE_REGISTRY=http://127.0.0.1:<port>` (the command's
  explicit registry seam, highest priority).
- Install path: the scratch profile's `.npmrc` carries
  `registry=http://127.0.0.1:<port>/`, which is what `pnpm` (spawned by
  `dsh plugin add` inside the profile directory) reads. Both paths must point
  at the fixture: the query alone would plan a version the installer could
  never fetch.

## minimumReleaseAge

pnpm's `minimumReleaseAge` gate refuses versions whose publish time is too
recent. Every fixture version is stamped `2024-01-01T00:00:00.000Z` in the
packument `time` map, so the gate passes on machines where it is enabled,
without disabling or inventing any pnpm setting. (No `.npmrc` knob is needed;
the timestamp is the mechanism.)
