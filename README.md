# InfraDashboard

InfraDashboard is a distribution of
[OpenSearch Dashboards](https://github.com/opensearch-project/OpenSearch-Dashboards) 3.9.0 with
the Atlas design applied to its interface. The server, the plugins and the saved objects are the
ones of OpenSearch Dashboards 3.9.0, so it stands in front of an OpenSearch 3.9.0 cluster the same
way: nothing changes in the cluster, people sign in as they do today, and the dashboards they have
saved open as they are.

The name, the colours and the logo come from one file,
[`distribution/branding/brand.json`](distribution/branding/brand.json).

## What is in this repository

- **The OpenSearch Dashboards source**, forked at the `3.9.0` tag with its history. The fork
  changes as few of those files as it can; [`distribution/UPSTREAM.md`](distribution/UPSTREAM.md)
  lists each one and says how to take a new upstream release.
- **[`distribution/`](distribution/README.md)**, which holds everything that makes this a product
  of its own: the name and logo, the list of the 16 plugins that ship with it, the build, the
  container image and the Helm chart.
- **[`packages/osd-atlas-theme/`](packages/osd-atlas-theme/README.md)**, the Atlas theme: one
  stylesheet for light and one for dark that give every component of the interface the Atlas
  look. It is the default theme; the themes of OpenSearch Dashboards are still there, under
  Advanced settings.

## Run it from source

You need Node.js 22 (see `.nvmrc`), Yarn 1.22 and Docker.

```bash
yarn osd bootstrap

# an OpenSearch 3.9.0 for development, without the security plugin
docker compose -f distribution/docker/dev/docker-compose.yml up -d

yarn start --config distribution/config/dev.yml
```

Then open <http://localhost:5601>. The first start compiles the interface and takes a while.

## Build what ships

```bash
distribution/scripts/build.sh all
```

builds the platform, each plugin at the commit pinned in
[`distribution/plugins.json`](distribution/plugins.json), and puts them together as
`target/infradashboard-3.9.0-linux-x64.tar.gz`. The
[Distribution workflow](.github/workflows/distribution.yml) runs the same script, with the plugins
in parallel, and keeps the tarball as an artifact of the run.

To try the result with a secured OpenSearch 3.9.0:

```bash
export OPENSEARCH_INITIAL_ADMIN_PASSWORD='<a strong password>'
docker compose -f distribution/docker/docker-compose.yml up --build
node distribution/scripts/smoke_test.js      # or open http://localhost:5601 and sign in as admin
```

## Deploy

The image keeps the layout of the OpenSearch Dashboards image (home directory, user, port,
entrypoint and environment variables), so it replaces that image in a deployment that already
runs it. For Kubernetes there is a chart in
[`distribution/helm/infradashboard`](distribution/helm/infradashboard).

## Tests

The upstream test suites run on every pull request
([Build and test](.github/workflows/build_and_test_workflow.yml),
[Cypress](.github/workflows/cypress_workflow.yml)): they are how we know a change to the look has
not changed what the product does. The few expectations the fork had to regenerate, because they
record the product's name or list the themes, are in
[`distribution/UPSTREAM.md`](distribution/UPSTREAM.md). [TESTING.md](TESTING.md) and
[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) are upstream's and still apply.

## License

Apache License 2.0, as upstream: see [LICENSE.txt](LICENSE.txt) and [NOTICE.txt](NOTICE.txt).
OpenSearch is a trademark of its owner; this distribution is not affiliated with or endorsed by
the OpenSearch project.
