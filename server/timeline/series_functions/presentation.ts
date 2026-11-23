/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The functions that say how series are drawn: bars, color, hide, label, legend, lines, points,
 * props, title and yaxis. Names, arguments and help are OpenSearch Dashboards' own.
 */

import { Chainable } from '../classes';
import { rgbGradient, type Color } from '../color';
import { i18n } from '../i18n';
import { alter } from '../lib';
import type { Args, Series, SeriesList } from '../types';
import { type Dict } from '../util';

/** common/lib's format of the time in the legend */
export const DEFAULT_TIME_FORMAT = 'MMMM Do YYYY, HH:mm:ss.SSS';

type Options = Record<string, unknown>;
const options = (series: Series, key: string): Options => {
  series[key] = (series[key] as Options) || {};
  return series[key] as Options;
};

export const bars = new Chainable('bars', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'width',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.bars.args.widthHelpText', {
        defaultMessage: 'Width of bars in pixels',
      }),
    },
    {
      name: 'stack',
      types: ['boolean', 'null'],
      help: i18n.translate('timeline.help.functions.bars.args.stackHelpText', {
        defaultMessage: 'Should bars be stacked, true by default',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.barsHelpText', {
    defaultMessage: 'Show the seriesList as bars',
  }),
  fn: function barsFn(args: Args) {
    return alter(args, function (eachSeries: Series, width: number | null, stack: boolean | null) {
      const barOptions = options(eachSeries, 'bars');
      barOptions.show = width == null ? 1 : width;
      barOptions.lineWidth = width == null ? 6 : width;
      eachSeries.stack = stack == null ? true : stack;
      return eachSeries;
    });
  },
});

export const color = new Chainable('color', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'color',
      types: ['string'],
      help: i18n.translate('timeline.help.functions.color.args.colorHelpText', {
        defaultMessage:
          'Color of series, as hex, e.g., #c6c6c6 is a lovely light grey. If you specify multiple \
colors, and have multiple series, you will get a gradient, e.g., "#00B1CC:#00FF94:#FF3A39:#CC1A6F"',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.colorHelpText', {
    defaultMessage: 'Change the color of the series',
  }),
  fn: function colorFn(args: Args) {
    const colors = (args.byName.color as string).split(':');
    const gradientStops = (args.byName.inputSeries as SeriesList).list.length;
    let gradient: Color[] | undefined;
    if (colors.length > 1 && gradientStops > 1) {
      // trim number of colors to avoid exception thrown by having more colors than gradient stops
      let trimmedColors = colors;
      if (colors.length > gradientStops) {
        trimmedColors = colors.slice(0, gradientStops);
      }
      gradient = rgbGradient(trimmedColors, gradientStops);
    }

    let i = 0;
    return alter(args, function (eachSeries: Series) {
      if (gradient) {
        eachSeries.color = gradient[i++].toHexString();
      } else if (colors.length === 1 || gradientStops === 1) {
        eachSeries.color = colors[0];
      } else {
        throw new Error(
          i18n.translate('timeline.serverSideErrors.colorFunction.colorNotProvidedErrorMessage', {
            defaultMessage: 'color not provided',
          })
        );
      }

      return eachSeries;
    });
  },
});

export const hide = new Chainable('hide', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'hide',
      types: ['boolean', 'null'],
      help: i18n.translate('timeline.help.functions.hide.args.hideHelpText', {
        defaultMessage: 'Hide or unhide the series',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.hideHelpText', {
    defaultMessage: 'Hide the series by default',
  }),
  fn: function hideFn(args: Args) {
    return alter(args, function (eachSeries: Series, hide: boolean | null) {
      eachSeries._hide = hide == null ? true : hide;
      return eachSeries;
    });
  },
});

