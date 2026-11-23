/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Numbers written by a pattern such as "0,0.[000]", "0.0%", "0.[0]b" or "$0,0.00": the pattern
 * language OpenSearch Dashboards uses for a field's number format, read step by step as the
 * numeral library it comes from (@elastic/numeral 2.5.1, its English language) reads it: a
 * currency sign, then a percent sign, then a colon, then a "b" choose how the number is written;
 * then parentheses or a plus, an abbreviation (1.2k), an ordinal, the decimals after the first
 * point, thousands separators. Other letters of a pattern are not written, as numeral writes none.
 */

const ABBREVIATIONS = { thousand: 'k', million: 'm', billion: 'b', trillion: 't' };

/**
 * numeral's toFixed: the value moved by its decimals as text, rounded half up with its sign, so
 * that 1.005 is 1.01 and -2.5 is -2; optional decimals that end in zeros are left out
 */
function toFixed(value: number, maxDecimals: number, optionals = 0): string {
  const split = value.toString().split('.');
  const minDecimals = maxDecimals - optionals;
  // The fewest decimals the value has, within those asked for
  const bounded = split.length === 2 ? Math.min(Math.max(split[1].length, minDecimals), maxDecimals) : minDecimals;
  const power = Math.pow(10, bounded);
  let output = (Math.round(Number(`${value}e+${bounded}`)) / power).toFixed(bounded);
  if (optionals > maxDecimals - bounded) {
    output = output.replace(new RegExp(`\\.?0{1,${optionals - (maxDecimals - bounded)}}$`), '');
  }
  return output;
}

// numeral's English ordinal, of the value as it is, not as it is rounded: 3.14 is "3th"
function ordinal(value: number): string {
  const last = value % 10;
  if (Math.trunc((value % 100) / 10) === 1) return 'th';
  return last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
}

/** numeral's formatNumber: a plain number, after the signs of currency, percent and bytes are taken out */
function plainNumber(input: number, pattern: string): string {
  let value = input;
  let format = pattern;
  let parentheses = false;
  let signed = false;
  let optionalPoint = false;
  let abbreviation = '';
  let ordinalText = '';
  let decimals = '';
  let negative = false;
  const abs = Math.abs(value);
  // What JavaScript writes with an exponent is written so, before it is abbreviated
  const exponent = /e[+-]/.test(value.toString());

  // Parentheses for a negative number, or a sign for every one; parentheses when both
  if (format.indexOf('(') > -1) {
    parentheses = true;
    format = format.slice(1, -1);
  } else if (format.indexOf('+') > -1) {
    signed = true;
    format = format.replace(/\+/g, '');
  }

  if (format.indexOf('a') > -1) {
    const toThousands = format.indexOf('aK') >= 0;
    const toMillions = format.indexOf('aM') >= 0;
    const toBillions = format.indexOf('aB') >= 0;
    const toTrillions = format.indexOf('aT') >= 0;
    const forced = toThousands || toMillions || toBillions || toTrillions;
    if (format.indexOf(' a') > -1) {
      abbreviation = ' ';
      format = format.replace(' a', '');
    } else {
      format = format.replace('a', '');
    }
    if ((abs >= Math.pow(10, 12) && !forced) || toTrillions) {
      abbreviation += ABBREVIATIONS.trillion;
      value /= Math.pow(10, 12);
    } else if ((abs < Math.pow(10, 12) && abs >= Math.pow(10, 9) && !forced) || toBillions) {
      abbreviation += ABBREVIATIONS.billion;
      value /= Math.pow(10, 9);
    } else if ((abs < Math.pow(10, 9) && abs >= Math.pow(10, 6) && !forced) || toMillions) {
      abbreviation += ABBREVIATIONS.million;
      value /= Math.pow(10, 6);
    } else if ((abs < Math.pow(10, 6) && abs >= Math.pow(10, 3) && !forced) || toThousands) {
      abbreviation += ABBREVIATIONS.thousand;
      value /= Math.pow(10, 3);
    }
  }

  if (format.indexOf('o') > -1) {
    if (format.indexOf(' o') > -1) {
      ordinalText = ' ';
      format = format.replace(' o', '');
    } else {
      format = format.replace('o', '');
    }
    ordinalText += ordinal(value);
  }

  // "[.]": the point and the decimals only when they are not all zeros
  if (format.indexOf('[.]') > -1) {
    optionalPoint = true;
    format = format.replace('[.]', '.');
  }

  let whole: string;
  // Everything after the first point counts as a decimal, letters too: "0.0e+0" has three
  const precision = format.split('.')[1];
  if (precision && !exponent) {
    if (precision.indexOf('[') > -1) {
      const [fixed, optional = ''] = precision.replace(']', '').split('[');
      decimals = toFixed(value, fixed.length + optional.length, optional.length);
    } else {
      decimals = toFixed(value, precision.length);
    }
    whole = decimals.split('.')[0];
    const fraction = decimals.indexOf('.') !== -1 ? decimals.split('.')[1] : '';
    decimals = fraction.length ? `.${fraction}` : '';
    if (optionalPoint && Number(decimals.slice(1)) === 0) decimals = '';
  } else {
    // An exponent is written as JavaScript writes it, anything else without decimals
    whole = exponent ? value.toString() : toFixed(value, 0);
  }

  if (whole.indexOf('-') === 0) {
    whole = whole.slice(1);
    negative = true;
  }
  if (format.indexOf(',') > -1) whole = whole.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
  // A pattern that starts with its point writes no whole part
  if (format.indexOf('.') === 0) whole = '';

  return (
    (parentheses && negative ? '(' : '') +
    (!parentheses && negative ? '-' : '') +
    (!negative && signed ? '+' : '') +
    whole +
    decimals +
    ordinalText +
    abbreviation +
    (parentheses && negative ? ')' : '')
  );
}

