/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The expressions of a spec that OpenSearch Dashboards refuses to draw: those that reach the
 * page, its document or the prototype of an object, or call a function that runs text as code.
 * The lists, the places looked at and the reasons are the original's.
 */

import type { ExpressionNode } from './interpreter';

export interface ValidationResult {
  expression: string;
  reason: string;
  location: string;
}

const BLOCKED_PROPERTIES = new Set([
  // from an element to the window
  'ownerDocument',
  'defaultView',
  'contentDocument',
  'contentWindow',
  'view',
  // changing the page
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'createElement',
  'createElementNS',
  'getElementById',
  'getElementsByClassName',
  'getElementsByTagName',
  'querySelector',
  'querySelectorAll',
  // prototypes
  '__proto__',
  'prototype',
  'constructor',
]);

const BLOCKED_IDENTIFIERS = new Set(['window', 'document', 'global', 'globalThis', 'top', 'parent', 'frames', 'self', 'constructor']);

const BLOCKED_FUNCTIONS = new Set(['eval', 'Function', 'setTimeout', 'setInterval', 'setImmediate', 'execScript', 'atob', 'btoa']);

// The fields of a spec that hold expressions
const EXPRESSION_FIELDS = ['expr', 'update', 'test', 'calculate', 'filter', 'signal'];

function propertyName(node: ExpressionNode): string | null {
  if (!node.property) return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name || null;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') {
    return node.property.value;
  }
  return null;
}

function walk(node: ExpressionNode | null | undefined, visitor: (n: ExpressionNode) => void): void {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  switch (node.type) {
    case 'MemberExpression':
      walk(node.object, visitor);
      if (node.computed) walk(node.property, visitor);
      break;
    case 'CallExpression':
      walk(node.callee, visitor);
      node.arguments?.forEach((arg) => walk(arg, visitor));
      break;
    case 'ArrayExpression':
      node.elements?.forEach((element) => walk(element, visitor));
      break;
    case 'ObjectExpression':
      node.properties?.forEach((property) => walk(property, visitor));
      break;
    case 'Property':
      if (node.computed) walk(node.key, visitor);
      walk(node.value as ExpressionNode | undefined, visitor);
      break;
    case 'BinaryExpression':
    case 'LogicalExpression':
      walk(node.left, visitor);
      walk(node.right, visitor);
      break;
    case 'UnaryExpression':
      walk(node.argument, visitor);
      break;
    case 'ConditionalExpression':
      walk(node.test, visitor);
      walk(node.consequent, visitor);
      walk(node.alternate, visitor);
      break;
    default:
      break;
  }
}

function checkExpression(parse: (expression: string) => ExpressionNode, expression: string, location: string): ValidationResult[] {
  const results: ValidationResult[] = [];
  let ast: ExpressionNode;
  try {
    ast = parse(expression);
  } catch {
    // Vega refuses it when it draws
    return results;
  }
  walk(ast, (node) => {
    if (node.type === 'MemberExpression') {
      const name = propertyName(node);
      if (name && BLOCKED_PROPERTIES.has(name)) {
        results.push({ expression, reason: `Blocked property access: "${name}"`, location });
      }
      // a member named by what an expression works out
      if (node.computed && name === null) {
        const property = node.property;
        if (property && property.type !== 'Literal' && property.type !== 'Identifier') {
          results.push({ expression, reason: 'Blocked dynamic computed property access', location });
        }
      }
    }
    if (node.type === 'Identifier' && node.name && BLOCKED_IDENTIFIERS.has(node.name)) {
      results.push({ expression, reason: `Blocked identifier: "${node.name}"`, location });
    }
    if (node.type === 'CallExpression' && node.callee) {
      let callee: string | null = null;
      if (node.callee.type === 'Identifier') callee = node.callee.name || null;
      if (node.callee.type === 'MemberExpression') callee = propertyName(node.callee);
      if (callee && BLOCKED_FUNCTIONS.has(callee)) {
        results.push({ expression, reason: `Blocked function call: "${callee}"`, location });
      }
    }
  });
  return results;
}

/** Every refused expression of a spec, with where it is */
export function validateVegaExpression(spec: unknown, parse: (expression: string) => ExpressionNode): ValidationResult[] {
  const results: ValidationResult[] = [];
  const traverse = (value: unknown, path = '') => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => traverse(item, `${path}[${index}]`));
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      const at = path ? `${path}.${key}` : key;
      if (EXPRESSION_FIELDS.includes(key) && typeof item === 'string') results.push(...checkExpression(parse, item, at));
      traverse(item, at);
    }
  };
  traverse(spec);
  return results;
}
