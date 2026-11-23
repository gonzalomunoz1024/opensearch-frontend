/* SPDX-License-Identifier: Apache-2.0 */

// A small bundler for the browser side: it follows the imports from one entry file, turns each
// TypeScript module into CommonJS with the TypeScript compiler, and writes them into one script
// with a registry of modules. Style sheets a module imports are collected, in import order, into
// one style sheet.
//
// It exists so that the build needs no bundler from the package registry: the fewer packages the
// build installs, the fewer it can fail to find. It does what this product needs and no more:
// static `import` and `require` with a literal path, no code splitting, no minifying (the server
// sends the script compressed).

import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js'];

export const transpileOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
  isolatedModules: true,
};

export function transpile(source, fileName) {
  const result = ts.transpileModule(source, {
    compilerOptions: transpileOptions,
    fileName,
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (errors.length) {
    const text = errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n');
    throw new Error(`${fileName}: ${text}`);
  }
  return result.outputText;
}

function resolveFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const extension of SOURCE_EXTENSIONS) {
    if (existsSync(base + extension)) return base + extension;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    const index = join(base, `index${extension}`);
    if (existsSync(index)) return index;
  }
  return undefined;
}

/**
 * @param {object} options
 * @param {string} options.entry the entry module
 * @param {string} options.root the directory module names in the output are relative to
 * @param {Record<string, string>} [options.alias] package name to the file that stands for it
 * @param {Record<string, string>} [options.define] expressions replaced in packages' own code
 * @returns {{ script: string, styles: string, modules: string[] }}
 */
export function bundle({ entry, root, alias = {}, define = {} }) {
  const requireFromRoot = createRequire(join(root, 'package.json'));
  const ids = new Map();
  const modules = [];
  const styles = [];
  const seenStyles = new Set();

  const resolveRequest = (request, from) => {
    if (request.startsWith('.')) {
      const file = resolveFile(resolve(dirname(from), request));
      if (!file) throw new Error(`${relative(root, from)}: cannot find "${request}"`);
      return file;
    }
    if (request.startsWith('node:')) {
      throw new Error(`${relative(root, from)}: "${request}" does not exist in a browser`);
    }
    // An alias names a file inside a package, which the package's own list of entry points may
    // not offer; it is taken from node_modules as a path
    if (alias[request]) {
      const file = join(root, 'node_modules', alias[request]);
      if (!existsSync(file)) throw new Error(`the alias for "${request}" names no file: ${file}`);
      return file;
    }
    try {
      return requireFromRoot.resolve(request);
    } catch {
      throw new Error(`${relative(root, from)}: cannot find the package "${request}"`);
    }
  };

  const add = (file) => {
    if (ids.has(file)) return ids.get(file);
    const id = modules.length;
    ids.set(file, id);
    modules.push(undefined);

    let code = readFileSync(file, 'utf8');
    const ownCode = !file.includes(`${join('node_modules', '')}`);
    if (extname(file) === '.json') {
      code = `module.exports = ${code};`;
    } else if (ownCode) {
      code = transpile(code, file);
    } else {
      for (const [expression, value] of Object.entries(define)) {
        code = code.split(expression).join(value);
      }
    }

    code = code.replace(/\brequire\(\s*(["'])([^"']+)\1\s*\)/g, (match, _quote, request, offset) => {
      // A require in a package's comment is none: markdown-it's documentation shows some
      // (" * var hljs = require('highlight.js')"), on lines a block or line comment starts
      if (!ownCode && /^\s*(\*|\/\/)/.test(code.slice(code.lastIndexOf('\n', offset) + 1, offset))) {
        return match;
      }
      if (request.endsWith('.css')) {
        const sheet = resolveRequest(request, file);
        if (!seenStyles.has(sheet)) {
          seenStyles.add(sheet);
          styles.push(`/* ${relative(root, sheet)} */\n${readFileSync(sheet, 'utf8').trim()}\n`);
        }
        return 'undefined';
      }
      return `__require(${add(resolveRequest(request, file))})`;
    });

    modules[id] = { name: relative(root, file), code };
    return id;
  };

  const entryId = add(resolve(entry));
  const parts = modules.map(
    ({ name, code }, id) =>
      `/* ${name} */\n${id}: function (module, exports, __require) {\n${code}\n},\n`
  );
  const script = `(function () {
var __modules = {
${parts.join('')}};
var __loaded = {};
function __require(id) {
  var module = __loaded[id];
  if (module) return module.exports;
  module = __loaded[id] = { exports: {} };
  __modules[id].call(module.exports, module, module.exports, __require);
  return module.exports;
}
__require(${entryId});
})();
`;
  return { script, styles: styles.join('\n'), modules: modules.map(({ name }) => name) };
}