export const label = new Chainable('label', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'label',
      types: ['string'],
      help: i18n.translate('timeline.help.functions.label.args.labelHelpText', {
        defaultMessage:
          'Legend value for series. You can use $1, $2, etc, in the string to match up with the regex capture groups',
        description: '"$1" and "$2" are part of the expression and must not be translated.',
      }),
    },
    {
      name: 'regex',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.label.args.regexHelpText', {
        defaultMessage: 'A regex with capture group support',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.labelHelpText', {
    defaultMessage: 'Change the label of the series. Use %s to reference the existing label',
  }),
  fn: function labelFn(args: Args) {
    const config = args.byName;
    return alter(args, function (eachSeries: Series) {
      if (config.regex) {
        const regex = new RegExp(config.regex as string);
        eachSeries.label = (eachSeries.label as string).replace(regex, config.label as string);
      } else {
        eachSeries.label = config.label as string;
      }

      return eachSeries;
    });
  },
});

export const legend = new Chainable('legend', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'position',
      types: ['string', 'boolean', 'null'],
      help: i18n.translate('timeline.help.functions.legend.args.positionHelpText', {
        defaultMessage:
          'Corner to place the legend in: nw, ne, se, or sw. You can also pass false to disable the legend',
        description: '"nw", "ne", "se", "sw" and "false" are keywords and must not be translated.',
      }),
      suggestions: [
        {
          name: 'false',
          help: i18n.translate(
            'timeline.help.functions.legend.args.position.suggestions.falseHelpText',
            {
              defaultMessage: 'disable legend',
            }
          ),
        },
        {
          name: 'nw',
          help: i18n.translate(
            'timeline.help.functions.legend.args.position.suggestions.nwHelpText',
            {
              defaultMessage: 'place legend in north west corner',
            }
          ),
        },
        {
          name: 'ne',
          help: i18n.translate(
            'timeline.help.functions.legend.args.position.suggestions.neHelpText',
            {
              defaultMessage: 'place legend in north east corner',
            }
          ),
        },
        {
          name: 'se',
          help: i18n.translate(
            'timeline.help.functions.legend.args.position.suggestions.seHelpText',
            {
              defaultMessage: 'place legend in south east corner',
            }
          ),
        },
        {
          name: 'sw',
          help: i18n.translate(
            'timeline.help.functions.legend.args.position.suggestions.swHelpText',
            {
              defaultMessage: 'place legend in south west corner',
            }
          ),
        },
      ],
    },
    {
      name: 'columns',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.legend.args.columnsHelpText', {
        defaultMessage: 'Number of columns to divide the legend into',
      }),
    },
    {
      name: 'showTime',
      types: ['boolean'],
      help: i18n.translate('timeline.help.functions.legend.args.showTimeHelpText', {
        defaultMessage: 'Show time value in legend when hovering over graph. Default: true',
      }),
    },
    {
      name: 'timeFormat',
      types: ['string'],
      help: i18n.translate('timeline.help.functions.legend.args.timeFormatHelpText', {
        defaultMessage: 'moment.js format pattern. Default: {defaultTimeFormat}',
        values: {
          defaultTimeFormat: DEFAULT_TIME_FORMAT,
        },
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.legendHelpText', {
    defaultMessage: 'Set the position and style of the legend on the plot',
  }),
  fn: function legendFn(args: Args) {
    return alter(
      args,
      function (
        eachSeries: Series,
        position: string | boolean | null,
        columns: number | null,
        showTime = true,
        timeFormat = DEFAULT_TIME_FORMAT
      ) {
        const global = options(eachSeries, '_global');
        const legendOptions = options(global as Series, 'legend');
        legendOptions.noColumns = columns;
        legendOptions.showTime = showTime;
        legendOptions.timeFormat = timeFormat;
        if (position === false) {
          legendOptions.show = false;
          legendOptions.showTime = false;
        } else {
          legendOptions.position = position;
        }

        return eachSeries;
      }
    );
  },
});

