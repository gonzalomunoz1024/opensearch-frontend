/* SPDX-License-Identifier: Apache-2.0 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const TARGET = path.resolve(__dirname, 'target');
const MODES = ['light', 'dark'];

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const atlasVars = (mode) => readJson(path.join(TARGET, `atlas_theme_${mode}.json`));
const ouiVars = (mode) => readJson(require.resolve(`@elastic/eui/dist/eui_theme_v9_${mode}.json`));

// every path to a value, so two files can be compared by what they define and not by its value
const keysOf = (value, prefix = '') =>
  value !== null && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, child]) => keysOf(child, `${prefix}${key}.`))
    : [prefix.slice(0, -1)];

describe('@osd/atlas-theme', () => {
  describe.each(MODES)('built for %s', (mode) => {
    it('defines every variable OUI publishes for a theme, and no other', () => {
      expect(keysOf(atlasVars(mode)).sort()).toEqual(keysOf(ouiVars(mode)).sort());
    });

    it('carries the Atlas accent, surface and ink', () => {
      const vars = atlasVars(mode);
      const expected =
        mode === 'light'
          ? { primary: '#007aff', surface: '#ffffff', ink: '#1d1d1f' }
          : { primary: '#0a84ff', surface: '#000000', ink: '#f5f5f7' };

      expect(vars.euiColorPrimary.toLowerCase()).toBe(expected.primary);
      expect(vars.euiColorEmptyShade.toLowerCase()).toBe(expected.surface);
      expect(vars.euiTextColor.toLowerCase()).toBe(expected.ink);
    });

    it('writes only colours a colour library can read', () => {
      const fractional = keysOf(atlasVars(mode))
        .map((key) => key.split('.').reduce((at, part) => at[part], atlasVars(mode)))
        .filter((value) => typeof value === 'string' && /rgba?\([^)]*\d\.\d+\s*,/.test(value));

      expect(fractional).toEqual([]);
    });

    it('names its classes the way the components render them', () => {
      const css = fs.readFileSync(path.join(TARGET, `atlas_theme_${mode}.css`), 'utf8');

      expect(css).toContain('.euiButton');
      expect(css).toContain('.euiPanel');
      // OUI's source says .oui*; a class left under that name would style nothing
      expect(css).not.toMatch(/[. '"-]oui[A-Z]/);
    });
  });

  describe('registered with Dashboards', () => {
    const {
      themeTags,
      themeCssDistFilenames,
      kuiCssDistFilenames,
    } = require('@osd/ui-shared-deps');

    it('is a theme version with a light and a dark tag', () => {
      expect(themeTags).toEqual(expect.arrayContaining(['atlaslight', 'atlasdark']));
      expect(themeCssDistFilenames.atlas).toEqual({
        light: 'osd-ui-shared-deps.atlas.light.css',
        dark: 'osd-ui-shared-deps.atlas.dark.css',
      });
    });

    it('has the stylesheet the bootstrap page loads for the legacy components', () => {
      const dist = path.dirname(require.resolve('@osd/ui-framework/package.json'));

      for (const mode of MODES) {
        expect(fs.existsSync(path.join(dist, 'dist', kuiCssDistFilenames.atlas[mode]))).toBe(true);
      }
    });

    it('has the file the optimizer puts in front of the styles of a plugin, as every theme does', () => {
      for (const tag of themeTags) {
        const globals = path.join(
          REPO_ROOT,
          `src/core/public/core_app/styles/_globals_${tag}.scss`
        );
        expect([tag, fs.existsSync(globals)]).toEqual([tag, true]);
      }
    });

    it('is the theme the product opens in', () => {
      const { getThemeSettings } = require('../../src/core/server/ui_settings/settings/theme');
      const setting = getThemeSettings()['theme:version'];

      expect(setting.value).toBe('atlas');
      expect(() => setting.schema.validate('atlas')).not.toThrow();
      expect(setting.optionLabels.atlas).toBe('Atlas');
    });
  });

  describe('the chart themes', () => {
    const { chartThemesFor } = require('./charts_theme');
    const ouiChartThemes = require('@elastic/eui/dist/eui_charts_theme');

    it("are OUI's own, untouched, under one of OUI's themes", () => {
      expect(chartThemesFor('v9dark', ouiChartThemes)).toBe(ouiChartThemes);
      expect(chartThemesFor(undefined, ouiChartThemes)).toBe(ouiChartThemes);
    });

    it.each(MODES)('draw what surrounds the data with the Atlas colours, %s', (mode) => {
      const vars = atlasVars(mode);
      const themes = chartThemesFor(`atlas${mode}`, ouiChartThemes);
      const suffix = `_THEME_${mode.toUpperCase()}`;
      const names = Object.keys(themes).filter((name) => name.endsWith(suffix));

      expect(Object.keys(themes).sort()).toEqual(Object.keys(ouiChartThemes).sort());
      expect(names).toEqual(expect.arrayContaining([`EUI_CHARTS${suffix}`, `OUI_CHARTS${suffix}`]));
      for (const name of names) {
        const { theme, lineAnnotation } = themes[name];

        expect([name, theme.background.color]).toEqual([name, vars.euiColorEmptyShade]);
        expect(theme.axes.gridLine.horizontal.stroke).toBe(vars.euiColorChartLines);
        expect(theme.axes.tickLabel.fill).toBe(vars.euiColorMediumShade);
        expect(theme.axes.tickLabel.fontFamily).toBe(vars.euiFontFamily);
        expect(theme.crosshair.band.fill).toBe(vars.euiColorChartBand);
        expect(lineAnnotation.line.stroke).toBe(vars.euiTextSubduedColor);
      }
    });

    it('keep the colours of the series, and give the accent to a series that has none', () => {
      const oui = ouiChartThemes.EUI_CHARTS_THEME_LIGHT.theme.colors;
      const atlas = chartThemesFor('atlaslight', ouiChartThemes).EUI_CHARTS_THEME_LIGHT.theme
        .colors;

      expect(atlas.vizColors).toEqual(oui.vizColors);
      expect(atlas.defaultVizColor).toBe(atlasVars('light').euiColorPrimary);
    });

    it("leave OUI's themes as they were", () => {
      const before = JSON.stringify(ouiChartThemes);
      chartThemesFor('atlasdark', ouiChartThemes);

      expect(JSON.stringify(ouiChartThemes)).toBe(before);
    });
  });

  describe("the chart library's base themes", () => {
    const { chartLibraryFor } = require('./charts_theme');
    const chartLibrary = require('@elastic/charts');

    it("are the library's own, untouched, under one of OUI's themes", () => {
      expect(chartLibraryFor('v9dark', chartLibrary)).toBe(chartLibrary);
      expect(chartLibraryFor(undefined, chartLibrary)).toBe(chartLibrary);
    });

    it.each(MODES)('are drawn on the Atlas surface with the Atlas type, %s', (mode) => {
      const vars = atlasVars(mode);
      const name = `${mode.toUpperCase()}_THEME`;
      const theme = chartLibraryFor(`atlas${mode}`, chartLibrary)[name];

      expect(theme.background).toEqual({
        color: vars.euiColorEmptyShade,
        fallbackColor: vars.euiColorEmptyShade,
      });
      expect(theme.axes.gridLine.horizontal.stroke).toBe(vars.euiColorChartLines);
      expect(theme.axes.tickLabel.fill).toBe(vars.euiColorMediumShade);
      expect(theme.axes.tickLabel.fontFamily).toBe(vars.euiFontFamily);
      // a base theme is a whole theme: what Atlas does not set is still there
      expect(Object.keys(theme).sort()).toEqual(Object.keys(chartLibrary[name]).sort());
      expect(theme.colors.vizColors).toEqual(chartLibrary[name].colors.vizColors);
    });

    it('leave every other export of the library as it is', () => {
      const library = chartLibraryFor('atlasdark', chartLibrary);
      const changed = Object.keys(chartLibrary).filter(
        (name) => library[name] !== chartLibrary[name]
      );

      expect(Object.keys(library).sort()).toEqual(Object.keys(chartLibrary).sort());
      expect(changed.sort()).toEqual(['DARK_THEME', 'LIGHT_THEME']);
      expect(library.__esModule).toBe(chartLibrary.__esModule);
    });

    it("leave the library's themes as they were", () => {
      const before = JSON.stringify([chartLibrary.LIGHT_THEME, chartLibrary.DARK_THEME]);
      chartLibraryFor('atlasdark', chartLibrary);

      expect(JSON.stringify([chartLibrary.LIGHT_THEME, chartLibrary.DARK_THEME])).toBe(before);
    });
  });

  describe.each(MODES)('read by the code that colours charts, %s', (mode) => {
    const previousTag = window.__osdThemeTag__;

    afterEach(() => {
      window.__osdThemeTag__ = previousTag;
      jest.resetModules();
    });

    it('is what euiThemeVars holds when the page runs the theme', () => {
      window.__osdThemeTag__ = `atlas${mode}`;
      jest.resetModules();
      const theme = require('@osd/ui-shared-deps/theme');

      expect(theme.darkMode).toBe(mode === 'dark');
      expect(theme.euiThemeVars).toEqual(atlasVars(mode));
      // built on v9, for code that asks which generation of theme it runs in
      expect(theme.version).toBe(9);
    });
  });
});
