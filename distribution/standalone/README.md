# The standalone InfraDashboard

A re-creation of OpenSearch Dashboards 3.9.0 that is built from **two npm packages**, React and
React DOM, where the fork around it needs about 2,360. It exists because the fork cannot be
built where its packages cannot be fetched: a registry that serves only the versions it already
holds refused 174 of them. Nothing here imports a package of OpenSearch Dashboards, of its
component library or of its charts; the server, the components, the charts, the query language
and the formats are written in this directory.

What it keeps, so that it can stand where OpenSearch Dashboards stood:

- **The saved objects.** It reads and writes the same documents in the same `.kibana` index:
  index patterns, saved searches, visualizations, dashboards, advanced settings. A dashboard
  saved with OpenSearch Dashboards opens here, and what is saved here is written the same way.
- **The addresses.** `/app/dashboards#/view/<id>?_g=(...)&_a=(...)`, `/app/data-explorer/discover`,
  `/api/saved_objects/...`, `/api/status`: a bookmark or a script keeps working.
- **The settings.** `opensearch.hosts`, `server.basePath` and the rest carry the same names, in
  the same file, and the same environment variables (`OPENSEARCH_HOSTS`). The image has the
  layout of the OpenSearch Dashboards image, so the Helm chart in `../helm` runs it unchanged.
- **The look of a saved visualization.** Axes, ticks, bar widths, gauge and pie measures and the
  order of the palette follow OpenSearch Dashboards, in the Atlas design.

Like the fork, it has no sign-in and no permissions: see "No sign-in, no permissions" in
[`../README.md`](../README.md).

## Build and run

Node.js 22 and npm are all it needs.

```bash
cd distribution/standalone
npm ci                      # twelve packages: react, react-dom, typescript, their types
npm test                    # the unit tests, with node --test
node scripts/build.mjs      # dist/: the server as plain files, the browser side as one script
node dist/server/main.js --config config/opensearch_dashboards.yml
```

`OPENSEARCH_HOSTS='["http://localhost:9200"]' SERVER_PORT=5601 node dist/server/main.js` does the
same from the environment. What runs has no `node_modules`: the server uses Node's own modules
only, and React is inside the browser script.

### Will it build where I am?

```bash
node scripts/preflight.mjs                      # asks the registry npm is set up with
node scripts/preflight.mjs --registry <url>     # or another one
```

fetches each of the twelve packages from the registry, past the local cache, and names any that
cannot be had. Run it once on the machine or in the pipeline that will build the image.

`node scripts/check_lockfile.mjs` is the same question asked of the three lists in `registry/`
(what that registry could not serve when the fork was tried) and of the fork's lockfile, with no
network. It runs in CI, so a dependency that is added later is checked before anyone tries it.

### The image

```bash
docker build -t infradashboard:3.9.0 \
  --build-arg NODE_IMAGE=<your Node.js 22 image> \
  --build-arg NPM_CONFIG_REGISTRY=<your npm registry> \
  distribution/standalone
```

Both arguments are optional. A registry that wants credentials takes them from an `.npmrc` put
beside `package.json` for the build; it is used by the first stage and is not in the image. The
Dockerfile uses nothing of BuildKit, so docker, buildah and kaniko build it alike. The image runs
as any user id on a read-only file system, which is what OpenShift's restricted policy asks.

### On Kubernetes

The chart in `../helm/infradashboard` runs this image as it runs the fork's:

```bash
helm upgrade --install dashboards distribution/helm/infradashboard \
  --set image.registry=<registry> --set image.repository=infradashboard --set image.tag=3.9.0 \
  --set resources.requests.memory=128Mi --set resources.limits.memory=512Mi \
  --set nodeOptions=
```

The last two lines only give back what this server does not need: it holds about 60 MB.

## What is in it, and what is not yet

| | |
| --- | --- |
| Home, navigation, search bar (DQL and Lucene), filters, time picker, auto-refresh | done |
| Discover: fields, histogram, table, a document in place, surrounding documents, saved searches, CSV | done |
| Dashboards: list, view, edit (move, resize, add, replace, rename), save, clone, share, full screen | done |
| Visualizations drawn: area, line, bar, horizontal bar, pie, metric, gauge, goal, heat map, tag cloud, data table, markdown, controls, TSVB | done |
| Inspect (requests, responses, the table behind a chart) | done |
| Visualize: the list, the kinds to choose from, and the editor (metrics and buckets, the options of each kind, save, share, inspect) | done for the kinds above; TSVB is edited as JSON; clicking the "Other" slice adds no filter; "Show values on chart" and "Order buckets by sum" are not offered |
| Management: index patterns (create, fields, formats, scripted fields, source filters), saved objects (export, import, relationships, inspect), advanced settings | done |
| Dev Tools: the console (several requests, send, auto indent, copy as cURL, paste cURL, history, settings, import, export) and the Grok debugger | done; suggestions cover methods, paths, index names and the body of a search, not every API; no folding of a body |
| Query Workbench: SQL and PPL, the list of indices, results a page at a time with rows that open, search, downloads (JDBC, CSV, text), Explain, full screen; the plugin's `/api/sql_console` routes | done; the "Output" tab also says why a query failed, where the plugin leaves that out; `pplcsv` and `ppltext` answer the text, where the plugin answers 400 with the text as its message; no Spark or S3 data sources |
| Index Management: the plugin's `/api/ism` routes; indexes with their actions; state management policies (list, JSON editor, visual editor, details); policy managed indexes and change policy; aliases; templates and component templates; data streams | lists and policies done; the pages that create an index, a template, a component template or a data stream, the index operations (reindex, shrink, split, force merge, roll over), rollup and transform jobs, notification settings and Snapshot Management are not yet |
| Vega, Timeline, coordinate and region maps, VisBuilder objects | not drawn yet; the panel says so |

Until the pages in the lower half exist, the fork's build does those jobs on the same saved
objects.

## How it is put together

```
server/    Node.js: HTTP, the OpenSearch client, saved objects, settings, import and export,
           the routes of Query Workbench and of Index Management
common/    what both sides share
web/       the browser side
  components/  the Atlas kit: buttons, forms, tables, overlays      (class prefix atl)
  shell/       the page frame, search bar, filter bar, time picker   (shl)
  charts/      SVG charts: axes, scales, legends, tooltips           (cht)
  vis/         one file per kind of visualization, and TSVB          (vis)
  apps/        home, discover (dsc), dashboard (dsh), visualize (vze), management (mgt),
               dev_tools (dvt), query_workbench (qwb), index_management (ism)
  lib/         DQL, rison, date math, number and date formats, aggregations, markdown,
               the syntax of a search box
scripts/   build.mjs (TypeScript compiler and a small bundler), the two registry checks
registry/  the packages the target registry could not serve, as it reported them
```

### The rule for a dependency

A package may be added only at a version that the target registry is known to hold: one that is
in the fork's `yarn.lock` and on none of the lists in `registry/`, or one that
`registry/other_versions.txt` names. `scripts/check_lockfile.mjs` enforces it. The lists were
transcribed from the registry's own report; when the registry changes, change them.

## Licence

Apache-2.0, as the fork. [`NOTICE`](NOTICE) says what was derived from OpenSearch Dashboards and
what the browser script bundles.
