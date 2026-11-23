/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The web fonts of OpenSearch Dashboards: the files it serves under /ui/fonts (web/static/ui/fonts
 * here, copied as they are) and the rules that declare them on every page, written as
 * src/core/server/rendering/views/fonts.tsx writes them and in its order. The Atlas stacks name two
 * of them, 'Inter UI' for text and 'Source Code Pro' for code, after the system faces of a Mac: where
 * those are missing, as on Linux, the text and the code are drawn from these files, as there.
 */

type Style = 'normal' | 'italic';
type Weight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

interface FontVariant {
  style: Style;
  weight: Weight;
  /** Files under the fonts directory, or the names of a face installed on the system */
  sources: Array<{ file: string } | { local: string }>;
  unicodeRange?: string;
}

export interface FontFamily {
  family: string;
  variants: FontVariant[];
}

/** Where the fonts are served, under the base path: the original's `${uiPublicUrl}/fonts` */
export const FONTS_PATH = '/ui/fonts';

/** Each weight with the names of its upright and italic files, lightest first */
type Cuts = Array<[Weight, string, string]>;

/** A family whose every cut is in each of the given formats, one file per format */
const family = (name: string, cuts: Cuts, files: (cut: string) => string[]): FontFamily => ({
  family: name,
  variants: cuts.flatMap(([weight, upright, italic]) =>
    ([['normal', upright], ['italic', italic]] as Array<[Style, string]>).map(([style, cut]) => ({
      style,
      weight,
      sources: files(cut).map((file) => ({ file })),
    }))
  ),
});

const ADOBE_CUTS: Cuts = [
  [200, 'ExtraLight', 'ExtraLightIt'],
  [300, 'Light', 'LightIt'],
  [400, 'Regular', 'It'],
  [500, 'Medium', 'MediumIt'],
  [600, 'Semibold', 'SemiboldIt'],
  [700, 'Bold', 'BoldIt'],
  [900, 'Black', 'BlackIt'],
];

const interUi = family(
  'Inter UI',
  [
    [100, 'Thin-BETA', 'ThinItalic-BETA'],
    [200, 'ExtraLight-BETA', 'ExtraLightItalic-BETA'],
    [300, 'Light-BETA', 'LightItalic-BETA'],
    [400, 'Regular', 'Italic'],
    [500, 'Medium', 'MediumItalic'],
    [600, 'SemiBold', 'SemiBoldItalic'],
    [700, 'Bold', 'BoldItalic'],
    [800, 'ExtraBold', 'ExtraBoldItalic'],
    [900, 'Black', 'BlackItalic'],
  ],
  (cut) => [`inter_ui/Inter-UI-${cut}.woff2`, `inter_ui/Inter-UI-${cut}.woff`]
);

// The original declares no medium weight of Source Sans 3, though it serves its files
const sourceSans3 = family(
  'Source Sans 3',
  ADOBE_CUTS.filter(([weight]) => weight !== 500),
  (cut) => [`source_sans_3/SourceSans3-${cut}.ttf.woff2`, `source_sans_3/SourceSans3-${cut}.otf.woff`]
);

const ROBOTO_MONO_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

// A face of the system first, under either of its names, then the file
const robotoMono: FontFamily = {
  family: 'Roboto Mono',
  variants: (
    [
      ['normal', 400, 'Roboto Mono', 'RobotoMono-Regular'],
      ['italic', 400, 'Roboto Mono Italic', 'RobotoMono-Italic'],
      ['normal', 700, 'Roboto Mono Bold', 'RobotoMono-Bold'],
      ['italic', 700, 'Roboto Mono Bold Italic', 'RobotoMono-BoldItalic'],
    ] as Array<[Style, Weight, string, string]>
  ).map(([style, weight, name, postscriptName]) => ({
    style,
    weight,
    sources: [{ local: name }, { local: postscriptName }, { file: `roboto_mono/${postscriptName}.ttf` }],
    unicodeRange: ROBOTO_MONO_RANGE,
  })),
};

const sourceCodePro = family('Source Code Pro', ADOBE_CUTS, (cut) => [
  `source_code_pro/SourceCodePro-${cut}.ttf.woff2`,
  `source_code_pro/SourceCodePro-${cut}.otf.woff`,
]);

const rubik = family(
  'Rubik',
  [
    [300, 'Light', 'LightItalic'],
    [400, 'Regular', 'Italic'],
    [500, 'Medium', 'MediumItalic'],
    [600, 'SemiBold', 'SemiBoldItalic'],
    [700, 'Bold', 'BoldItalic'],
    [800, 'ExtraBold', 'ExtraBoldItalic'],
    [900, 'Black', 'BlackItalic'],
  ],
  (cut) => [`rubik/static/Rubik-${cut}.woff2`]
);

/** The families in the order the original declares them */
export const FONT_FAMILIES: readonly FontFamily[] = [interUi, sourceSans3, robotoMono, sourceCodePro, rubik];

/** Every file a rule names, relative to the fonts directory */
export function fontFiles(families: readonly FontFamily[] = FONT_FAMILIES): string[] {
  return families.flatMap(({ variants }) =>
    variants.flatMap(({ sources }) => sources.flatMap((source) => ('file' in source ? [source.file] : [])))
  );
}

/*
 * The format a source is in, from the end of its name. The original names the format of the TTF
 * files of Roboto Mono 'woff2', or 'ttf', which no browser knows, so that the italic is never
 * loaded from its file; here a TTF file is 'truetype', which loads each as what it is.
 */
const formatOf = (file: string) => {
  const extension = file.slice(file.lastIndexOf('.') + 1);
  return extension === 'ttf' ? 'truetype' : extension;
};

/**
 * A text as the inside of a quoted CSS string, which it cannot end, nor the url() or the <style>
 * element the string is written in: every character but a letter, a digit and _ - . / : ~ % is
 * written as a CSS escape (a backslash, its code point in hexadecimal, and the space that ends the
 * escape), which a browser reads back as that character. The base path is written this way; the
 * original writes it into its fonts' rules as it is (src/core/server/rendering/views/fonts.tsx).
 */
export function cssString(text: string): string {
  return text.replace(/[^\w\-./:~%]/gu, (character) => `\\${(character.codePointAt(0) ?? 0).toString(16)} `);
}

/** The @font-face rules of every family, with their files under `${uiPublicUrl}/fonts` */
export function fontFaceRules(uiPublicUrl: string, families: readonly FontFamily[] = FONT_FAMILIES): string {
  return families
    .flatMap(({ family: name, variants }) =>
      variants.map(({ style, weight, sources, unicodeRange }) => {
        const src = sources
          .map((source) =>
            'file' in source
              ? `url('${cssString(`${uiPublicUrl}/fonts/${source.file}`)}') format('${formatOf(source.file)}')`
              : `local('${source.local}')`
          )
          .join(', ');
        const range = unicodeRange ? ` unicode-range: ${unicodeRange};` : '';
        return `@font-face { font-family: '${name}'; font-style: ${style}; font-weight: ${weight}; src: ${src};${range} }`;
      })
    )
    .join('\n');
}