export const lines = new Chainable('lines', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'width',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.lines.args.widthHelpText', {
        defaultMessage: 'Line thickness',
      }),
    },
    {
      name: 'fill',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.lines.args.fillHelpText', {
        defaultMessage: 'Number between 0 and 10. Use for making area charts',
      }),
    },
    {
      name: 'stack',
      types: ['boolean', 'null'],
      help: i18n.translate('timeline.help.functions.lines.args.stackHelpText', {
        defaultMessage: 'Stack lines, often misleading. At least use some fill if you use this.',
      }),
    },
    {
      name: 'show',
      types: ['number', 'boolean', 'null'],
      help: i18n.translate('timeline.help.functions.lines.args.showHelpText', {
        defaultMessage: 'Show or hide lines',
      }),
    },
    {
      name: 'steps',
      types: ['number', 'boolean', 'null'],
      help: i18n.translate('timeline.help.functions.lines.args.stepsHelpText', {
        defaultMessage: 'Show line as step, e.g., do not interpolate between points',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.linesHelpText', {
    defaultMessage: 'Show the seriesList as lines',
  }),
  fn: function linesFn(args: Args) {
    return alter(
      args,
      function (
        eachSeries: Series,
        width: number | null,
        fill: number | null,
        stack: boolean | null,
        show: number | boolean | null,
        steps: number | boolean | null
      ) {
        const lineOptions = options(eachSeries, 'lines');

        // Defaults
        if (lineOptions.lineWidth == null) lineOptions.lineWidth = 3;

        if (width != null) lineOptions.lineWidth = width;
        if (fill != null) lineOptions.fill = fill / 10;
        if (stack != null) eachSeries.stack = stack;
        if (show != null) lineOptions.show = show;
        if (steps != null) lineOptions.steps = steps;
        return eachSeries;
      }
    );
  },
});

const validSymbols = ['triangle', 'cross', 'square', 'diamond', 'circle'];
const defaultSymbol = 'circle';

export const points = new Chainable('points', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'radius',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.points.args.radiusHelpText', {
        defaultMessage: 'Size of points',
      }),
    },
    {
      name: 'weight',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.points.args.weightHelpText', {
        defaultMessage: 'Thickness of line around point',
      }),
    },
    {
      name: 'fill',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.points.args.fillHelpText', {
        defaultMessage: 'Number between 0 and 10 representing opacity of fill',
      }),
    },
    {
      name: 'fillColor',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.points.args.fillColorHelpText', {
        defaultMessage: 'Color with which to fill point',
      }),
    },
    // The order of these keys is upstream's, which the functions' answer shows
    {
      name: 'symbol',
      help: i18n.translate('timeline.help.functions.points.args.symbolHelpText', {
        defaultMessage: 'point symbol. One of: {validSymbols}',
        values: {
          validSymbols: validSymbols.join(', '),
        },
      }),
      types: ['string', 'null'],
      suggestions: validSymbols.map((symbol) => {
        const suggestion: { name: string; help?: string } = { name: symbol };
        if (symbol === defaultSymbol) {
          suggestion.help = 'default';
        }
        return suggestion;
      }),
    },
    {
      name: 'show',
      types: ['boolean', 'null'],
      help: i18n.translate('timeline.help.functions.points.args.showHelpText', {
        defaultMessage: 'Show points or not',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.pointsHelpText', {
    defaultMessage: 'Show the series as points',
  }),
  fn: function pointsFn(args: Args) {
    return alter(
      args,
      function (
        eachSeries: Series,
        radius: number | null,
        weight: number | null,
        fill: number | null,
        fillColor: string | null,
        symbol: string | null,
        show: boolean | null
      ) {
        const pointOptions = options(eachSeries, 'points');
        pointOptions.radius = radius == null ? undefined : radius;

        if (fill) {
          pointOptions.fillColor = fillColor == null ? false : fillColor;
        }

        if (fill != null) {
          pointOptions.fill = fill / 10;
        }

        if (weight != null) {
          pointOptions.lineWidth = weight;
        }

        symbol = symbol || defaultSymbol;
        if (!validSymbols.includes(symbol)) {
          throw new Error(
            i18n.translate('timeline.serverSideErrors.pointsFunction.notValidSymbolErrorMessage', {
              defaultMessage: 'Valid symbols are: {validSymbols}',
              values: {
                validSymbols: validSymbols.join(', '),
              },
            })
          );
        }

        pointOptions.symbol = symbol;

        pointOptions.show = show == null ? true : show;

        return eachSeries;
      }
    );
  },
});

