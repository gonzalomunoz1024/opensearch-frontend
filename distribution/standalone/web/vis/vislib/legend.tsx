/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The legend of the classic charts (vislib's VisLegend): a list 150 pixels wide beside the chart,
 * or rows above or below it, of a dot in the series' colour and its name; the button in the
 * chart's corner that opens and closes it; and, on a click on a name, a popover with "Filter for
 * value" and "Filter out value" when the name stands for a bucket, and the 70 colours a series
 * can be given instead of its own.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icon';

/** The colours to pick from: the colour-blind palette in seven turns, darkest first */
export const LEGEND_COLORS = [
  '#2a5a4d', '#304960', '#6a3043', '#49385c', '#654757', '#6b602c', '#5d5444', '#6d4623', '#55332b', '#743326',
  '#387866', '#406180', '#8d4059', '#614b7b', '#875f74', '#8f803a', '#7c705b', '#915d2e', '#714439', '#9a4433',
  '#469580', '#507aa0', '#b05070', '#795d99', '#a87691', '#b29f49', '#9a8c71', '#b6743a', '#8e5448', '#c1553f',
  '#54b399', '#6092c0', '#d36086', '#9170b8', '#ca8eae', '#d6bf57', '#b9a888', '#da8b45', '#aa6556', '#e7664c',
  '#71c0aa', '#7ba4cb', '#da7b9a', '#a388c4', '#d3a1bc', '#ddca73', '#c5b79c', '#e09e64', '#b87f72', '#eb806a',
  '#8dccbb', '#95b7d5', '#e295af', '#b6a0d0', '#dcb4c9', '#e4d48f', '#d0c5b0', '#e7b283', '#c7988f', '#ef9988',
  '#aad9cc', '#b0c9e0', '#e9b0c3', '#c8b8dc', '#e5c7d7', '#ebdfab', '#dcd4c4', '#edc5a2', '#d5b2ab', '#f3b3a6',
];

export type LegendPosition = 'top' | 'bottom' | 'left' | 'right';

/** The series pointed at in a chart or its legend, by its name */
export interface Hover {
  label?: string;
  /** Once a series has been pointed at, the marks keep the opacity it left them */
  touched: boolean;
}

/**
 * The series pointed at after the pointer goes to a series' name, or away (undefined). A series
 * without a name, an empty term, lights nothing up, as vislib's highlight returns at an empty
 * data-label; going away gives every mark its opacity all the same, as its unHighlight does
 */
export function hoverAfter(current: Hover, label: string | undefined): Hover {
  if (label === '') return current;
  return label === undefined ? { touched: true } : { label, touched: true };
}

/** The side the popover of a name opens to, from the side the legend is on: below it when the chart says none */
const anchorOf = (position: LegendPosition | undefined) =>
  position === 'bottom' ? 'upCenter' : position === 'left' ? 'rightUp' : position === 'right' ? 'leftUp' : 'downCenter';

export interface VisLegendProps {
  labels: string[];
  colorOf: (label: string) => string;
  /** The side of the chart it is on, as the visualization says it; a gauge says none */
  position?: LegendPosition;
  open: boolean;
  onToggle: () => void;
  /** How see-through a name is while a series is pointed at; undefined leaves it alone */
  opacityOf?: (label: string) => number | undefined;
  onHighlight?: (label: string | undefined) => void;
  /** Whether a name stands for a bucket that can be filtered on */
  canFilter?: (label: string) => boolean;
  onFilter?: (label: string, negate: boolean) => void;
  /** Picks a colour for a name; the colour it has already takes it off */
  onColor?: (label: string, color: string) => void;
}

function LegendDot({ color, className, ...rest }: { color: string; className?: string } & Record<string, unknown>) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className={className} style={{ color }} {...rest}>
      <circle cx="8" cy="8" r="4" />
    </svg>
  );
}

/** A popover beside its anchor, as the original's opens on the side away from the legend */
function LegendPopover({
  anchor,
  side,
  onClose,
  children,
}: {
  anchor: HTMLElement | null;
  side: ReturnType<typeof anchorOf>;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    const box = anchor?.getBoundingClientRect();
    const own = panel.current?.getBoundingClientRect();
    if (!box || !own) return;
    const gap = 8;
    let left: number;
    let top: number;
    if (side === 'leftUp' || side === 'rightUp') {
      left = side === 'leftUp' ? box.left - gap - own.width : box.right + gap;
      // Its arrow, 10 pixels down and 24 high, points at the middle of the name
      top = box.top + box.height / 2 - 22;
    } else {
      left = box.left + box.width / 2 - own.width / 2;
      top = side === 'upCenter' ? box.top - gap - own.height : box.bottom + gap;
    }
    const buffer = 16;
    left = Math.max(buffer, Math.min(left, window.innerWidth - own.width - buffer));
    top = Math.max(buffer, Math.min(top, window.innerHeight - own.height - buffer));
    setPlace({ left, top });
  }, [anchor, side]);
  // Once it shows, the first thing in it that takes the keyboard has it
  const shown = place !== undefined;
  useEffect(() => {
    if (shown) panel.current?.querySelector<HTMLElement>('button, [tabindex="0"]')?.focus();
  }, [shown]);
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={panel}
      className="visLegend__popover"
      role="dialog"
      aria-modal="true"
      style={{ left: place?.left ?? -9999, top: place?.top ?? -9999, visibility: place ? 'visible' : 'hidden' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          anchor?.querySelector('button')?.focus();
        }
      }}
    >
      {children}
    </div>,
    document.body
  );
}

