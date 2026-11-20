# The distribution

Everything that turns the OpenSearch Dashboards source in this repository into Atlas Dashboards
lives here, so the upstream tree stays close to what upstream ships.

| Path | What it is |
| --- | --- |
| `branding/brand.json` | The name, the accent and ink colours, the type. The one place to change them. |
| `branding/render_assets.js` | Draws the logos, the loading mark and the favicons from `brand.json`. |
| `plugins.json` | The 16 plugins that ship with it, each pinned to a tag and a commit. |
| `scripts/fetch_plugins.js` | Fetches a pinned plugin into `plugins/` and checks the commit. |
| `scripts/build.sh` | Builds the platform, the plugins and the assembled tarball. |
| `scripts/smoke_test.js` | Checks a running instance: green, plugins loaded, sign-in works. |
| `config/opensearch_dashboards.yml` | The settings the tarball and the image start with. |
| `config/dev.yml` | Settings for running the source against the development OpenSearch. |
| `docker/Dockerfile`, `docker/entrypoint.sh` | The image. |
| `docker/docker-compose.yml` | The image with a secured OpenSearch 3.9.0, to try it. |
| `docker/dev/docker-compose.yml` | An OpenSearch 3.9.0 without security, for `yarn start`. |
| `helm/atlas-dashboards` | The Kubernetes chart. |
| `UPSTREAM.md` | Which upstream files the fork changes, and how to take an upstream release. |

## Name and logo

`brand.json` holds the product's name and colours. The mark is a ring with three rising bars,
drawn as a flat glyph in the accent colour like the other Atlas marks.

```bash
node distribution/branding/render_assets.js          # the SVGs
node distribution/branding/render_assets.js --png    # and the favicons, which need a Chromium
```

The script writes over the upstream asset files under `src/core/server/core_app/assets`, keeping
their names, so nothing that refers to them has to change. Edit `brand.json` or the script, never
the generated files. The `--png` step uses the repository's Puppeteer; point
`PUPPETEER_EXECUTABLE_PATH` at a Chromium if Puppeteer has none of its own.

The name also appears as the default page title in three source files, listed in `UPSTREAM.md`,
and as the title of the sign-in page, which is a setting of the security plugin in
`config/opensearch_dashboards.yml` and in the Helm chart's defaults.
A deployment can still set its own name and logos with the `opensearchDashboards.branding`
settings, as in OpenSearch Dashboards.

## Plugins

`plugins.json` lists the plugins of the OpenSearch Dashboards 3.9.0 distribution with the tag and
the commit each one is built from. They are fetched at build time into `plugins/`, which Git
ignores; their source is not copied into this repository.

```bash
node distribution/scripts/fetch_plugins.js --list
node distribution/scripts/fetch_plugins.js securityDashboards
```

A fetch fails if the tag no longer points at the pinned commit. To move a plugin to another
version, change its tag and commit together.

Do not leave a fetched plugin under `plugins/` while `yarn start` runs: the development server
picks it up and stops if the plugin has not been bootstrapped.

## Build

```bash
distribution/scripts/build.sh platform        # target/opensearch-dashboards-3.9.0-linux-x64.tar.gz
distribution/scripts/build.sh plugin <name>   # target/plugins/<name>-3.9.0.zip
distribution/scripts/build.sh plugins         # every plugin, one after another
distribution/scripts/build.sh assemble        # target/atlas-dashboards-3.9.0-linux-x64.tar.gz
distribution/scripts/build.sh all
```

Build the platform first: its build clears `target/`. Each plugin is built with only itself under
`plugins/`, as the upstream release does, because the plugins bring their own dependencies and
cannot all be installed side by side. `ARCH=arm64` builds for arm64.

## Image

```bash
docker build -f distribution/docker/Dockerfile \
  --build-context dist=target --build-arg VERSION=3.9.0 \
  -t atlas-dashboards:3.9.0 distribution/docker
```

The image is laid out like the OpenSearch Dashboards image: the product is in
`/usr/share/opensearch-dashboards`, it runs as user `opensearch-dashboards` (uid and gid 1000),
listens on 5601, and its entrypoint is that image's, which turns environment variables such as
`OPENSEARCH_HOSTS` into settings. A deployment that mounts its own
`config/opensearch_dashboards.yml` or sets those variables keeps working when the image name is
swapped. No registry is set up yet: the build leaves the image on the machine that built it.

## Helm chart

```bash
helm install dashboards distribution/helm/atlas-dashboards \
  --set image.registry=registry.example.com/platform \
  --set opensearch.hosts[0]=https://opensearch:9200 \
  --set opensearch.credentialsSecret.name=dashboards-server-user
```

The chart follows the conventions of the Atlas platform chart: secrets are only referenced by
name, the pod runs as non-root with a read-only root filesystem, and `values.yaml` documents each
setting. A setting that looks like a secret in `config` fails the render.

## Checking a running instance

```bash
SMOKE_TEST_PASSWORD='<admin password>' node distribution/scripts/smoke_test.js --url http://localhost:5601
node distribution/scripts/smoke_test.js --no-security --core-only    # the source, via yarn start
```
