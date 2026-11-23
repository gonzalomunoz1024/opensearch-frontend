/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Less coloured as the original's code editor colours a markdown panel's custom CSS: the rules of
 * ACE's less mode, in their order, with its lists of CSS words, and the arrows its C-style folding
 * draws (at a line that opens a block, as ACE draws them by default). Derived from the Ace editor
 * as brace 0.11.1 holds it, BSD 3-Clause License, Copyright (c) 2010, Ajax.org B.V.
 */

import type { CodeToken } from '../../../components/code_editor';
import { aceMode, aceRuns, type AceToken } from './ace_tokenizer';

type State = 'start' | 'comment';

/** The properties ACE knows (CssHighlightRules.supportType) */
const PROPERTIES =
  'align-content|align-items|align-self|all|animation|animation-delay|animation-direction|' +
  'animation-duration|animation-fill-mode|animation-iteration-count|animation-name|' +
  'animation-play-state|animation-timing-function|backface-visibility|background|' +
  'background-attachment|background-blend-mode|background-clip|background-color|' +
  'background-image|background-origin|background-position|background-repeat|background-size|' +
  'border|border-bottom|border-bottom-color|border-bottom-left-radius|' +
  'border-bottom-right-radius|border-bottom-style|border-bottom-width|border-collapse|' +
  'border-color|border-image|border-image-outset|border-image-repeat|border-image-slice|' +
  'border-image-source|border-image-width|border-left|border-left-color|border-left-style|' +
  'border-left-width|border-radius|border-right|border-right-color|border-right-style|' +
  'border-right-width|border-spacing|border-style|border-top|border-top-color|' +
  'border-top-left-radius|border-top-right-radius|border-top-style|border-top-width|' +
  'border-width|bottom|box-shadow|box-sizing|caption-side|clear|clip|color|column-count|' +
  'column-fill|column-gap|column-rule|column-rule-color|column-rule-style|column-rule-width|' +
  'column-span|column-width|columns|content|counter-increment|counter-reset|cursor|direction|' +
  'display|empty-cells|filter|flex|flex-basis|flex-direction|flex-flow|flex-grow|flex-shrink|' +
  'flex-wrap|float|font|font-family|font-size|font-size-adjust|font-stretch|font-style|' +
  'font-variant|font-weight|hanging-punctuation|height|justify-content|left|letter-spacing|' +
  'line-height|list-style|list-style-image|list-style-position|list-style-type|margin|' +
  'margin-bottom|margin-left|margin-right|margin-top|max-height|max-width|min-height|min-width|' +
  'nav-down|nav-index|nav-left|nav-right|nav-up|opacity|order|outline|outline-color|' +
  'outline-offset|outline-style|outline-width|overflow|overflow-x|overflow-y|padding|' +
  'padding-bottom|padding-left|padding-right|padding-top|page-break-after|page-break-before|' +
  'page-break-inside|perspective|perspective-origin|position|quotes|resize|right|tab-size|' +
  'table-layout|text-align|text-align-last|text-decoration|text-decoration-color|' +
  'text-decoration-line|text-decoration-style|text-indent|text-justify|text-overflow|' +
  'text-shadow|text-transform|top|transform|transform-origin|transform-style|transition|' +
  'transition-delay|transition-duration|transition-property|transition-timing-function|' +
  'unicode-bidi|vertical-align|visibility|white-space|width|word-break|word-spacing|word-wrap|' +
  'z-index';

