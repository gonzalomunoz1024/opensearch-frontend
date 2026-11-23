/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The token that says what kind of field a field is, as OpenSearch Dashboards draws it: the token
 * of its component library, in the colour that library gives the kind, with its glyph.
 */

interface Glyph {
  d: string;
  evenOdd?: boolean;
  /** An icon of the library that is not a token's own, drawn 12 pixels wide as it draws one */
  small?: boolean;
}

type GlyphName = 'string' | 'number' | 'date' | 'geo' | 'ip' | 'boolean' | 'nested' | 'file' | 'codeBlock' | 'question' | 'alert';

// The glyphs of the OpenSearch UI framework (Apache-2.0) for these tokens, on its 16 pixel grid
const GLYPHS: Record<GlyphName, Glyph> = {
  string: {
    d: 'm9.147 4.297-.255 1.455h.936l-.222 1.266h-.935l-.455 2.688c-.025.184-.013.323.036.417.048.093.17.144.365.151.075.004.23-.005.465-.027l-.13 1.32c-.3.097-.618.142-.957.135-.552-.007-.965-.17-1.239-.487-.274-.317-.386-.748-.335-1.293l.476-2.904h-.725l.216-1.266h.725l.254-1.455h1.78Z',
  },
  number: {
    d: 'M7.8 9.812h-.842l-.78 2.335H5.031l.78-2.335H4.6l.182-1.043h1.373l.507-1.504H5.454l.188-1.042h1.367l.792-2.37H8.94l-.792 2.37h.849l.792-2.37h1.145l-.792 2.37H11.4l-.182 1.042H9.8L9.293 8.77h1.248l-.183 1.043H8.946l-.775 2.335H7.026L7.8 9.812Zm-.5-1.043h.842l.513-1.504h-.849L7.3 8.77Z',
  },
  date: {
    d: 'M13 11.567C13 12.36 12.36 13 11.567 13H4.433C3.64 13 3 12.36 3 11.567V4.433C3 3.64 3.64 3 4.433 3H6v-.495a.51.51 0 0 1 .412-.497L6.5 2c.276 0 .5.214.5.505V3h2v-.495a.51.51 0 0 1 .412-.497L9.5 2c.276 0 .5.214.5.505V3h1.567C12.36 3 13 3.64 13 4.433v7.134ZM4 6v5.33c0 .37.3.67.67.67h6.66c.37 0 .67-.3.67-.67V6H4Zm1.5 4c.245 0 .45.183.492.412L6 10.5c0 .245-.183.45-.412.492L5.5 11a.505.505 0 0 1-.5-.5c0-.245.183-.45.412-.492L5.5 10ZM8 10c.245 0 .45.183.492.412l.008.088c0 .245-.183.45-.412.492L8 11a.505.505 0 0 1-.5-.5c0-.245.183-.45.412-.492L8 10Zm2.5 0c.245 0 .45.183.492.412L11 10.5c0 .245-.183.45-.412.492L10.5 11a.505.505 0 0 1-.5-.5c0-.245.183-.45.412-.492L10.5 10Zm-5-1.5c.245 0 .45.183.492.412L6 9c0 .245-.183.45-.412.492L5.5 9.5A.505.505 0 0 1 5 9c0-.245.183-.45.412-.492L5.5 8.5Zm2.5 0c.245 0 .45.183.492.412L8.5 9c0 .245-.183.45-.412.492L8 9.5a.505.505 0 0 1-.5-.5c0-.245.183-.45.412-.492L8 8.5Zm2.5 0c.245 0 .45.183.492.412L11 9c0 .245-.183.45-.412.492L10.5 9.5A.505.505 0 0 1 10 9c0-.245.183-.45.412-.492L10.5 8.5ZM5.5 7c.245 0 .45.183.492.412L6 7.5c0 .245-.183.45-.412.492L5.5 8a.505.505 0 0 1-.5-.5c0-.245.183-.45.412-.492L5.5 7ZM8 7c.245 0 .45.183.492.412L8.5 7.5c0 .245-.183.45-.412.492L8 8a.505.505 0 0 1-.5-.5c0-.245.183-.45.412-.492L8 7Zm2.5 0c.245 0 .45.183.492.412L11 7.5c0 .245-.183.45-.412.492L10.5 8a.505.505 0 0 1-.5-.5c0-.245.183-.45.412-.492L10.5 7ZM4 5h8v-.33c0-.37-.3-.67-.67-.67H4.67C4.3 4 4 4.3 4 4.67V5Z',
    evenOdd: true,
  },
  geo: {
    d: 'M8 3c1.636 0 3.088.785 4 2 .628.836 1 1.875 1 3a4.978 4.978 0 0 1-.999 3H12a4.992 4.992 0 0 1-4 2 4.992 4.992 0 0 1-4-1.999V11a5 5 0 0 1 4-8Zm.948 8H7.052c.277.626.623 1 .948 1 .325 0 .67-.374.948-1ZM6 11l-.645.001c.274.242.581.446.914.606A5.445 5.445 0 0 1 6 11.001Zm4.645.001H10a5.51 5.51 0 0 1-.269.606c.333-.16.64-.364.914-.606Zm-5.133-2.5H4.031c.068.54.243 1.048.505 1.5h1.172a9.186 9.186 0 0 1-.196-1.5Zm3.975 0H6.513c.03.544.104 1.05.21 1.5h2.553c.107-.45.182-.956.21-1.5Zm2.482 0h-1.481a9.186 9.186 0 0 1-.196 1.5h1.172c.262-.452.437-.96.505-1.5ZM5.708 6 4.535 6c-.261.452-.437.96-.504 1.5h1.481A9.187 9.187 0 0 1 5.708 6Zm3.568 0H6.724c-.107.449-.182.955-.21 1.499h2.973a8.479 8.479 0 0 0-.21-1.5ZM11.465 6h-1.173c.102.467.17.972.196 1.5h1.481a3.974 3.974 0 0 0-.504-1.5ZM6.269 4.393l-.124.062c-.286.15-.551.333-.79.545H6a5.51 5.51 0 0 1 .269-.607ZM8 4c-.326 0-.671.375-.948 1h1.896C8.671 4.376 8.326 4 8 4Zm1.73.393.038.071c.083.168.161.347.232.536h.646a4.006 4.006 0 0 0-.915-.607Z',
    evenOdd: true,
  },
  ip: {
    d: 'M11 3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6Zm-1 2H8v6h1V9.014h1c.298-.013 2 0 2-2.018 0-1.74-1.314-1.952-1.825-1.987L10 5ZM6 5H5v6h1V5Zm4 .984c.667 0 1 .336 1 1.008C11 7.664 10.667 8 10 8H9V5.984Z',
    evenOdd: true,
  },
  boolean: {
    d: 'M8 13A5 5 0 1 1 8 3a5 5 0 0 1 0 10Zm-2.828-2.172a4 4 0 0 1 5.656-5.656c.004.013-5.645 5.674-5.656 5.656Z',
    evenOdd: true,
  },
  nested: {
    d: 'M11 3c1.044 0 1.913.757 1.994 1.736l.006.149v6.23c0 1-.82 1.805-1.845 1.88L11 13H9.501a.5.5 0 0 1-.09-.992l.09-.008H11c.52 0 .937-.35.993-.783l.007-.102v-6.23c0-.445-.379-.827-.882-.879L11 4H9.5a.5.5 0 0 1-.09-.992L9.5 3H11ZM6.5 3a.5.5 0 0 1 .09.992L6.5 4H5c-.52 0-.937.35-.993.783L4 4.885v6.23c0 .445.379.827.882.879L5 12h1.5a.5.5 0 0 1 .09.992L6.5 13H5c-1.044 0-1.913-.757-1.994-1.736L3 11.115v-6.23c0-1 .82-1.805 1.845-1.88L5 3h1.5ZM5.864 7.25a.714.714 0 1 1 0 1.429.714.714 0 0 1 0-1.429Zm2.143 0a.714.714 0 1 1 0 1.429.714.714 0 0 1 0-1.429Zm2.143 0a.714.714 0 1 1 0 1.429.714.714 0 0 1 0-1.429Z',
    evenOdd: true,
  },
  file: {
    d: 'M9.867 2.667H4a.667.667 0 0 0-.667.666v9.334c0 .368.299.666.667.666h8a.667.667 0 0 0 .667-.666V5.619a.669.669 0 0 0-.183-.459l-2.133-2.285a.668.668 0 0 0-.484-.208m1.466 4V12H4.667V4h4v2.333c0 .184.149.334.333.334h2.333Z',
  },
  codeBlock: {
    d: 'M2.414 8.036 4.89 10.51a.5.5 0 0 1-.707.708L1.354 8.389a.5.5 0 0 1 0-.707l2.828-2.828a.5.5 0 1 1 .707.707L2.414 8.036Zm8.768 2.474 2.475-2.474-2.475-2.475a.5.5 0 0 1 .707-.707l2.829 2.828a.5.5 0 0 1 0 .707l-2.829 2.829a.5.5 0 1 1-.707-.708ZM8.559 2.506a.5.5 0 0 1 .981.19L7.441 13.494a.5.5 0 0 1-.981-.19L8.559 2.506Z',
    small: true,
  },
  question: {
    d: 'M8 14A6 6 0 1 1 8 2a6 6 0 0 1 0 12Zm0-1A5 5 0 1 0 8 3a5 5 0 0 0 0 10Zm-.186-1.065A.785.785 0 0 1 7 11.12c0-.48.34-.82.814-.82.475 0 .809.34.809.82 0 .475-.334.815-.809.815ZM5.9 6.317C5.96 5.168 6.755 4.4 8.048 4.4c1.218 0 2.091.759 2.091 1.8 0 .736-.36 1.304-1.03 1.707-.56.33-.717.56-.717 1.022v.305l-.1.1H7.47l-.1-.1v-.431c-.005-.646.302-1.104.987-1.514.527-.322.708-.59.708-1.047 0-.536-.416-.91-1.05-.91-.652 0-1.064.374-1.112.998l-.1.092H6l-.1-.105Z',
    small: true,
  },
  alert: {
    d: 'M7.59 10.059 7.35 5.18h1.3L8.4 10.06h-.81Zm.394 1.901a.61.61 0 0 1-.448-.186.606.606 0 0 1-.186-.444c0-.174.062-.323.186-.446a.614.614 0 0 1 .448-.184c.169 0 .315.06.44.182.124.122.186.27.186.448a.6.6 0 0 1-.189.446.607.607 0 0 1-.437.184ZM2 14a1 1 0 0 1-.878-1.479l6-11a1 1 0 0 1 1.756 0l6 11A1 1 0 0 1 14 14H2Zm0-1h12L8 2 2 13Z',
    evenOdd: true,
    small: true,
  },
};

