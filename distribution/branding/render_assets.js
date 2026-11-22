/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Writes every default logo, mark, spinner and favicon from one description of the brand
 * (brand.json), over the files OpenSearch Dashboards serves from `ui/logos` and `ui/favicons`.
 * The file names stay the upstream ones so nothing that references them has to change.
 *
 *   node distribution/branding/render_assets.js          # SVGs, manifest and browserconfig
 *   node distribution/branding/render_assets.js --png    # the PNG and ICO favicons as well
 *   node distribution/branding/render_assets.js --check  # write nothing; fail if a file differs
 *
 * `--png` draws with a headless Chrome through puppeteer (a dev dependency of this repository).
 * Set PUPPETEER_EXECUTABLE_PATH when puppeteer has no browser of its own. `--check` compares
 * what is drawn without a browser, which is everything that carries the name or a colour.
 */

const fs = require('fs');
const path = require('path');

const brand = require('./brand.json');

const ASSETS = path.resolve(__dirname, '../../src/core/server/core_app/assets');
const LOGOS = path.join(ASSETS, 'logos');
const FAVICONS = path.join(ASSETS, 'favicons');
const DEFAULT_BRANDING = path.join(ASSETS, 'default_branding');

const XMLNS = 'xmlns="http://www.w3.org/2000/svg"';

/** The colours of one variant: fixed for `light` and `dark`, following the OS for `themed`. */
const palette = (scheme) => {
  if (scheme === 'themed') {
    return {
      style:
        `<style>.a{fill:${brand.accent.light}}.s{stroke:${brand.accent.light}}.t{fill:${brand.ink.light}}` +
        `@media(prefers-color-scheme:dark){.a{fill:${brand.accent.dark}}.s{stroke:${brand.accent.dark}}.t{fill:${brand.ink.dark}}}</style>`,
      fill: 'class="a"',
      stroke: 'class="s"',
      text: 'class="t"',
    };
  }
  return {
    style: '',
    fill: `fill="${brand.accent[scheme]}"`,
    stroke: `stroke="${brand.accent[scheme]}"`,
    text: `fill="${brand.ink[scheme]}"`,
  };
};

/**
 * The mark on a 64 x 64 grid: a lens (the ring) over three rising bars. A sibling of the Atlas
 * ring-and-dot. `bold` thickens it for the sizes where a hairline would blur (favicons).
 */
const glyph = ({ fill, stroke }, { bold = false, barExtra = '' } = {}) => {
  const ring = bold
    ? `<circle cx="32" cy="32" r="25.5" fill="none" ${stroke} stroke-width="6.5"/>`
    : `<circle cx="32" cy="32" r="26" fill="none" ${stroke} stroke-width="5"/>`;
  const bars = bold
    ? [
        [18, 34, 7, 11],
        [28.5, 27, 7, 18],
        [39, 20, 7, 25],
      ]
    : [
        [19, 34, 6, 11],
        [29, 27, 6, 18],
        [39, 20, 6, 25],
      ];
  return (
    ring +
    bars
      .map(
        ([x, y, w, h], i) =>
          `<rect${barExtra ? ` class="b b${i}"` : ''} x="${x}" y="${y}" width="${w}" height="${h}" rx="${
            w / 2
          }" ${fill}/>`
      )
      .join('')
  );
};

const mark = (scheme) => {
  const p = palette(scheme);
  return `<svg ${XMLNS} viewBox="0 0 64 64">${p.style}${glyph(p)}</svg>\n`;
};

/** The mark with room around it, for the 90 x 90 slots. */
const centerMark = (scheme) => {
  const p = palette(scheme);
  return `<svg ${XMLNS} fill="none" viewBox="0 0 90 90">${p.style}<g transform="translate(13 13)">${glyph(
    p
  )}</g></svg>\n`;
};

/** The loading mark: the bars rise one after another. Still when reduced motion is asked for. */
const spinner = (scheme) => {
  const p = palette(scheme);
  const motion =
    '<style>.b{transform-box:fill-box;transform-origin:50% 100%;animation:r 1.2s cubic-bezier(.16,1,.3,1) infinite}' +
    '.b1{animation-delay:.15s}.b2{animation-delay:.3s}' +
    '@keyframes r{0%,100%{transform:scaleY(.45)}45%{transform:scaleY(1)}}' +
    '@media(prefers-reduced-motion:reduce){.b{animation:none}}</style>';
  return `<svg ${XMLNS} fill="none" viewBox="0 0 90 90">${p.style}${motion}<g transform="translate(13 13)">${glyph(
    p,
    { barExtra: 'animated' }
  )}</g></svg>\n`;
};