/** "a.b[0].c": value into { a: { b: [{ c: value }] } } */
function unflatten(data: Dict): Dict {
  const regex = new RegExp(/\.?([^.\[\]]+)|\[(\d+)\]/g);
  const result: Dict = {};
  Object.keys(data).forEach(function (p) {
    let cur: Dict = result;
    let prop = '';
    let m;
    while ((m = regex.exec(p))) {
      cur =
        ((Object.prototype.hasOwnProperty.call(cur, prop) && cur[prop]) as Dict) ||
        (cur[prop] = m[2] ? [] : {});
      prop = m[2] || m[1];
    }
    cur[prop] = data[p];
  });
  return (result[''] as Dict) || result;
}

export const props = new Chainable('props', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'global',
      types: ['boolean', 'null'],
      help: i18n.translate('timeline.help.functions.props.args.globalHelpText', {
        defaultMessage: 'Set props on the seriesList vs on each series',
      }),
    },
  ],
  extended: {
    types: ['seriesList', 'number', 'string', 'boolean', 'null'],
    // Extended args can not currently be multivalued,
    // multi: false is not required and is shown here for demonstration purposes
    multi: false,
  },
  // extended means you can pass arguments that aren't listed. They just won't be in the ordered array
  // They will be passed as args._extended:{}
  help: i18n.translate('timeline.help.functions.propsHelpText', {
    defaultMessage:
      'Use at your own risk, sets arbitrary properties on the series. For example {example}',
    values: {
      example: '.props(label=bears!)',
    },
  }),
  fn: function firstFn(args: Args) {
    const rest: Dict = {};
    for (const key of Object.keys(args.byName)) {
      if (key !== 'inputSeries' && key !== 'global') rest[key] = args.byName[key];
    }
    const properties = unflatten(rest);

    if (args.byName.global) {
      Object.assign(args.byName.inputSeries as SeriesList, properties);
      return args.byName.inputSeries;
    } else {
      return alter(args, function (eachSeries: Series) {
        Object.assign(eachSeries, properties);
        return eachSeries;
      });
    }
  },
});

export const title = new Chainable('title', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'title',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.title.args.titleHelpText', {
        defaultMessage: 'Title for the plot.',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.titleHelpText', {
    defaultMessage:
      'Adds a title to the top of the plot. If called on more than 1 seriesList the last call will be used.',
  }),
  fn: function hideFn(args: Args) {
    return alter(args, function (eachSeries: Series, title: string | null) {
      eachSeries._title = title;
      return eachSeries;
    });
  },
});

const tickFormatters: Record<string, string> = {
  bits: 'bits',
  'bits/s': 'bits/s',
  bytes: 'bytes',
  'bytes/s': 'bytes/s',
  currency: 'currency(:ISO 4217 currency code)',
  percent: 'percent',
  custom: 'custom(:prefix:suffix)',
};