interface TokenLook {
  /** The kind's colours, from tokens.css */
  color: 'number' | 'string' | 'nested' | 'geo' | 'date' | 'boolean' | 'ip' | 'gray' | 'none';
  shape: 'square' | 'circle' | 'rectangle';
  glyph: GlyphName;
  solid?: boolean;
}

// As the original picks a token for a kind of field
const LOOKS: Record<string, TokenLook> = {
  boolean: { color: 'boolean', shape: 'square', glyph: 'boolean' },
  // The original names a colour its library does not know: the token has no fill
  conflict: { color: 'none', shape: 'circle', glyph: 'alert' },
  date: { color: 'date', shape: 'square', glyph: 'date' },
  geo_point: { color: 'geo', shape: 'square', glyph: 'geo' },
  geo_shape: { color: 'geo', shape: 'square', glyph: 'geo' },
  ip: { color: 'ip', shape: 'square', glyph: 'ip' },
  murmur3: { color: 'gray', shape: 'rectangle', glyph: 'file', solid: true },
  number: { color: 'number', shape: 'square', glyph: 'number' },
  _source: { color: 'gray', shape: 'circle', glyph: 'codeBlock' },
  string: { color: 'string', shape: 'square', glyph: 'string' },
  nested: { color: 'nested', shape: 'circle', glyph: 'nested' },
};

