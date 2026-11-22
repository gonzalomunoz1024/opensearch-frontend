/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The chart themes of the Atlas theme.
 *
 * Dashboards draws its charts with the chart themes OUI publishes, and uses the ones of OUI's
 * first theme whatever theme the page runs. Under the Atlas theme this module stands in for
 * OUI's (packages/osd-ui-shared-deps/entry.js): the same exports with the same shape, where what
 * surrounds the data (background, axes, grid, labels, crosshair, type) comes from the Atlas
 * variables, the way the kit's Charts component draws it.
 *
 * Under OUI's themes lie the two base themes of the chart library, which a chart shows where it
 * was given no other (the time series builder gives none, and the library's dark one is navy).
 * They get the same treatment.
 *
 * The series colours stay OUI's. Atlas names one series colour, the accent; it becomes the colour
 * of a series that was given none.
 *
 * This file runs in the browser as it is written, so it keeps to syntax every supported browser
 * reads.
 */

const lightVars = require('./target/atlas_theme_light.json');
const darkVars = require('./target/atlas_theme_dark.json');

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const merge = (base, over) => {
  const merged = { ...base };
  Object.keys(over).forEach((key) => {
    merged[key] =
      isPlainObject(over[key]) && isPlainObject(base[key])
        ? merge(base[key], over[key])
        : over[key];
  });
  return merged;
};

/*
 * The kit's chart: tick labels in the tertiary ink at caption2 (11px), grid lines in the light
 * hairline, the axis and the crosshair in the hairline, the band under the pointer in the
 * secondary surface, points ringed with the surface.
 */
const chrome = (vars) => {
  const fontFamily = vars.euiFontFamily;
  const surface = vars.euiColorEmptyShade;
  const textPrimary = vars.euiTextColor;
  const textSecondary = vars.euiTextSubduedColor;
  const textTertiary = vars.euiColorMediumShade;
  const hairline = vars.euiColorLightShade;
  const hairlineLight = vars.euiColorChartLines;

  return {
    lineAnnotation: {
      line: { stroke: textSecondary },
      details: { fontSize: 11, fontFamily, fill: textSecondary },
    },
    partition: {
      fontFamily,
      linkLabel: { textColor: textPrimary },
      sectorLineStroke: surface,
    },
    theme: {
      background: { color: surface, fallbackColor: surface },
      lineSeriesStyle: { point: { fill: surface } },
      areaSeriesStyle: { point: { fill: surface } },
      barSeriesStyle: { displayValue: { fontFamily, fill: textSecondary } },
      axes: {
        axisTitle: { fontFamily, fill: textSecondary },
        axisLine: { stroke: hairline },
        tickLabel: { fontSize: 11, fontFamily, fill: textTertiary },
        tickLine: { stroke: hairlineLight },
        gridLine: {
          horizontal: { stroke: hairlineLight },
          vertical: { stroke: hairlineLight },
        },
      },
      colors: { defaultVizColor: vars.euiColorPrimary },
      crosshair: {
        band: { fill: vars.euiColorChartBand },
        line: { stroke: hairline, dash: [3, 3] },
        crossLine: { stroke: hairline, dash: [3, 3] },
      },
    },
  };
};

const isAtlas = (themeTag) => typeof themeTag === 'string' && themeTag.indexOf('atlas') === 0;

const LIGHT_EXPORT = /_THEME_LIGHT$/;
const DARK_EXPORT = /_THEME_DARK$/;

/**
 * OUI's chart themes as the page should use them: untouched under one of OUI's themes, and with
 * the Atlas chrome under the Atlas theme.
 *
 * @param {string | undefined} themeTag the page's theme tag, window.__osdThemeTag__
 * @param {Record<string, object>} ouiChartThemes the exports of @elastic/eui/dist/eui_charts_theme
 */
const chartThemesFor = (themeTag, ouiChartThemes) => {
  if (!isAtlas(themeTag)) return ouiChartThemes;

  const themes = { ...ouiChartThemes };
  const light = merge(ouiChartThemes.EUI_CHARTS_THEME_LIGHT, chrome(lightVars));
  const dark = merge(ouiChartThemes.EUI_CHARTS_THEME_DARK, chrome(darkVars));

  Object.keys(ouiChartThemes).forEach((name) => {
    if (LIGHT_EXPORT.test(name)) themes[name] = light;
    if (DARK_EXPORT.test(name)) themes[name] = dark;
  });
  return themes;
};

/**
 * The chart library as the page should use it: untouched under one of OUI's themes, and with the
 * Atlas chrome on its two base themes under the Atlas theme. Every other export is the library's
 * own.
 *
 * @param {string | undefined} themeTag the page's theme tag, window.__osdThemeTag__
 * @param {Record<string, unknown>} chartLibrary the exports of @elastic/charts
 */
const chartLibraryFor = (themeTag, chartLibrary) => {
  if (!isAtlas(themeTag)) return chartLibrary;

  const library = { ...chartLibrary };
  // the marker of an ES module is not enumerable, so the copy above leaves it behind
  if (chartLibrary.__esModule) Object.defineProperty(library, '__esModule', { value: true });
  library.LIGHT_THEME = merge(chartLibrary.LIGHT_THEME, chrome(lightVars).theme);
  library.DARK_THEME = merge(chartLibrary.DARK_THEME, chrome(darkVars).theme);
  return library;
};

module.exports = { chartThemesFor, chartLibraryFor };
