/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The settings OpenSearch Dashboards 3.9.0 knows that this server does not read, and what becomes
 * of each. The original stops at start on a setting it does not know, and so does this server,
 * with the original's words: for the namespaces of the original's core, whose every key is listed
 * here, and for a namespace the original does not have either. A namespace of one of the
 * original's plugins is taken whole: its keys are reported as not read, not checked one by one.
 *
 * A setting of the original this server leaves out is reported once at start, unless leaving it
 * out would make the server let through more than the file asks, or listen elsewhere, or keep
 * the saved objects elsewhere: then the server does not start, and says why.
 *
 * Sources: src/core/server/** (http_config.ts, ssl_config.ts, opensearch_config.ts,
 * saved_objects_config.ts, ui_settings_config.ts, opensearch_dashboards_config.ts and the other
 * `config.ts` of the core), src/legacy/server/config/schema.js, which still checks `server.*` and
 * `logging.*`, the deprecations of src/core/server/config/deprecation/core_deprecations.ts and of
 * each schema, and the `configPath` of each plugin of the fork and of the plugins it installs.
 */

/**
 * The namespaces of the original's core, and how the original words a key it does not know in
 * each: `server` and `logging` are still checked by the schema of the old platform (Joi),
 * the others by that of the new one (`@osd/config-schema`)
 */
export const CORE_NAMESPACES: Record<string, 'legacy' | 'platform'> = {
  server: 'legacy',
  logging: 'legacy',
  opensearch: 'platform',
  opensearchDashboards: 'platform',
  savedObjects: 'platform',
  migrations: 'platform',
  uiSettings: 'platform',
  status: 'platform',
  ops: 'platform',
  pid: 'platform',
  path: 'platform',
  dev: 'platform',
  plugins: 'platform',
  i18n: 'platform',
  dynamic_config_service: 'platform',
};

/** Sub-objects of `server` that the new platform checks, with its words */
export const PLATFORM_CHECKED_IN_SERVER = ['server.ssl', 'server.compression', 'server.xsrf'];

/**
 * Keys of the core namespaces this server accepts without reading them. `x.*` is any key under
 * `x`. Each is reported at start as a setting that is not read.
 */
export const CORE_KEYS_NOT_READ = [
  'server.uuid',
  'server.ssl.keystore.password',
  'server.ssl.truststore.password',
  'opensearch.ssl.keystore.password',
  'opensearch.ssl.truststore.password',
  'logging.appenders.*',
  'logging.loggers',
  'logging.loggers.*',
  'logging.root.*',
  'logging.events.*',
  'logging.dest',
  'logging.ignoreEnospcError',
  'logging.filter.*',
  'logging.json',
  'logging.timezone',
  'logging.rotate.enabled',
  'logging.rotate.everyBytes',
  'logging.rotate.keepFiles',
  'logging.rotate.pollingInterval',
  'logging.rotate.usePolling',
  'opensearch.sniffOnStart',
  'opensearch.sniffInterval',
  'opensearch.sniffOnConnectionFault',
  'opensearch.logQueries',
  'opensearch.optimizedHealthcheck.id',
  'opensearch.optimizedHealthcheck.filters.*',
  'opensearch.apiVersion',
  'opensearch.healthCheck.delay',
  'opensearch.ignoreVersionMismatch',
  'opensearch.disablePrototypePoisoningProtection',
  'opensearch.requestCompression',
  'opensearchDashboards.enabled',
  'opensearchDashboards.configIndex',
  'opensearchDashboards.autocompleteTerminateAfter',
  'opensearchDashboards.autocompleteTimeout',
  'opensearchDashboards.branding.logo.defaultUrl',
  'opensearchDashboards.branding.logo.darkModeUrl',
  'opensearchDashboards.branding.mark.defaultUrl',
  'opensearchDashboards.branding.mark.darkModeUrl',
  'opensearchDashboards.branding.loadingLogo.defaultUrl',
  'opensearchDashboards.branding.loadingLogo.darkModeUrl',
  'opensearchDashboards.branding.faviconUrl',
  'opensearchDashboards.branding.applicationTitle',
  'opensearchDashboards.branding.useExpandedHeader',
  'opensearchDashboards.survey.url',
  'opensearchDashboards.dashboardAdmin.groups',
  'opensearchDashboards.dashboardAdmin.users',
  'opensearchDashboards.futureNavigation',
  'opensearchDashboards.enableIconSideNav',
  'opensearchDashboards.keyboardShortcuts.enabled',
  'savedObjects.permission.enabled',
  'savedObjects.storage.backend',
  'savedObjects.storage.sqlite.path',
  'migrations.batchSize',
  'migrations.scrollDuration',
  'migrations.pollInterval',
  'migrations.skip',
  'migrations.delete.enabled',
  'migrations.delete.types',
  'uiSettings.globalScopeEditable.enabled',
  'status.allowAnonymous',
  'ops.interval',
  'ops.cGroupOverrides.cpuPath',
  'ops.cGroupOverrides.cpuAcctPath',
  'pid.file',
  'pid.exclusive',
  'path.data',
  'dev.basePathProxyTarget',
  'plugins.initialize',
  'plugins.paths',
  'plugins.scanDirs',
  'i18n.locale',
  'dynamic_config_service.enabled',
  'dynamic_config_service.skipMigrations',
  // Namespaces of the old platform's schema that nothing checks key by key
  'elastic.apm.*',
  'pkg.version',
  'pkg.branch',
  'pkg.buildNum',
  'pkg.buildSha',
  'env',
  'env.name',
  'stats.*',
];