const UNKNOWN: TokenLook = { color: 'gray', shape: 'circle', glyph: 'question' };

const TYPE_NAMES: Record<string, string> = {
  boolean: 'Boolean field',
  conflict: 'Conflicting field',
  date: 'Date field',
  geo_point: 'Geo point field',
  geo_shape: 'Geo shape field',
  ip: 'IP address field',
  murmur3: 'Murmur3 field',
  number: 'Number field',
  source: 'Source field',
  string: 'String field',
  nested: 'Nested field',
};

/** What the original calls a kind of field on its token */
export function fieldTypeName(type: string): string {
  return TYPE_NAMES[type] ?? 'Unknown field';
}

/** The small mark that says what kind of field a field is; a scripted field's is filled */
export function FieldToken({
  type,
  scripted = false,
  plain = false,
}: {
  type: string;
  scripted?: boolean;
  /** Without fill and in gray, as the original's table of a document's fields draws every kind */
  plain?: boolean;
}) {
  const look = LOOKS[type] ?? UNKNOWN;
  const glyph = GLYPHS[look.glyph];
  const name = fieldTypeName(type);
  const classes = ['atlToken', plain ? 'atlToken--plain' : `atlToken--${look.color}`, `atlToken--${look.shape}`];
  if (!plain && (look.solid || scripted)) classes.push('atlToken--solid');
  return (
    <span className={classes.join(' ')} title={name} aria-label={name} role="img" data-type={type}>
      <svg className={glyph.small ? 'atlToken__glyph atlToken__glyph--small' : 'atlToken__glyph'} viewBox="0 0 16 16" aria-hidden>
        <path d={glyph.d} fillRule={glyph.evenOdd ? 'evenodd' : undefined} />
      </svg>
    </span>
  );
}