/** Its constants (supportConstant) */
const CONSTANTS =
  'absolute|after-edge|after|all-scroll|all|alphabetic|always|antialiased|armenian|auto|' +
  'avoid-column|avoid-page|avoid|balance|baseline|before-edge|before|below|bidi-override|' +
  'block-line-height|block|bold|bolder|border-box|both|bottom|box|break-all|break-word|' +
  'capitalize|caps-height|caption|center|central|char|circle|cjk-ideographic|clone|close-quote|' +
  'col-resize|collapse|column|consider-shifts|contain|content-box|cover|crosshair|cubic-bezier|' +
  'dashed|decimal-leading-zero|decimal|default|disabled|disc|disregard-shifts|' +
  'distribute-all-lines|distribute-letter|distribute-space|distribute|dotted|double|e-resize|' +
  'ease-in|ease-in-out|ease-out|ease|ellipsis|end|exclude-ruby|fill|fixed|georgian|glyphs|' +
  'grid-height|groove|hand|hanging|hebrew|help|hidden|hiragana-iroha|hiragana|horizontal|icon|' +
  'ideograph-alpha|ideograph-numeric|ideograph-parenthesis|ideograph-space|ideographic|' +
  'inactive|include-ruby|inherit|initial|inline-block|inline-box|inline-line-height|' +
  'inline-table|inline|inset|inside|inter-ideograph|inter-word|invert|italic|justify|' +
  'katakana-iroha|katakana|keep-all|last|left|lighter|line-edge|line-through|line|linear|' +
  'list-item|local|loose|lower-alpha|lower-greek|lower-latin|lower-roman|lowercase|lr-tb|ltr|' +
  'mathematical|max-height|max-size|medium|menu|message-box|middle|move|n-resize|ne-resize|' +
  'newspaper|no-change|no-close-quote|no-drop|no-open-quote|no-repeat|none|normal|not-allowed|' +
  'nowrap|nw-resize|oblique|open-quote|outset|outside|overline|padding-box|page|pointer|' +
  'pre-line|pre-wrap|pre|preserve-3d|progress|relative|repeat-x|repeat-y|repeat|replaced|' +
  'reset-size|ridge|right|round|row-resize|rtl|s-resize|scroll|se-resize|separate|slice|' +
  'small-caps|small-caption|solid|space|square|start|static|status-bar|step-end|step-start|' +
  'steps|stretch|strict|sub|super|sw-resize|table-caption|table-cell|table-column-group|' +
  'table-column|table-footer-group|table-header-group|table-row-group|table-row|table|tb-rl|' +
  'text-after-edge|text-before-edge|text-bottom|text-size|text-top|text|thick|thin|transparent|' +
  'underline|upper-alpha|upper-latin|upper-roman|uppercase|use-script|vertical-ideographic|' +
  'vertical-text|visible|w-resize|wait|whitespace|z-index|zero';

/** Its colour names (supportConstantColor) */
const COLOURS =
  'aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|' +
  'blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|' +
  'crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|' +
  'darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|' +
  'darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|' +
  'dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|' +
  'gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|' +
  'lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|' +
  'lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|' +
  'lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|' +
  'magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|' +
  'mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|' +
  'mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|' +
  'palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|' +
  'powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|' +
  'seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|' +
  'steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|' +
  'yellowgreen';

/** Its font names (supportConstantFonts) */
const FONTS =
  'arial|century|comic|courier|cursive|fantasy|garamond|georgia|helvetica|impact|lucida|symbol|' +
  'system|tahoma|times|trebuchet|utopia|verdana|webdings|sans-serif|serif|monospace';

/** The words ACE's less mode takes as keywords */
const KEYWORDS =
  '@import|@media|@font-face|@keyframes|@-webkit-keyframes|@supports|@charset|@plugin|@namespace|' +
  '@document|@page|@viewport|@-ms-viewport|or|and|when|not';

const LESS_KEYWORDS = new Set(KEYWORDS.split('|'));
const KNOWN_PROPERTIES = new Set(PROPERTIES.split('|'));

/** ACE's keyword mapper: the type of a word whatever its case, a later list's where two have it */
const WORDS = new Map<string, string>();
const WORD_LISTS: Array<[type: string, list: string]> = [
  ['support.constant', CONSTANTS],
  ['keyword', KEYWORDS],
  ['support.constant.color', COLOURS],
  ['support.constant.fonts', FONTS],
];
for (const [type, list] of WORD_LISTS) {
  for (const word of list.toLowerCase().split('|')) WORDS.set(word, type);
}