export const yaxis = new Chainable('yaxis', {
  args: [
    {
      name: 'inputSeries',
      types: ['seriesList'],
    },
    {
      name: 'yaxis',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.yaxis.args.yaxisHelpText', {
        defaultMessage:
          'The numbered y-axis to plot this series on, e.g., .yaxis(2) for a 2nd y-axis.',
      }),
    },
    {
      name: 'min',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.yaxis.args.minHelpText', {
        defaultMessage: 'Min value',
      }),
    },
    {
      name: 'max',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.yaxis.args.maxHelpText', {
        defaultMessage: 'Max value',
      }),
    },
    {
      name: 'position',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.yaxis.args.positionHelpText', {
        defaultMessage: 'left or right',
      }),
    },
    {
      name: 'label',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.yaxis.args.labelHelpText', {
        defaultMessage: 'Label for axis',
      }),
    },
    {
      name: 'color',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.yaxis.args.colorHelpText', {
        defaultMessage: 'Color of axis label',
      }),
    },
    {
      name: 'units',
      types: ['string', 'null'],
      help: i18n.translate('timeline.help.functions.yaxis.args.unitsHelpText', {
        defaultMessage: 'The function to use for formatting y-axis labels. One of: {formatters}',
        values: {
          formatters: Object.values(tickFormatters).join(', '),
        },
      }),
      suggestions: Object.keys(tickFormatters).map((key) => {
        return { name: key, help: tickFormatters[key] };
      }),
    },
    {
      name: 'tickDecimals',
      types: ['number', 'null'],
      help: i18n.translate('timeline.help.functions.yaxis.args.tickDecimalsHelpText', {
        defaultMessage: 'The number of decimal places for the y-axis tick labels.',
      }),
    },
  ],
  help: i18n.translate('timeline.help.functions.yaxisHelpText', {
    defaultMessage:
      'Configures a variety of y-axis options, the most important likely being the ability to add an Nth (eg 2nd) y-axis',
  }),
  fn: function yaxisFn(args: Args) {
    return alter(
      args,
      function (
        eachSeries: Series,
        yaxis: number | null,
        min: number | null,
        max: number | null,
        position: string | null,
        label: string | null,
        color: string | null,
        units: string | null,
        tickDecimals: number | null
      ) {
        yaxis = yaxis || 1;

        eachSeries.yaxis = yaxis;
        const global = options(eachSeries, '_global');
        global.yaxes = (global.yaxes as Options[]) || [];
        const yaxes = global.yaxes as Options[];
        yaxes[yaxis - 1] = yaxes[yaxis - 1] || {};

        const myAxis = yaxes[yaxis - 1];
        myAxis.position = position || (yaxis % 2 ? 'left' : 'right');
        myAxis.min = min;
        myAxis.max = max;
        myAxis.axisLabelFontSizePixels = 11;
        myAxis.axisLabel = label;
        myAxis.axisLabelColour = color;
        myAxis.axisLabelUseCanvas = false;

        if (tickDecimals) {
          myAxis.tickDecimals = tickDecimals < 0 ? 0 : tickDecimals;
        }

        if (units) {
          const unitTokens = units.split(':');
          const unitType = unitTokens[0];
          if (!Object.prototype.hasOwnProperty.call(tickFormatters, unitType)) {
            throw new Error(
              i18n.translate(
                'timeline.serverSideErrors.yaxisFunction.notSupportedUnitTypeErrorMessage',
                {
                  defaultMessage: '{units} is not a supported unit type.',
                  values: { units },
                }
              )
            );
          }
          if (unitType === 'currency') {
            const threeLetterCode = /^[A-Za-z]{3}$/;
            const currency = unitTokens[1];
            if (currency && !threeLetterCode.test(currency)) {
              throw new Error(
                i18n.translate(
                  'timeline.serverSideErrors.yaxisFunction.notValidCurrencyFormatErrorMessage',
                  {
                    defaultMessage: 'Currency must be a three letter code',
                  }
                )
              );
            }
          }

          const unitOptions: Options = {
            type: unitType,
            prefix: unitTokens[1] || '',
            suffix: unitTokens[2] || '',
          };
          myAxis.units = unitOptions;

          if (unitType === 'percent') {
            // jquery.flot uses axis.tickDecimals to generate tick values
            // need 2 extra decimal places to preserve precision when percent shifts value to left
            unitOptions.tickDecimalsShift = 2;
            if (tickDecimals) {
              (myAxis.tickDecimals as number) += 2;
            } else {
              myAxis.tickDecimals = unitOptions.tickDecimalsShift;
            }
          }
        }

        return eachSeries;
      }
    );
  },
});
