/* SPDX-License-Identifier: Apache-2.0 */

/* The tools of Dev Tools, and which of them an address shows. */

const TOOLS = [
  { id: 'console', title: 'Console' },
  { id: 'grok_debugger', title: 'Grok Debugger' },
] as const;

type ToolId = (typeof TOOLS)[number]['id'];

/** The tools Dev Tools has: without the console when console.enabled is false, as the original leaves it out */
export function devTools(consoleEnabled: boolean): Array<{ id: ToolId; title: string }> {
  return TOOLS.filter((tool) => consoleEnabled || tool.id !== 'console');
}

/** The tool an address shows, and whether the address is to be put right: the first tool unless the address names another */
export function toolOf(hashPath: string, tools: Array<{ id: ToolId }>): { tab: ToolId; redirect: boolean } {
  const named = tools.find((tool) => hashPath === `/${tool.id}` || hashPath.startsWith(`/${tool.id}/`) || hashPath.startsWith(`/${tool.id}?`));
  return { tab: named?.id ?? tools[0].id, redirect: !named };
}