/** A setting of the original this server cannot honour, and the values for which that matters */
export interface Refused {
  key: string;
  /** Whether a value of the file asks for what this server does not do */
  refuses(value: unknown): boolean;
  /** Why the server does not start, and what to write instead */
  reason: string;
}

const isSet = (value: unknown) => value !== undefined && value !== null && value !== '';

export const REFUSED: Refused[] = [
  {
    key: 'server.autoListen',
    refuses: (value) => value === false || value === 'false',
    reason: 'InfraDashboard always listens on server.host and server.port',
  },
  {
    key: 'server.cors',
    refuses: (value) => value === true || value === 'true',
    reason: 'InfraDashboard answers no request of another origin (CORS)',
  },
  ...['server.ssl', 'opensearch.ssl'].flatMap((prefix): Refused[] => [
    {
      key: `${prefix}.keystore.path`,
      refuses: isSet,
      reason: `InfraDashboard reads no PKCS#12 keystore: give the certificate and its key as PEM files, with ${prefix}.certificate and ${prefix}.key`,
    },
    {
      key: `${prefix}.truststore.path`,
      refuses: isSet,
      reason: `InfraDashboard reads no PKCS#12 truststore: give the certificate authorities as PEM files, with ${prefix}.certificateAuthorities`,
    },
  ]),
  {
    key: 'savedObjects.permission.enabled',
    refuses: (value) => value === true || value === 'true',
    reason: 'InfraDashboard has no permissions on saved objects; leave the setting off',
  },
  {
    key: 'savedObjects.storage.backend',
    refuses: (value) => isSet(value) && value !== 'opensearch',
    reason: `InfraDashboard keeps the saved objects in OpenSearch only`,
  },
  {
    key: 'uiSettings.globalScopeEditable.enabled',
    refuses: (value) => value === false || value === 'false',
    reason: 'InfraDashboard cannot keep the advanced settings from being changed',
  },
  {
    key: 'console.enabled',
    refuses: (value) => value === false || value === 'false',
    reason:
      'InfraDashboard cannot turn Dev Tools off: its pages reach OpenSearch through a proxy of the server as the console does',
  },
];

/**
 * The namespaces of the plugins of the original: those the fork builds in (src/plugins) and the
 * two it installs. Their keys are accepted and reported as not read, except those this server
 * reads (map.*, vis_type_vega.*, home.*) and those of REFUSED.
 */
export const PLUGIN_NAMESPACES = [
  'advanced_settings',
  'agentTraces',
  'apm_oss',
  'application_config',
  'backend_compatibility',
  'banner',
  'bfetch',
  'charts',
  'chat',
  'console',
  'content_management',
  'contextProvider',
  'csp_handler',
  'dashboard',
  'data',
  'data_explorer',
  'data_importer',
  'data_source',
  'data_source_management',
  'datasetManagement',
  'dev_tools',
  'discover',
  'embeddable',
  'explore',
  'expressions',
  'grok_debugger',
  'home',
  'index_pattern_management',
  'input_control_vis',
  'inspector',
  'legacy_export',
  'management',
  'management_overview',
  'map',
  'navigation',
  'opensearch_dashboards_legacy',
  'opensearch_dashboards_overview',
  'opensearch_dashboards_react',
  'opensearch_dashboards_usage_collection',
  'opensearch_dashboards_utils',
  'opensearch_ui_shared',
  'queryEnhancements',
  'saved_objects',
  'saved_objects_management',
  'share',
  'ui_actions',
  'url_forwarding',
  'usageCollection',
  'vis_augmenter',
  'vis_builder',
  'vis_default_editor',
  'vis_type_markdown',
  'vis_type_metric',
  'vis_type_table',
  'vis_type_tagcloud',
  'vis_type_timeline',
  'vis_type_timeseries',
  'vis_type_vega',
  'vis_type_vislib',
  'vis_type_xy',
  'visualizations',
  'visualize',
  'workspace',
  // The plugins the fork installs (distribution/plugins.json)
  'opensearch_index_management',
  'query_workbench_dashboards',
  // Namespaces of the content security policy, which are not `csp.*`
  'csp-report-only',
  'csp-modifications',
];