/** `length` holds the text to that width, whatever typeface the reader's system sets it in. */
const text = (p, { x, y, size, anchor = 'start', value, length }) =>
  `<text x="${x}" y="${y}" font-family="${brand.fontFamily}" font-size="${size}" font-weight="600" ` +
  `letter-spacing="${(-0.02 * size).toFixed(2)}" text-anchor="${anchor}" ` +
  (length ? `textLength="${length}" lengthAdjust="spacing" ` : '') +
  `${p.text}>${value}</text>`;

/** Mark and product name, for the header: the slot OpenSearch Dashboards' wordmark filled. */
const applicationLogo = (scheme) => {
  const p = palette(scheme);
  return (
    `<svg height="28" width="259" viewBox="0 0 148 16" fill="none" ${XMLNS}>${p.style}` +
    `<g transform="scale(.25)">${glyph(p)}</g>` +
    text(p, { x: 21.5, y: 12.1, size: 11.5, value: brand.name }) +
    `</svg>\n`
  );
};

/*
 * How wide a name sets. The typeface is the reader's own, so this is an estimate: the advances
 * of a bold grotesque by kind of letter, in ems, less the tightening `text` applies. It comes
 * within a few hundredths of Helvetica, Arial and Inter, and a little wide of San Francisco.
 */
