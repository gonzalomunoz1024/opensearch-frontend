/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Which API a request of the console is for, found as OpenSearch Dashboards finds it: the paths
 * of the spec definitions its server answers (/api/console/api_server) are laid out as a tree for
 * each method, a request's path is walked through it part by part, and the endpoint it ends at
 * gives the page of the manual "Open documentation" opens (its UrlPatternMatcher and the walk of
 * its autocomplete engine). A request no endpoint is known for has no page, and nothing opens.
 */

export interface EndpointSpec {
  methods?: string[];
  patterns?: string[];
  documentation?: string;
  priority?: number;
  url_components?: Record<string, unknown>;
}

export interface ApiSpec {
  [api: string]: { endpoints?: Record<string, EndpointSpec> };
}

type Token = string | string[];

interface Node {
  /** What a part of a path has to be to go this way */
  accepts: (token: Token) => boolean;
  children: Map<string, Node>;
  /** The endpoints whose path ends here, in the order they were added */
  endpoints: EndpointSpec[];
}

const METHODS = ['HEAD', 'GET', 'PATCH', 'PUT', 'POST', 'DELETE'];
const NODES = ['_local', '_master', '_cluster_manager', 'data:true', 'data:false', 'master:true', 'cluster_manager:true', 'master:false', 'cluster_manager:false'];

const listOf = (token: Token) => (Array.isArray(token) ? token : [token]);
const isIndexName = (name: string) => name === '_all' || name[0] !== '_';
const anything = () => true;
const oneOf = (list: string[], multi: boolean) => (token: Token) => (multi || listOf(token).length <= 1) && listOf(token).every((each) => list.includes(each));

/** What a part written in braces accepts, by its name, as the original's components do */
function parameter(name: string, own: unknown): Node['accepts'] | undefined {
  if (Array.isArray(own)) return oneOf(own.map(String), true);
  if (own && typeof own === 'object') {
    const spec = own as { type?: string; list?: unknown[]; multiValued?: boolean; allow_non_valid?: boolean };
    if (spec.type === 'list') return spec.allow_non_valid ? anything : oneOf((spec.list ?? []).map(String), spec.multiValued !== false);
  }
  switch (name) {
    case 'index':
    case 'type':
      // A name that is not one of an index gets no way of its own
      return (token) => listOf(token).length <= 1 && listOf(token).every(isIndexName);
    case 'indices':
    case 'types':
    case 'username':
    case 'user':
      return (token) => listOf(token).every(isIndexName);
    case 'id':
    case 'ids':
    case 'transform_id':
    case 'task_id':
      return (token) => token !== '' && !Array.isArray(token) && !/[/,]/.test(token);
    case 'fields':
      return (token) => listOf(token).every((each) => !/[^\w.?*]/.test(each));
    case 'field':
      return (token) => listOf(token).length <= 1 && listOf(token).every((each) => !/[^\w.?*]/.test(each));
    case 'nodes':
      return oneOf(NODES, true);
    case 'node':
      return oneOf([], false);
    default:
      return anything;
  }
}

const node = (accepts: Node['accepts']): Node => ({ accepts, children: new Map(), endpoints: [] });

/** The tree of the paths of every endpoint, one for each method */
export function buildMatcher(api: ApiSpec): Record<string, Node> {
  const roots: Record<string, Node> = {};
  for (const method of METHODS) roots[method] = node(anything);
  for (const group of Object.values(api)) {
    for (const endpoint of Object.values(group.endpoints ?? {})) {
      for (const pattern of endpoint.patterns ?? []) {
        for (const method of endpoint.methods ?? []) {
          let active = roots[method];
          if (!active) continue;
          for (const part of pattern.split('/')) {
            const named = /^{.+}$/.test(part) ? part.slice(1, -1) : undefined;
            let next = active.children.get(named ?? part);
            if (!next) {
              next = node(named === undefined ? (token) => token === part : parameter(named, endpoint.url_components?.[named]) ?? anything);
              active.children.set(named ?? part, next);
            }
            active = next;
          }
          active.endpoints.push(endpoint);
        }
      }
    }
  }
  return roots;
}

/** The parts of a request's path: without what follows "?", a part with commas as its list */
export function pathTokens(url: string): Token[] {
  return url
    .split('?')[0]
    .split('/')
    .filter((part) => part !== '')
    .map((part) => (part.includes(',') ? part.split(',').filter((each) => each !== '') : part));
}

/** The endpoint a request is for: the first its path ends at, the one with the lowest priority number before the others */
export function endpointFor(matcher: Record<string, Node>, method: string, url: string): EndpointSpec | undefined {
  const root = matcher[method.toUpperCase()];
  if (!root) return undefined;
  let states = [root];
  for (const token of pathTokens(url)) {
    const next: Node[] = [];
    for (const state of states) for (const child of state.children.values()) if (child.accepts(token)) next.push(child);
    if (!next.length) return undefined;
    states = next;
  }
  const found = states.flatMap((state) => state.endpoints);
  let best: EndpointSpec | undefined;
  for (const endpoint of found) {
    const priority = typeof endpoint.priority === 'number' ? endpoint.priority : Number.MAX_VALUE;
    const bestPriority = typeof best?.priority === 'number' ? best.priority : Number.MAX_VALUE;
    if (!best || priority < bestPriority) best = endpoint;
  }
  return best;
}

/** The page of the manual for a request, when its endpoint names one */
export function documentationFor(matcher: Record<string, Node>, method: string, url: string): string | undefined {
  const documentation = endpointFor(matcher, method, url)?.documentation;
  return documentation && documentation.includes('http') ? documentation : undefined;
}
