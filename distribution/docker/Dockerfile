# SPDX-License-Identifier: Apache-2.0
#
# The Atlas Dashboards image, made from the tarball `distribution/scripts/build.sh assemble`
# leaves in target/. It keeps the layout of the OpenSearch Dashboards image (home directory, user,
# entrypoint, port) so it can stand in for that image in an existing deployment.
#
#   docker build -f distribution/docker/Dockerfile \
#     --build-context dist=target --build-arg VERSION=3.9.0 \
#     -t atlas-dashboards:3.9.0 distribution/docker

FROM debian:bookworm-slim AS unpack
ARG VERSION
ARG TARGETARCH
RUN --mount=type=bind,from=dist,target=/dist \
    case "${TARGETARCH}" in amd64) arch=x64 ;; arm64) arch=arm64 ;; *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; esac && \
    mkdir -p /usr/share/opensearch-dashboards && \
    tar -xzf "/dist/atlas-dashboards-${VERSION}-linux-${arch}.tar.gz" -C /usr/share/opensearch-dashboards --strip-components=1 && \
    echo "server.host: '0.0.0.0'" >> /usr/share/opensearch-dashboards/config/opensearch_dashboards.yml

FROM debian:bookworm-slim
ARG VERSION
ARG UID=1000
ARG GID=1000
ENV OPENSEARCH_DASHBOARDS_HOME=/usr/share/opensearch-dashboards

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -g "${GID}" opensearch-dashboards && \
    useradd -u "${UID}" -g "${GID}" -d "${OPENSEARCH_DASHBOARDS_HOME}" opensearch-dashboards

COPY --from=unpack --chown=${UID}:${GID} /usr/share/opensearch-dashboards ${OPENSEARCH_DASHBOARDS_HOME}
COPY --chown=${UID}:${GID} --chmod=0755 entrypoint.sh ${OPENSEARCH_DASHBOARDS_HOME}/opensearch-dashboards-docker-entrypoint.sh

WORKDIR ${OPENSEARCH_DASHBOARDS_HOME}
ENV PATH=$PATH:${OPENSEARCH_DASHBOARDS_HOME}/bin
USER ${UID}
EXPOSE 5601

LABEL org.opencontainers.image.title="Atlas Dashboards" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.description="Atlas Dashboards: a distribution of OpenSearch Dashboards ${VERSION} and its bundled plugins"

ENTRYPOINT ["./opensearch-dashboards-docker-entrypoint.sh"]
CMD ["opensearch-dashboards"]