const advance = (character) => {
  if (/[iIjl.,:;'!| ]/.test(character)) return 0.28;
  if (/[ftr]/.test(character)) return 0.35;
  if (/[mwMW]/.test(character)) return 0.86;
  return /[A-Z]/.test(character) ? 0.7 : 0.585;
};
const textWidth = (value, size) =>
  [...value].reduce((width, character) => width + advance(character) - 0.02, 0) * size;

/**
 * Mark and name at the size of a title, for the wide slot the OpenSearch wordmark filled. The
 * picture is as wide as the name, so a name of any length sits centred in the slot.
 */
const familyLogo = (scheme) => {
  const p = palette(scheme);
  const size = 46;
  const margin = 4;
  const nameAt = margin + 64 + 14;
  const length = Math.round(textWidth(brand.shortName, size));
  return (
    `<svg viewBox="0 0 ${nameAt + length + margin} 72" fill="none" ${XMLNS}>${p.style}` +
    `<g transform="translate(${margin} 4)">${glyph(p)}</g>` +
    text(p, { x: nameAt, y: 53, size, value: brand.shortName, length }) +
    `</svg>\n`
  );
};

const SCHEMES = [
  ['', 'themed'],
  ['_on_light', 'light'],
  ['_on_dark', 'dark'],
];

/** Everything drawn without a browser: [directory, file name, content]. */
const vectorAssets = () => {
  const assets = [];
  for (const [suffix, scheme] of SCHEMES) {
    assets.push([LOGOS, `opensearch_mark${suffix}.svg`, mark(scheme)]);
    assets.push([LOGOS, `opensearch_center_mark${suffix}.svg`, centerMark(scheme)]);
    assets.push([LOGOS, `opensearch_spinner${suffix}.svg`, spinner(scheme)]);
    assets.push([LOGOS, `opensearch_dashboards${suffix}.svg`, applicationLogo(scheme)]);
    assets.push([LOGOS, `opensearch${suffix}.svg`, familyLogo(scheme)]);
  }
  assets.push([DEFAULT_BRANDING, 'opensearch_mark_default_mode.svg', mark('light')]);
  assets.push([DEFAULT_BRANDING, 'opensearch_mark_dark_mode.svg', mark('dark')]);

  // Safari's pinned tab wants one flat black shape
  const black = { fill: 'fill="#000"', stroke: 'stroke="#000"' };
  assets.push([
    FAVICONS,
    'safari-pinned-tab.svg',
    `<svg ${XMLNS} viewBox="0 0 64 64">${glyph(black, { bold: true })}</svg>\n`,
  ]);
  assets.push([
    FAVICONS,
    'manifest.json',
    JSON.stringify(
      {
        name: brand.name,
        short_name: brand.shortName,
        icons: [
          { src: 'android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
        theme_color: brand.surface.light,
        background_color: brand.surface.light,
        display: 'standalone',
      },
      null,
      4
    ) + '\n',
  ]);
  assets.push([
    FAVICONS,
    'browserconfig.xml',
    `<?xml version="1.0" encoding="utf-8"?>\n<browserconfig>\n    <msapplication>\n        <tile>\n` +
      `            <square150x150logo src="/mstile-150x150.png"/>\n` +
      `            <TileColor>${brand.accent.light}</TileColor>\n` +
      `        </tile>\n    </msapplication>\n</browserconfig>\n`,
  ]);
  return assets;
};

const relative = (dir, name) => path.relative(process.cwd(), path.join(dir, name));

const write = (dir, name, content) => {
  fs.writeFileSync(path.join(dir, name), content);
  console.log(`wrote ${relative(dir, name)}`);
};

/** The files that are not what brand.json draws: edited by hand, or not drawn again. */
const staleAssets = () =>
  vectorAssets()
    .filter(([dir, name, content]) => {
      const file = path.join(dir, name);
      return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content;
    })
    .map(([dir, name]) => relative(dir, name));

/**
 * The raster favicons. `tile` is the background (none for a transparent icon), `inset` the share
 * of the shorter side the mark takes.
 */
const RASTERS = [
  { name: 'favicon-16x16.png', w: 16, h: 16, inset: 1, color: brand.accent.light, bold: true },
  { name: 'favicon-32x32.png', w: 32, h: 32, inset: 1, color: brand.accent.light, bold: true },
  {
    name: 'favicon-48x48.png',
    w: 48,
    h: 48,
    inset: 1,
    color: brand.accent.light,
    bold: true,
    icoOnly: true,
  },
  {
    name: 'apple-touch-icon.png',
    w: 180,
    h: 180,
    inset: 0.6,
    color: brand.accent.light,
    tile: brand.surface.light,
  },
  {
    name: 'android-chrome-192x192.png',
    w: 192,
    h: 192,
    inset: 0.6,
    color: brand.accent.light,
    tile: brand.surface.light,
  },
  {
    name: 'android-chrome-512x512.png',
    w: 512,
    h: 512,
    inset: 0.6,
    color: brand.accent.light,
    tile: brand.surface.light,
  },
  // Windows tiles sit on TileColor (browserconfig.xml), so the mark is white
  { name: 'mstile-70x70.png', w: 128, h: 128, inset: 0.6, color: '#ffffff' },
  { name: 'mstile-144x144.png', w: 144, h: 144, inset: 0.6, color: '#ffffff' },
  { name: 'mstile-150x150.png', w: 270, h: 270, inset: 0.45, color: '#ffffff' },
  { name: 'mstile-310x150.png', w: 558, h: 270, inset: 0.45, color: '#ffffff' },
  { name: 'mstile-310x310.png', w: 558, h: 558, inset: 0.4, color: '#ffffff' },
];

const rasterSvg = ({ w, h, inset, color, tile, bold }) => {
  const side = Math.min(w, h) * inset;
  const scale = side / 64;
  const x = (w - side) / 2;
  const y = (h - side) / 2;
  return (
    `<svg ${XMLNS} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    (tile ? `<rect width="${w}" height="${h}" fill="${tile}"/>` : '') +
    `<g transform="translate(${x} ${y}) scale(${scale})">${glyph(
      { fill: `fill="${color}"`, stroke: `stroke="${color}"` },
      { bold }
    )}</g></svg>`
  );
};

/** An .ico file is a small directory followed by the images, which may be PNGs as they are. */
const ico = (pngs) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
};

const writeRasters = async () => {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    const forIco = [];
    for (const raster of RASTERS) {
      await page.setViewport({ width: raster.w, height: raster.h, deviceScaleFactor: 1 });
      await page.setContent(
        `<html><body style="margin:0;background:transparent">${rasterSvg(raster)}</body></html>`
      );
      const data = Buffer.from(await page.screenshot({ type: 'png', omitBackground: true }));
      if (raster.w === raster.h && raster.w <= 48) forIco.push({ size: raster.w, data });
      if (!raster.icoOnly) write(FAVICONS, raster.name, data);
    }
    write(FAVICONS, 'favicon.ico', ico(forIco));
  } finally {
    await browser.close();
  }
};

const main = async () => {
  if (process.argv.includes('--check')) {
    const stale = staleAssets();
    if (stale.length > 0) {
      throw new Error(
        `Not what distribution/branding/brand.json draws:\n  ${stale.join('\n  ')}\n` +
          'Run `node distribution/branding/render_assets.js --png` and commit the result.'
      );
    }
    return;
  }

  for (const asset of vectorAssets()) write(...asset);
  if (process.argv.includes('--png')) await writeRasters();
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