export function VisLegend({
  labels,
  colorOf,
  position,
  open,
  onToggle,
  opacityOf,
  onHighlight,
  canFilter,
  onFilter,
  onColor,
}: VisLegendProps) {
  const legendId = useId();
  const [selected, setSelected] = useState<string>();
  const anchors = useRef(new Map<string, HTMLDivElement>());
  const side = anchorOf(position);
  const select = (label: string | undefined) => setSelected((current) => (current === label ? undefined : label));
  // Escape on a name closes its popover
  const onNameKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setSelected(undefined);
    }
  };
  return (
    <div className="visLegend">
      <span className="visLegend__toggleTooltipAnchor">
        <button
          type="button"
          onClick={onToggle}
          className={`visLegend__toggle${open ? ' visLegend__toggle--isOpen' : ''}`}
          aria-label="Toggle legend"
          aria-expanded={open}
          aria-controls={legendId}
          title="Toggle legend"
          data-test-subj="vislibToggleLegend"
        >
          <Icon name="list" />
        </button>
      </span>
      {open && (
        <ul className="visLegend__list" id={legendId} data-test-subj="legendContainer">
          {labels.map((label) => {
            const color = colorOf(label);
            const opacity = opacityOf?.(label);
            const filterable = Boolean(canFilter?.(label));
            return (
              <li key={label} className="visLegend__value">
                <div
                  className="visLegend__anchor"
                  ref={(element) => {
                    if (element) anchors.current.set(label, element);
                    else anchors.current.delete(label);
                  }}
                >
                  <button
                    type="button"
                    className="visLegend__button"
                    data-label={label}
                    title={label}
                    aria-label={`${label}, toggle options`}
                    data-test-subj={`legend-${label}`}
                    style={opacity === undefined ? undefined : { opacity }}
                    onKeyDown={onNameKey}
                    onMouseEnter={() => onHighlight?.(label)}
                    onFocus={() => onHighlight?.(label)}
                    onMouseLeave={() => onHighlight?.(undefined)}
                    onBlur={() => onHighlight?.(undefined)}
                    onClick={() => select(label)}
                  >
                    <span className="visLegend__buttonContent">
                      <span className="visLegend__buttonText">
                        <LegendDot color={color} className="visLegend__dot" data-test-subj={`legendSelectedColor-${color}`} />
                        <span className="visLegend__valueTitle">{label}</span>
                      </span>
                    </span>
                  </button>
                </div>
                {selected === label && (
                  <LegendPopover anchor={anchors.current.get(label) ?? null} side={side} onClose={() => setSelected(undefined)}>
                    <div className="visLegend__valueDetails">
                      {filterable && (
                        <>
                          <div className="visLegend__filters" role="group" aria-label={`${label}, filter options`} data-test-subj={`legend-${label}-filters`}>
                            <button
                              type="button"
                              className="visLegend__filter"
                              aria-label={`Filter for value ${label}`}
                              title={`Filter for value ${label}`}
                              data-test-subj={`legend-${label}-filterIn`}
                              onClick={() => onFilter?.(label, false)}
                            >
                              <Icon name="plusCircle" />
                            </button>
                            <button
                              type="button"
                              className="visLegend__filter"
                              aria-label={`Filter out value ${label}`}
                              title={`Filter out value ${label}`}
                              data-test-subj={`legend-${label}-filterOut`}
                              onClick={() => onFilter?.(label, true)}
                            >
                              <Icon name="minusCircle" />
                            </button>
                          </div>
                          <div className="visLegend__spacer" />
                        </>
                      )}
                      <div className="visLegend__valueColorPicker" role="listbox">
                        <span id={`${legendId}ColorPickerDesc`} className="atlScreenReaderOnly">
                          Set color for value {label}
                        </span>
                        {LEGEND_COLORS.map((choice) => {
                          const isSelected = choice === color;
                          const pick = () => onColor?.(label, choice);
                          return (
                            <LegendDot
                              key={choice}
                              color={choice}
                              role="option"
                              tabIndex={0}
                              aria-label={choice}
                              aria-describedby={`${legendId}ColorPickerDesc`}
                              aria-selected={isSelected}
                              className={`visLegend__valueColorPickerDot${isSelected ? ' visLegend__valueColorPickerDot-isSelected' : ''}`}
                              data-test-subj={`legendSelectColor-${choice}`}
                              onClick={pick}
                              onKeyPress={(event: KeyboardEvent) => {
                                if (event.key === 'Enter') pick();
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </LegendPopover>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
