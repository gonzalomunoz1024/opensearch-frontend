# SPDX-License-Identifier: Apache-2.0
#
# The standalone InfraDashboard as an image. The build needs two things from outside: a Node.js 22
# image, and the npm packages of package-lock.json (96, ten of them named in package.json) from
# whichever registry npm is pointed at. Nothing is compiled from native code and nothing else is
# downloaded.
#
#   docker build -t infradashboard:3.9.0 .
#
#   --build-arg NODE_IMAGE=<registry>/<node 22 image>    the base image to build and run on
#   --build-arg NPM_CONFIG_REGISTRY=<url>                the npm registry, when it is not the default
#
# A registry that wants credentials: put an .npmrc beside package.json before the build. It is
# used by the first stage only and is not in the image. Nothing here needs BuildKit, so the file
# builds the same with docker, buildah and kaniko.
#
# The image keeps the layout of the OpenSearch Dashboards image (home directory, settings file,
# user 1000, port 5601), so the Helm chart in helm/infradashboard runs it as it is.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
ARG NPM_CONFIG_REGISTRY
WORKDIR /build
COPY package.json package-lock.json .npmrc* ./
RUN npm ci --no-audit --no-fund
COPY . .
# The tests run as part of the build: an image is only made from code that passes them
RUN npm run typecheck && npm test && node scripts/build.mjs

FROM ${NODE_IMAGE}
ARG VERSION=3.9.0
ENV NODE_ENV=production \
    OPENSEARCH_DASHBOARDS_HOME=/usr/share/opensearch-dashboards \
    INFRADASHBOARD_CONFIG=/usr/share/opensearch-dashboards/config/opensearch_dashboards.yml
WORKDIR ${OPENSEARCH_DASHBOARDS_HOME}
# Every file can be read by any user and none is written at run time, so the image runs under
# whichever uid a cluster gives it (OpenShift's restricted policy) and on a read-only file system.
COPY --from=build /build/config/opensearch_dashboards.yml config/opensearch_dashboards.yml
COPY --from=build /build/dist dist
USER 1000
EXPOSE 5601

LABEL org.opencontainers.image.title="InfraDashboard" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.description="InfraDashboard: a dashboard for OpenSearch that keeps the saved objects and addresses of OpenSearch Dashboards ${VERSION}"

CMD ["node", "dist/server/main.js"]
