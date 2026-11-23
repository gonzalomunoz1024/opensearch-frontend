/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The pages of Visualize an address names, as OpenSearch Dashboards 3.9.0's routes take them
 * (`app.tsx`): the editor of a saved visualization, the editor of a new one, the list with the
 * dialog of a new one open (the wizard's first step), or the list.
 */

export type VisualizeRoute = { page: 'edit'; id: string } | { page: 'create' | 'new' | 'listing' };

export function visualizeRoute(hashPath: string): VisualizeRoute {
  const edit = /^\/edit\/(.+)$/.exec(hashPath);
  if (edit) return { page: 'edit', id: edit[1] };
  // Without a kind too: the editor then fails to load, as the original's, and warns on its way to
  // the landing page
  if (hashPath === '/create') return { page: 'create' };
  if (hashPath === '/new') return { page: 'new' };
  return { page: 'listing' };
}
