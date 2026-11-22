/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Builds the Atlas theme into target/, for light and for dark:
 *
 *   atlas_theme_<mode>.css    what styles OUI's components, in place of OUI's eui_theme_v9_<mode>.css
 *   atlas_theme_<mode>.json   the theme's variables, in place of OUI's eui_theme_v9_<mode>.json
 *
 * Both come out of one Sass compilation per mode, so the variables in the JSON are the ones the
 * stylesheet was compiled with.
 */

const fs = require('fs');
const path = require('path');
const sass = require('sass-embedded');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const TARGET = path.join(ROOT, 'target');
const OUI = path.dirname(require.resolve('@elastic/eui/package.json'));
const NODE_MODULES = path.resolve(OUI, '..', '..');

const MODES = ['light', 'dark'];
const TOKENS_SELECTOR = '.atlasThemeTokens';

/*
 * The JSON has the keys and the shape of OUI's own for the same mode (dark defines a few
 * variables light does not), because that is what the code reading it was written against. Each
 * leaf of OUI's JSON becomes one custom property in a throwaway rule at the end of the
 * stylesheet, where Sass writes the value the Atlas theme gives that variable.
 */
const leavesOf = (mode) => {
  const reference = JSON.parse(
    fs.readFileSync(path.join(OUI, 'dist', `eui_theme_v9_${mode}.json`), 'utf8')
  );

  const leaves = [];
  const collect = (value, keys, expression) => {
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        collect(child, [...keys, key], `map-get(${expression}, '${key}')`);
      }
    } else {
      leaves.push({ keys, expression });
    }
  };
  for (const [name, value] of Object.entries(reference)) collect(value, [name], `$${name}`);
  return leaves;
};

const tokensRule = (leaves) => {
  const declarations = leaves.map(
    ({ keys, expression }, index) =>
      `@if variable-exists('${keys[0]}') { --t${index}: #{inspect(${expression})}; }`
  );
  return `${TOKENS_SELECTOR} {\n${declarations.join('\n')}\n}\n`;
};

const toHex = (channel) => Math.round(Number(channel)).toString(16).padStart(2, '0');

/*
 * Sass writes a computed colour with fractional channels, rgb(4.1, 108.7, 223). The colour
 * libraries that read the JSON only take whole numbers, so opaque colours become hex and
 * translucent ones get whole channels.
 */
const normalizeColors = (value) =>
  value
    .replace(
      /rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g,
      (match, r, g, b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`
    )
    .replace(
      /rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g,
      (match, r, g, b, a) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`
    );

const readTokens = (rule, leaves) => {
  const written = new Map();
  for (const line of rule.split('\n')) {
    const at = line.indexOf(': ');
    const name = line.slice(0, at).trim();
    if (at > 0 && name.startsWith('--t')) {
      written.set(
        Number(name.slice(3)),
        line
          .slice(at + 2)
          .trim()
          .replace(/;$/, '')
      );
    }
  }

  const tokens = {};
  const missing = [];
  leaves.forEach(({ keys }, index) => {
    if (!written.has(index)) {
      missing.push(keys.join('.'));
      return;
    }
    const raw = written.get(index);
    const text = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    const value = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : normalizeColors(text);
    let at = tokens;
    for (const key of keys.slice(0, -1)) {
      at[key] = at[key] || {};
      at = at[key];
    }
    at[keys[keys.length - 1]] = value;
  });
  return { tokens, missing };
};

/*
 * OUI's source names its classes .oui*, and its build also publishes every stylesheet with the
 * .eui* names the components still render. This is the same substitution OUI's build makes.
 */
const toEuiNames = (css) => css.replace(/([. '"-])oui/g, '$1eui');

const build = async (mode) => {
  const started = Date.now();
  const leaves = leavesOf(mode);
  const source = `@import 'theme_${mode}';\n${tokensRule(leaves)}`;
  const { css } = await sass.compileStringAsync(source, {
    loadPaths: [SRC, NODE_MODULES],
    quietDeps: true,
    logger: sass.Logger.silent,
    silenceDeprecations: [
      'import',
      'global-builtin',
      'color-functions',
      'slash-div',
      'mixed-decls',
    ],
  });

  const tokensAt = css.lastIndexOf(`${TOKENS_SELECTOR} {`);
  if (tokensAt < 0) throw new Error(`The ${mode} stylesheet has no ${TOKENS_SELECTOR} rule`);
  const { tokens, missing } = readTokens(css.slice(tokensAt), leaves);
  if (missing.length > 0) {
    throw new Error(
      `The ${mode} theme leaves ${missing.length} of OUI's variables undefined: ${missing
        .slice(0, 10)
        .join(', ')}`
    );
  }

  fs.writeFileSync(
    path.join(TARGET, `atlas_theme_${mode}.css`),
    toEuiNames(css.slice(0, tokensAt)).trimEnd() + '\n'
  );
  fs.writeFileSync(
    path.join(TARGET, `atlas_theme_${mode}.json`),
    JSON.stringify(tokens, null, 2) + '\n'
  );

  console.log(
    `atlas_theme_${mode}: css and json in ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
};

fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });
Promise.all(MODES.map(build)).catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
