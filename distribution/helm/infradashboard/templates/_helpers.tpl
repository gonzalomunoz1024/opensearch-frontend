{{/* The release's name for the chart's objects, at most 63 characters. */}}
{{- define "infradashboard.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "infradashboard.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{ include "infradashboard.selector" . }}
{{- end -}}

{{- define "infradashboard.selector" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "infradashboard.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "infradashboard.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* The image reference; image.registry prefixes a bare repository name. */}}
{{- define "infradashboard.image" -}}
{{- $repo := .Values.image.repository -}}
{{- if and .Values.image.registry (not (contains "/" $repo)) -}}
{{- $repo = printf "%s/%s" (trimSuffix "/" .Values.image.registry) $repo -}}
{{- end -}}
{{- printf "%s:%s" $repo (toString (default .Chart.AppVersion .Values.image.tag)) -}}
{{- end -}}

{{/* opensearch_dashboards.yml: the chart's settings with .Values.config merged over them. A value that looks like a password, or a setting of the security plugin, fails the render. */}}
{{- define "infradashboard.config" -}}
{{- $os := .Values.opensearch -}}
{{- if not (has (toString $os.sslVerificationMode) (list "full" "certificate" "none")) -}}
{{- fail "opensearch.sslVerificationMode is full, certificate or none" -}}
{{- end -}}
{{- $settings := dict
      "server.host" "0.0.0.0"
      "server.port" 5601
      "opensearch.hosts" (required "opensearch.hosts lists the URLs of the OpenSearch cluster" $os.hosts)
      "opensearch.ssl.verificationMode" $os.sslVerificationMode
      "opensearchDashboards.branding.useExpandedHeader" false -}}
{{- if $os.caSecret.name -}}
{{- $_ := set $settings "opensearch.ssl.certificateAuthorities" (list "/etc/infradashboard/opensearch-ca/ca.crt") -}}
{{- end -}}
{{- range $key, $value := .Values.config -}}
{{- if hasPrefix "opensearch_security." $key -}}
{{- fail (printf "config.%s is a setting of the security plugin, which InfraDashboard does not ship: the server would stop at start. Remove it." $key) -}}
{{- end -}}
{{- if and (regexMatch "(?i)(password|secret|token|apikey|api_key)$" $key) (kindIs "string" $value) (not (regexMatch "^\\$\\{[A-Za-z_][A-Za-z0-9_]*\\}$" $value)) -}}
{{- fail (printf "config.%s holds a secret: write ${NAME} there and give NAME a value from a Secret in secrets.env" $key) -}}
{{- end -}}
{{- $_ := set $settings $key $value -}}
{{- end -}}
{{- toYaml $settings -}}
{{- end -}}