/**
 * Settings the original renames: [old, new]. The value moves to the new name, with the original's
 * warning; when both are given the old one is dropped. `elasticsearch.ssl` moves all under it.
 */
export const RENAMED: Array<[string, string]> = [
  ...[
    'sniffOnStart',
    'sniffInterval',
    'sniffOnConnectionFault',
    'hosts',
    'username',
    'password',
    'requestHeadersWhitelist',
    'customHeaders',
    'shardTimeout',
    'requestTimeout',
    'pingTimeout',
    'logQueries',
    'ssl',
    'apiVersion',
    'healthCheck',
    'ignoreVersionMismatch',
  ].map((name): [string, string] => [`elasticsearch.${name}`, `opensearch.${name}`]),
  ['elasticsearch.optimizedHealthcheckId', 'opensearch.optimizedHealthcheck.id'],
  ['opensearch.optimizedHealthcheckId', 'opensearch.optimizedHealthcheck.id'],
  ['kibana.enabled', 'opensearchDashboards.enabled'],
  ['kibana.index', 'opensearchDashboards.index'],
  ['kibana.autocompleteTerminateAfter', 'opensearchDashboards.autocompleteTerminateAfter'],
  ['kibana.autocompleteTimeout', 'opensearchDashboards.autocompleteTimeout'],
  ['cpu.cgroup.path.override', 'ops.cGroupOverrides.cpuPath'],
  ['cpuacct.cgroup.path.override', 'ops.cGroupOverrides.cpuAcctPath'],
  ['server.defaultRoute', 'uiSettings.overrides.defaultRoute'],
];

/**
 * Settings the original keeps under their old name: [old, new]. The new name is read as the old
 * one; the old one is read, with a warning that it has a new name.
 */
export const RENAMED_BACK: Array<[string, string]> = [
  ['server.xsrf.whitelist', 'server.xsrf.allowlist'],
  ['server.compression.referrerWhitelist', 'server.compression.referrerAllowlist'],
  ['opensearch.requestHeadersWhitelist', 'opensearch.requestHeadersAllowlist'],
];

/** Settings the original no longer uses: dropped, with its warning */
export const NO_LONGER_USED = [
  'savedObjects.indexCheckTimeout',
  'server.xsrf.token',
  'maps.manifestServiceUrl',
  'optimize.lazy',
  'optimize.lazyPort',
  'optimize.lazyHost',
  'optimize.lazyPrebuild',
  'optimize.lazyProxyTimeout',
  'optimize.enabled',
  'optimize.bundleFilter',
  'optimize.bundleDir',
  'optimize.viewCaching',
  'optimize.watch',
  'optimize.watchPort',
  'optimize.watchHost',
  'optimize.watchPrebuild',
  'optimize.watchProxyTimeout',
  'optimize.useBundleCache',
  'optimize.sourceMaps',
  'optimize.workers',
  'optimize.profile',
  'optimize.validateSyntaxOfNodeModules',
  'opensearch.preserveHost',
  'opensearch.startupTimeout',
  'uiSettings.enabled',
];

/** Whether a dotted key is a key of the list, or under one of its `x.*` entries */
export function listed(list: readonly string[], key: string): boolean {
  return list.some((entry) =>
    entry.endsWith('.*') ? key.startsWith(entry.slice(0, -1)) || key === entry.slice(0, -2) : entry === key
  );
}

/** The plugin namespace a key belongs to, if any */
export function pluginNamespaceOf(key: string): string | undefined {
  return PLUGIN_NAMESPACES.find((name) => key === name || key.startsWith(`${name}.`));
}
