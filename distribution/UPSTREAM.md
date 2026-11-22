# Living next to upstream

This repository is a fork of
[opensearch-project/OpenSearch-Dashboards](https://github.com/opensearch-project/OpenSearch-Dashboards).
`main` started at the upstream tag `3.9.0` (commit `def668b5c4ad825dfff980ed0951cca07aa0ac4b`) and
carries upstream's history, so an upstream release can be merged in.

## The rule

A change goes where it will not collide with upstream:

1. **Our own files** go under `distribution/` (and, from the theme work on, in packages of our
   own). Upstream never touches these.
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
| `eslint.config.js` | One block for `distribution/**` | Our files carry the licence line without the upstream copyright notice. |
| `src/dev/precommit_hook/casing_check_config.js` | One ignore pattern, `distribution/helm/**/*` | Helm decides the names of a chart's files. |
| `README.md`, `CLAUDE.md` | Rewritten or extended | They describe this distribution. |
| `.github/pull_request_template.md` | Rewritten | Ours. |
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
3. Move `distribution/plugins.json` to the plugin tags of the same release (`3.10.0.0`), with the
   commit each tag points at, and set `dashboardsVersion`. The upstream release's
   [manifest](https://github.com/opensearch-project/opensearch-build/tree/main/manifests) lists
   the plugins of a release.
4. Change the OpenSearch version in `distribution/docker/*.yml`, the chart's `appVersion`, the
   version in this file and the READMEs, and the branch the functional tests come from
   (`TEST_BRANCH` in `.github/workflows/cypress_workflow.yml`, `3.10` for 3.10.0).
5. Open a pull request. The upstream test suites and the Distribution workflow run on it.

Dashboards and OpenSearch are released together; run a Dashboards release against the OpenSearch
of the same version.