const NUMBER = '\\-?(?:(?:[0-9]+)|(?:[0-9]*\\.[0-9]+))';

const LESS = aceMode<State>(
  {
    start: {
      rules: [
        { regex: '\\/\\/.*$', token: 'comment' },
        { regex: '\\/\\*', token: 'comment', next: 'comment' },
        { regex: '["](?:(?:\\\\.)|(?:[^"\\\\]))*?["]', token: 'string' },
        { regex: "['](?:(?:\\\\.)|(?:[^'\\\\]))*?[']", token: 'string' },
        {
          regex: `(${NUMBER})(ch|cm|deg|em|ex|fr|gd|grad|Hz|in|kHz|mm|ms|pc|pt|px|rad|rem|s|turn|vh|vm|vw|%)`,
          token: ['constant.numeric', 'keyword'],
        },
        { regex: '#[a-f0-9]{6}', token: 'constant.numeric' },
        { regex: '#[a-f0-9]{3}', token: 'constant.numeric' },
        { regex: NUMBER, token: 'constant.numeric' },
        { regex: '(url)(\\()(.*)(\\))', token: ['support.function', 'paren.lparen', 'string', 'paren.rparen'] },
        { regex: '(:extend|[a-z0-9_\\-]+)(\\()', token: ['support.function', 'paren.lparen'] },
        { regex: '[@\\$][a-z0-9_\\-@\\$]*\\b', token: (value) => (LESS_KEYWORDS.has(value.toLowerCase()) ? 'keyword' : 'variable') },
        { regex: '[@\\$]\\{[a-z0-9_\\-@\\$]*\\}', token: 'variable' },
        {
          regex: '([a-z0-9-_]+)(\\s*:)',
          token: (name) => [KNOWN_PROPERTIES.has(name.toLowerCase()) ? 'support.type.property' : 'support.type.unknownProperty', 'text'],
        },
        { regex: '&', token: 'keyword' },
        { regex: '\\-?[@a-z_][@a-z0-9_\\-]*', token: (value) => WORDS.get(value.toLowerCase()) ?? 'identifier' },
        { regex: '#[a-z0-9-_]+', token: 'variable.language' },
        { regex: '\\.[a-z0-9-_]+', token: 'variable.language' },
        { regex: ':[a-z_][a-z0-9-_]*', token: 'variable.language' },
        { regex: '[a-z0-9-_]+', token: 'constant' },
        { regex: '<|>|<=|>=|=|!=|-|%|\\+|\\*', token: 'keyword.operator' },
        { regex: '[[({]', token: 'paren.lparen' },
        { regex: '[\\])}]', token: 'paren.rparen' },
        { regex: '\\s+', token: 'text' },
      ],
      caseInsensitive: true,
    },
    comment: { rules: [{ regex: '\\*\\/', token: 'comment', next: 'start' }], defaultToken: 'comment' },
  },
  'start'
);

/** One line as ACE reads it in a state: its tokens, those of a type run together, and the state it leaves */
export function aceLessLine(line: string, state: State): { tokens: AceToken[]; state: State } {
  return LESS.line(line, state);
}

const FOLD_START = /([{[(])[^}\])]*$|^\s*(\/\*)/;
const ONE_LINE_COMMENT = /^\s*(\/\*).*\*\/\s*$/;
const TRIPLE_STAR_COMMENT = /^\s*(\/\*\*\*).*\*\/\s*$/;
const REGION = /^\s*(\/\*|\/\/)#?region\b/;

/** The arrow ACE draws in the gutter of a line of less: where a block or a comment opens */
export function aceLessFoldWidget(line: string): 'start' | undefined {
  if (ONE_LINE_COMMENT.test(line) && !REGION.test(line) && !TRIPLE_STAR_COMMENT.test(line)) return undefined;
  return FOLD_START.test(line) || REGION.test(line) ? 'start' : undefined;
}

/** Less as the original's editor colours it, a line at a time */
export function tokenizeAceLess(text: string): CodeToken[][] {
  return aceRuns(LESS, text, 'start', (line) => aceLessFoldWidget(line));
}
