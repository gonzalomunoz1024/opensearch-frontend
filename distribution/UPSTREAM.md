# Living next to upstream

This repository is a fork of
[opensearch-project/OpenSearch-Dashboards](https://github.com/opensearch-project/OpenSearch-Dashboards).
`main` started at the upstream tag `3.9.0` (commit `def668b5c4ad825dfff980ed0951cca07aa0ac4b`) and
carries upstream's history, so an upstream release can be merged in.

## The rule

A change goes where it will not collide with upstream:

1. **Our own files** go under `distribution/` and in packages of our own, `packages/osd-atlas-*`
   (a package has to live under `packages/` for the build to find it). Upstream never touches
   these.
2. **A change to an upstream file** is kept as small as it can be and is written down in the
   table below. Prefer an extension point (a setting, a registry, a theme, a plugin) over an edit.
3. **Upstream files we do not use are deleted, not edited**, so a merge reports them once as
   "deleted by us" and nothing else.

## Upstream files the fork changes

| File | Change | Why |
| --- | --- | --- |
| `src/core/server/rendering/rendering_service.tsx` | `DEFAULT_TITLE` | The product's name. |
| `src/core/server/rendering/views/template.tsx` | The page title's fallback | The product's name. |
| `src/core/public/chrome/ui/header/header_breadcrumbs.tsx` | The title's initial value | The product's name. |
| `src/core/server/rendering/**/__snapshots__/*.snap` | Regenerated | They record the title. |
| `src/core/server/core_app/assets/logos/*`, `default_branding/*`, `favicons/*` | Written by `distribution/branding/render_assets.js` | Our mark in place of the OpenSearch one, which is a trademark we may not ship as ours. File names are kept. |
| `eslint.config.js` | One block for `distribution/**` and `packages/osd-atlas-theme/**` | Our files carry the licence line without the upstream copyright notice. |
| `eslint.config.js` | One ignore, `distribution/standalone` | The standalone product is a project of its own, with its own compiler settings and tests; the rules of the Dashboards tree are not written for it. |
| `src/dev/precommit_hook/casing_check_config.js` | One ignore pattern, `distribution/helm/**/*` | Helm decides the names of a chart's files. |
| `README.md`, `CLAUDE.md` | Rewritten or extended | They describe this distribution. |
| `.github/pull_request_template.md` | Rewritten | Ours. |
| `packages/osd-ui-shared-deps/theme_config.js`, `theme_config.d.ts`, `theme.ts`, `rspack.config.js`, `package.json` | The theme version `atlas`: its label, tags, stylesheets and variables | Registers the Atlas theme (`packages/osd-atlas-theme`) beside v7, v8 and v9, the way `docs/theme.md` describes. |
| `src/legacy/ui/ui_render/ui_render_mixin.js` | `atlas` in `THEME_SOURCES`, `fontText` and `fontCode` | The loading screen's colours and the first paint's fonts for the theme. |
| `src/core/server/ui_settings/ui_settings_config.ts` | `DEFAULT_THEME_VERSION` is `atlas` | The product opens in the Atlas theme. `uiSettings.defaults` in the configuration can still choose another. |
| `src/core/public/core_app/styles/_globals_atlaslight.scss`, `_globals_atlasdark.scss` | New files | The optimizer looks here for what to put in front of a plugin's styles; they import the theme package. |
| `packages/osd-optimizer/src/__fixtures__/mock_repo/src/core/public/core_app/styles/_globals_atlas*.scss` | New files | The optimizer's integration test compiles its fixture for every theme. |
| `packages/osd-optimizer/src/common/theme_tags.test.ts`, `packages/osd-optimizer/src/integration_tests/basic_optimization.test.ts` and its `__snapshots__` | Expectations regenerated | They list every theme tag, and the tag CI compiles. |
| `.github/workflows/build_and_test_workflow.yml`, `cypress_workflow.yml` | `OSD_OPTIMIZER_THEMES` is `atlaslight` instead of `v8light` | The workflows compile one theme, the one the product opens in, so that the functional tests see the product as it ships. |
| `package.json` | One line for `@osd/atlas-theme` | The root imports the theme's variables. |
| `.stylelintrc.yml` | An `overrides` entry for `packages/osd-atlas-theme` that turns off the four `@osd/stylelint` rules | Those rules keep a plugin from restyling OUI's components and from naming colours, which is what a theme does. Every other rule applies to the theme. |
| `packages/osd-ui-shared-deps/entry.js` | `ElasticEuiChartsTheme` and `ElasticCharts` go through `@osd/atlas-theme/charts_theme` | Charts take OUI's first theme whatever theme the page runs, and the chart library's own base theme where they are given none (its dark one is navy). Under the Atlas theme both get the Atlas colours around the data; under OUI's themes the two exports are OUI's and the library's, untouched. |
| `src/plugins/discover/public/application/components/chart/histogram/histogram.tsx` | The grid and axis lines take the theme's `euiColorChartLines` instead of having their colour deleted | Deleting it fell back to a colour made for a light page, which glared in dark mode. Under OUI's own themes the lines now take that theme's chart-line colour too. |
| `docs/_sidebar.md` | One line, written by the repository's own generator | It lists the README of every package, and `packages/osd-atlas-theme` is one. |
| `.github/workflows/cypress_workflow.yml` | `cypress-io/github-action` pinned to v7.4.10 instead of v6.10.9 | The pinned release fails on today's runners while it waits for the servers ("Socket closed before the connection was established"), before any test runs. |
| `.github/workflows/cypress_workflow.yml` | The functional tests come from the `3.9` branch of `opensearch-dashboards-functional-test` instead of the branch named like the pull request's base | Upstream's base branches are release lines, and the test repository has a branch for each. Ours are `main` and branches of our own: `main` there holds the tests of upstream's next release, and a branch of ours does not exist there, so the nine groups would fail at checkout. |

## Upstream files the fork removes

Automation that only works in the upstream organisation (its bots, its secrets, its issue
tracker): `.github/CODEOWNERS`, `.github/doc_issue_template.md`, and the workflows `add-untriaged`,
`backport`, `build_with_plugins_workflow` (replaced by `distribution.yml`), `create_doc_issue`,
`cypress_workflow_with_s3`, `github-workflow-badger`, `issue-dedupe`, `lighthouse_testing`,
`links_checker`, `post_merge_test`, `pr_review`, `release_cypress_workflow` and `version-increment`.

The upstream test workflows `build_and_test_workflow`, `cypress_workflow`, `dependency_review` and
`post_ci_results` are kept; the one change to them is in the table above.

## Taking an upstream release

```bash
git remote add upstream https://github.com/opensearch-project/OpenSearch-Dashboards.git   # once
git fetch upstream tag 3.10.0
git switch -c upstream-3.10.0 main
git merge 3.10.0
```

Then:

1. Resolve the conflicts. They should all be in the files of the two lists above: keep our side
   for the files in the first table, re-apply the one-line edits if upstream moved them, and
   `git rm` what the second list removes.
2. Run `node distribution/branding/render_assets.js --png`, in case upstream added or renamed an
   asset, and `yarn test:jest src/core/server/rendering -u` to regenerate the title snapshots.
3. If upstream moved to a newer OUI, set the same version in `packages/osd-atlas-theme/package.json`,
   build the theme (it fails if OUI gained a variable the theme leaves undefined) and look at
   the product in both modes: a new or changed component may need a refinement.
4. Move `distribution/plugins.json` to the plugin tags of the same release (`3.10.0.0`), with the
   commit each tag points at, in both of its lists, and set `dashboardsVersion`. The upstream release's
   [manifest](https://github.com/opensearch-project/opensearch-build/tree/main/manifests) lists
   the plugins of a release.
5. Change the OpenSearch version in `distribution/docker/**/*.yml`, the chart's `appVersion`, the
   version in this file and the READMEs, and the branch the functional tests come from
   (`TEST_BRANCH` in `.github/workflows/cypress_workflow.yml`, `3.10` for 3.10.0).
6. Open a pull request. The upstream test suites and the Distribution workflow run on it.

Dashboards and OpenSearch are released together; run a Dashboards release against the OpenSearch
of the same version. The lite backend (`gonzalomunoz1024/opensearch-backend`) moves to the same
release, with the backend plugins the shipped Dashboards plugins need.
