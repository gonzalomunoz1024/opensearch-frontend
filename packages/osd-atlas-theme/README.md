# @osd/atlas-theme

The Atlas theme for OUI, the component library OpenSearch Dashboards is built from. It gives
every OUI component the look of the Atlas kit (`packages/ui` and `docs/design-language.md` in
`gonzalomunoz1024/infrastructure-automation`) without touching a component: the same markup, the
same class names, a different stylesheet.

Dashboards knows it as the theme version `atlas`, beside OUI's own `v7`, `v8` and `v9`, and it is
the default. The other three still work and can be picked in Advanced settings.

## What is in it

```
src/
  _colors_light.scss   the Atlas colours under OUI's variable names, light
  _colors_dark.scss    the same, dark
  _variables.scss      type, radii, motion, fields, panels: every OUI variable Atlas sets
  _mixins.scss         OUI's shadow, panel and field mixins, redefined with Atlas values
  _globals.scss        variables and mixins, no CSS: what every stylesheet of a plugin starts with
  _theme.scss          the whole theme: globals, OUI's components, then the refinements
  refinements/         what variables cannot say, one file per group of components
  theme_light.scss     a colours file and the theme
  theme_dark.scss
scripts/build.js       compiles the theme into target/
charts_theme.js        OUI's chart themes, and the chart library's two base themes, with the
                       Atlas colours around the data
```

The theme stands on OUI's v9 theme: its variables fill in what Atlas does not set, and its
components are compiled with the Atlas values. Three layers, from broad to narrow:

1. **Variables.** Where OUI has a variable for it, Atlas sets the variable and OUI's own styles do
   the rest. Most of the theme is this.
2. **Mixins.** OUI draws shadows, panels and fields through mixins. Redefining a mixin changes
   every component that uses it, in OUI and in every plugin.
3. **Refinements.** The few places where the shape itself differs (buttons, tabs, the segmented
   control, floating panels, breadcrumbs) are plain rules on OUI's class names.

## Building

```bash
yarn build        # in this directory; `yarn osd bootstrap` runs it too
```

writes, for `light` and for `dark`:

- `target/atlas_theme_<mode>.css`, loaded in place of OUI's `eui_theme_v9_<mode>.css`;
- `target/atlas_theme_<mode>.json`, the theme's variables with the keys of OUI's
  `eui_theme_v9_<mode>.json`, read by the code that colours charts, maps and the code editor.

OUI's source names its classes `.oui*`, and its build publishes every stylesheet with the
`.eui*` names the components still render. The build here makes the same substitution, so write
`.oui*` in this package, and do not select on a class name by attribute (`[class*='ouiX']`):
the substitution does not reach inside one.

## Where Dashboards picks it up

| Where | What |
| --- | --- |
| `packages/osd-ui-shared-deps/theme_config.js`, `theme_config.d.ts` | The version `atlas`, its label, its tags `atlaslight` and `atlasdark`. |
| `packages/osd-ui-shared-deps/rspack.config.js` | The two stylesheets become `osd-ui-shared-deps.atlas.<mode>.css`. |
| `packages/osd-ui-shared-deps/theme.ts` | The two JSON files become `euiThemeVars`. |
| `src/core/public/core_app/styles/_globals_atlas<mode>.scss` | What the optimizer puts in front of every `.scss` of a plugin: a colours file and `_globals.scss`. |
| `src/legacy/ui/ui_render/ui_render_mixin.js` | The colours of the loading screen and the fonts of the first paint. |
| `src/core/server/ui_settings/ui_settings_config.ts` | `DEFAULT_THEME_VERSION`. |
| `packages/osd-ui-shared-deps/entry.js` | Under an `atlas` tag, the chart themes every plugin imports are the ones of `charts_theme.js`, and so are the two base themes of the chart library. |
| `src/plugins/discover/.../chart/histogram/histogram.tsx` | The histogram's grid and axis lines take the theme's `euiColorChartLines`. |
| `distribution/config`, the Helm chart | `opensearchDashboards.branding.useExpandedHeader: false`: one header bar. |

This is the procedure `docs/theme.md` gives for a new theme. A plugin gets the theme when it is
built in this repository, which is how the distribution builds its plugins. A plugin built
against OpenSearch Dashboards carries no styles for `atlas`.

## Changing it

- Take values from the Atlas kit. Do not add a colour, a radius or a type size the kit does not
  have; where OUI wants a shade Atlas does not name, derive it from one Atlas does name and say so
  in a comment.
- Try a variable first, then a mixin, then a refinement.
- Keep light and dark in step: a colour belongs in both colours files, and a rule that must
  differ by mode uses OUI's `lightOrDarkTheme()`.
- Do not give `backdrop-filter` to an element that holds fixed-position children: the filter
  makes it their containing block, and they move. The mask behind dialogs holds flyouts and the
  navigation drawer, which is why `atlasScrim` blurs on a layer behind the mask's content.
- `node scripts/stylelint` checks the theme with the repository's rules, except the four that
  keep a plugin from restyling OUI and from naming colours (`.stylelintrc.yml`).
- Look at the result in both modes in the running product (`theme:darkMode` in Advanced
  settings). To compile only this theme while developing:
  `OSD_OPTIMIZER_THEMES=atlaslight,atlasdark yarn start --config distribution/config/dev.yml`.

## Where it departs from the kit, and why

- **Fonts.** The kit's stacks start with the Apple system faces. One face is added to each for a
  computer that has none of them: Inter and Source Code Pro, which Dashboards already serves and
  a browser fetches only if it needs them.
- **Coloured text.** The Atlas green, orange and red are too light to read as text on the
  surface, so text in those colours keeps the darker shades OUI computes for contrast. Fills,
  borders and icons use the Atlas colours as they are.
- **Body size.** Dashboards is dense; body text is the kit's `text-sm` (14px), not its 17px
  reading size.
- **Badges with a named colour.** OUI sets their colour from JavaScript as an inline style, so
  the theme matches them by that style to give them the kit's tinted capsule.
- **Chart colours.** The kit draws one series in the accent and has no palette for many. A
  series that was given no colour takes the accent; charts with several series keep OUI's
  palette, which is made to be told apart by people who do not see every colour. What surrounds
  the data (axes, grid, labels, crosshair, type) follows the kit's chart.
- **Code colours.** The kit has no palette for syntax either; the editor and code blocks keep
  OUI's, on the Atlas surfaces.
- **The bottom bar** (unsaved changes, bulk actions) is dark in light mode too. OUI's is, and
  pages fill it with white text and ghost buttons that only a dark bar can show.
- **The header** is one bar because the distribution's settings ask for one. With the two bars
  of OpenSearch Dashboards' default, the upper one stays dark, as its white logo needs.
- **KUI**, the library that predates OUI and still styles two fields in the tutorials, has no
  Atlas stylesheet; it uses v9's.