function currency(value: number, pattern: string): string {
  const symbolIndex = pattern.indexOf('$');
  const openParenIndex = pattern.indexOf('(');
  const minusSignIndex = pattern.indexOf('-');
  let format = pattern;
  let space = '';
  if (format.indexOf(' $') > -1) {
    space = ' ';
    format = format.replace(' $', '');
  } else if (format.indexOf('$ ') > -1) {
    space = ' ';
    format = format.replace('$ ', '');
  } else {
    format = format.replace('$', '');
  }
  const output = plainNumber(value, format);
  // The sign where the pattern has it: before the number, or after it
  if (symbolIndex <= 1) {
    if (output.indexOf('(') > -1 || output.indexOf('-') > -1) {
      const characters = output.split('');
      characters.splice(symbolIndex < openParenIndex || symbolIndex < minusSignIndex ? 0 : 1, 0, `$${space}`);
      return characters.join('');
    }
    return `$${space}${output}`;
  }
  if (output.indexOf(')') > -1) {
    const characters = output.split('');
    characters.splice(-1, 0, `${space}$`);
    return characters.join('');
  }
  return `${output}${space}$`;
}

function percentage(value: number, pattern: string): string {
  let format = pattern;
  let space = '';
  if (format.indexOf(' %') > -1) {
    space = ' ';
    format = format.replace(' %', '');
  } else {
    format = format.replace('%', '');
  }
  const output = plainNumber(value * 100, format);
  if (output.indexOf(')') > -1) {
    const characters = output.split('');
    characters.splice(-1, 0, `${space}%`);
    return characters.join('');
  }
  return `${output}${space}%`;
}

// numeral's formatTime, for a pattern with a colon: the value as seconds, written as whole hours,
// minutes and rounded seconds, whatever else the pattern says ("00:00:00" writes 3725 as 1:02:05)
function time(value: number): string {
  const total = Math.abs(value);
  const hours = Math.floor(total / 60 / 60);
  const minutes = Math.floor((total - hours * 60 * 60) / 60);
  const seconds = Math.round(total - hours * 60 * 60 - minutes * 60);
  const twoDigits = (part: number) => (part < 10 ? `0${part}` : String(part));
  return `${value < 0 ? '-' : ''}${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
}

const BYTE_SUFFIXES = {
  binary: ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
  decimal: ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
  iec: ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'],
  bits: ['bit', 'kbit', 'Mbit', 'Gbit', 'Tbit', 'Pbit', 'Ebit', 'Zbit', 'Ybit'],
  iecBits: ['bit', 'Kibit', 'Mibit', 'Gibit', 'Tibit', 'Pibit', 'Eibit', 'Zibit', 'Yibit'],
};

/**
 * Bytes and bits: "b" counts by 1024 (KB), "bb" by 1024 with the IEC names (KiB), "bd" by 1000
 * (kB); "bitb" and "bitd" are bits by 1024 and by 1000
 */
function bytes(input: number, pattern: string): string {
  let format = pattern;
  let space = '';
  let decimal = false;
  let standard = false;
  let bits = false;
  const takeOut = (unit: string) => {
    if (format.indexOf(` ${unit}`) > -1) {
      space = ' ';
      format = format.replace(` ${unit}`, '');
    } else {
      format = format.replace(unit, '');
    }
  };
  if (format.indexOf('bitd') > -1) {
    takeOut('bitd');
    decimal = true;
    standard = true;
    bits = true;
  } else if (format.indexOf('bitb') > -1) {
    takeOut('bitb');
    standard = true;
    bits = true;
  } else if (format.indexOf('bd') > -1) {
    takeOut('bd');
    decimal = true;
    standard = true;
  } else if (format.indexOf('bb') > -1) {
    takeOut('bb');
    standard = true;
  } else {
    takeOut('b');
  }
  const base = decimal ? 1000 : 1024;
  const suffixes = bits
    ? decimal
      ? BYTE_SUFFIXES.bits
      : BYTE_SUFFIXES.iecBits
    : !decimal && standard
      ? BYTE_SUFFIXES.iec
      : decimal
        ? BYTE_SUFFIXES.decimal
        : BYTE_SUFFIXES.binary;
  let value = input;
  let suffix = suffixes[0];
  const abs = Math.abs(input);
  if (!(abs < base)) {
    let matched = false;
    for (let power = 1; power < suffixes.length; power += 1) {
      const min = Math.pow(base, power);
      if (abs >= min && abs < Math.pow(base, power + 1)) {
        matched = true;
        suffix = suffixes[power];
        value = input / min;
        break;
      }
    }
    // At or above 1024 (or 1000) of the largest unit: still in that unit
    if (!matched) {
      value = input / Math.pow(base, suffixes.length - 1);
      suffix = suffixes[suffixes.length - 1];
    }
  }
  return `${plainNumber(value, format)}${space}${suffix}`;
}

export function formatNumber(value: number, pattern: string): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return String(value);
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  // As numeral chooses: a currency sign first, then a percent sign, a colon and a "b"; numeral
  // writes an empty pattern as its default, 0,0
  const format = pattern || '0,0';
  if (format.indexOf('$') > -1) return currency(value, format);
  if (format.indexOf('%') > -1) return percentage(value, format);
  if (format.indexOf(':') > -1) return time(value);
  if (format.indexOf('b') > -1) return bytes(value, format);
  return plainNumber(value, format);
}
