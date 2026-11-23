/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Share: the original's popover under the Share button of the top navigation, its menu of the
 * ways to share (the share plugin's `ShareContextMenu`), and the panels that make a link
 * (`UrlPanelContent`): the page as it is or its saved object, a short URL, and for a
 * visualization or a dashboard the code that embeds it.
 */

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Button, cx } from '../components/basic';
import { Switch } from '../components/form';
import { Icon, type IconName } from '../components/icon';
import { tabbablesIn } from '../components/layers';
import { Popover, Tooltip } from '../components/overlay';
import { placeLikeOriginal } from '../components/placement';
import { EMBED_DEFAULTS, iframeTag, savedObjectUrl, snapshotUrl, type EmbedOptions } from '../lib/share_url';
import { useLocation } from '../router';
import { services } from '../services';
import { HttpFetchError, errorMessage } from '../services/http';
import { shortenUrl } from '../services/short_urls';

/** The top navigation's Share button: the original's popover hangs from the button that opened it */
const SHARE_BUTTON = '[data-test-subj="shareTopNavButton"]';

const shareButton = () => document.querySelector<HTMLElement>(SHARE_BUTTON);

/** The original's tips behind the question marks */
const SNAPSHOT_TIP = (objectType: string) =>
  `Snapshot URLs encode the current state of the ${objectType} in the URL itself. Edits to the saved ${objectType} won't be visible via this URL.`;
const SAVED_OBJECT_TIP = (objectType: string) =>
  `You can share this URL with people to let them load the most recent saved version of this ${objectType}.`;
const SHORT_URL_TIP =
  "We recommend sharing shortened snapshot URLs for maximum compatibility. Internet Explorer has URL length restrictions, and some wiki and markup parsers don't do well with the full-length version of the snapshot URL, but the short URL should work great.";

/** A dashboard's "Include" options, as the original's dashboard hands them to its embed code */
const EMBED_OPTIONS: ReadonlyArray<{ key: keyof EmbedOptions; label: string }> = [
  { key: 'topMenu', label: 'Top menu' },
  { key: 'query', label: 'Query' },
  { key: 'timeFilter', label: 'Time filter' },
  { key: 'filterBar', label: 'Filter bar' },
];

type PanelId = 'menu' | 'permalink' | 'embed';

/** The menu's items, in the original's order (by their names): the panel each one opens */
const ITEMS: ReadonlyArray<{ panel: Exclude<PanelId, 'menu'>; label: string; icon: IconName }> = [
  { panel: 'embed', label: 'Embed code', icon: 'embed' },
  { panel: 'permalink', label: 'Permalinks', icon: 'link' },
];

const TITLES: Record<Exclude<PanelId, 'menu'>, string> = { embed: 'Embed Code', permalink: 'Permalink' };

export interface ShareMenuProps {
  /** What is shared, in the words of the original's texts: search, visualization or dashboard */
  objectType: string;
  /**
   * The address of the saved object, when there is one: only then can its link be made, from the
   * page's address as the original makes it
   */
  savedUrl?: string;
  onClose: () => void;
}

/**
 * The original's share popover, under the Share button of the top navigation, as wide as its
 * menu (256 px). A search has its permalinks only; a visualization and a dashboard have a menu of
 * their permalinks and their embed code, and a dashboard's embed code has options.
 */
export function ShareMenu({ objectType, savedUrl, onClose }: ShareMenuProps) {
  // Under the Share button wherever it is now, as the original's hangs from it
  const placeAt = useCallback((anchor: DOMRect, panel: { width: number; height: number }) => {
    const box = shareButton()?.getBoundingClientRect() ?? anchor;
    const at = placeLikeOriginal(box, panel, 'downLeft', { width: window.innerWidth, height: window.innerHeight });
    return { ...at, side: at.top < box.top ? ('top' as const) : ('bottom' as const) };
  }, []);

  // The Share button closes what it opened, as the original's: a press of it is not a click
  // outside the popover, which would close it only for the button to open it again
  useEffect(() => {
    const onButton = (event: MouseEvent) => event.target instanceof Node && Boolean(shareButton()?.contains(event.target));
    const onDown = (event: MouseEvent) => {
      if (onButton(event)) event.stopPropagation();
    };
    const onClick = (event: MouseEvent) => {
      if (!onButton(event)) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [onClose]);

  return (
    <Popover
      open
      onClose={onClose}
      button={null}
      anchorStyle={{ display: 'none' }}
      placeAt={placeAt}
      width={256}
      className="atlPopover--placed shlShare"
    >
      <ShareContextMenu objectType={objectType} savedUrl={savedUrl} />
    </Popover>
  );
}

/** As the original's `EuiContextMenu` of small rows: the menu, and a panel of links in its place */
function ShareContextMenu({ objectType, savedUrl }: { objectType: string; savedUrl?: string }) {
  // As the original's callers: a search has no embed code, a dashboard's has its options
  const allowEmbed = objectType !== 'search';
  const [shown, setShown] = useState<PanelId>(allowEmbed ? 'menu' : 'permalink');
  const menu = useRef<HTMLDivElement>(null);
  // Where the focus goes once the panel is shown: into a panel of links, or back to the menu,
  // on the item that opened the panel when the keyboard went back and on the menu for a click
  const focusNext = useRef<{ to: 'content' } | { to: 'item'; panel: PanelId } | { to: 'menu' }>();

  useEffect(() => {
    const next = focusNext.current;
    const element = menu.current;
    focusNext.current = undefined;
    if (!next || !element) return;
    if (next.to === 'content') {
      const content = element.querySelector<HTMLElement>('.shlShare__form');
      (content && tabbablesIn(content)[0])?.focus({ preventScroll: true });
    } else if (next.to === 'item') {
      element.querySelector<HTMLElement>(`[data-panel="${next.panel}"]`)?.focus({ preventScroll: true });
    } else {
      element.focus({ preventScroll: true });
    }
  }, [shown]);

  const open = (panel: Exclude<PanelId, 'menu'>) => {
    focusNext.current = { to: 'content' };
    setShown(panel);
  };
  const back = (byKeyboard: boolean) => {
    focusNext.current = byKeyboard ? { to: 'item', panel: shown } : { to: 'menu' };
    setShown('menu');
  };

  // As the original's menu: the arrows go down and up its items, round from the last to the
  // first; right opens the panel of the item that has the focus, left goes back from the title
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const element = menu.current;
    if (!element || event.defaultPrevented) return;
    if (shown !== 'menu') {
      if (event.key === 'ArrowLeft' && allowEmbed && document.activeElement?.classList.contains('atlContextMenu__back')) {
        event.preventDefault();
        back(true);
      }
      return;
    }
    const items = [...element.querySelectorAll<HTMLElement>('.atlContextMenu__item')];
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'ArrowRight') {
      const panel = items[index]?.dataset.panel;
      if (panel !== 'embed' && panel !== 'permalink') return;
      event.preventDefault();
      open(panel);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = index < 0 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      ref={menu}
      className="atlContextMenu atlContextMenu--small shlShare__menu"
      data-test-subj="shareContextMenu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {shown === 'menu' ? (
        <>
          <div className="atlContextMenu__title">{`Share this ${objectType}`}</div>
          {ITEMS.map((item) => (
            <button
              key={item.panel}
              type="button"
              className="atlContextMenu__item"
              data-panel={item.panel}
              data-test-subj={`sharePanel-${item.label.replace(' ', '')}`}
              onClick={() => open(item.panel)}
            >
              <Icon name={item.icon} />
              <span className="atlContextMenu__text">{item.label}</span>
              <Icon name="chevronRight" className="atlContextMenu__arrow" />
            </button>
          ))}
        </>
      ) : (
        <>
          {allowEmbed ? (
            <button
              type="button"
              className="atlContextMenu__title atlContextMenu__back"
              data-test-subj="contextMenuPanelTitleButton"
              // A press of Enter or the space bar clicks with no count of clicks
              onClick={(event: ReactMouseEvent<HTMLButtonElement>) => back(event.detail === 0)}
            >
              <Icon name="chevronLeft" />
              <span>{TITLES[shown]}</span>
            </button>
          ) : (
            <div className="atlContextMenu__title">{TITLES[shown]}</div>
          )}
          <UrlPanel
            key={shown}
            objectType={objectType}
            savedUrl={savedUrl}
            embedded={shown === 'embed'}
            withOptions={shown === 'embed' && objectType === 'dashboard'}
          />
        </>
      )}
    </div>
  );
}

/** What a failed request is called in the original's message: the words of the answer's status */
function failureOf(failure: unknown): string {
  if (failure instanceof HttpFetchError) return failure.statusText || failure.message;
  return errorMessage(failure);
}

/**
 * Copies a text as the original's `EuiCopy` does, without moving the focus: a selection of a hidden
 * span the browser copies. Says whether it could.
 */
function copySelection(text: string): boolean {
  const span = document.createElement('span');
  span.textContent = text;
  // Kept out of sight without scrolling the page, its spaces and lines as they are
  Object.assign(span.style, { position: 'fixed', top: '0', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'pre', userSelect: 'text' });
  document.body.appendChild(span);
  const range = document.createRange();
  const selection = window.getSelection();
  let copied = false;
  try {
    range.selectNode(span);
    selection?.addRange(range);
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  selection?.removeRange(range);
  span.remove();
  return copied;
}

/** A question mark that tells more in a tip under it, and takes the focus to tell it */
function InfoTip({ content }: { content: string }) {
  return (
    <Tooltip content={content} position="bottom" delay="regular">
      <span className="shlShare__tip" tabIndex={0}>
        <Icon name="questionInCircle" title="Info" />
      </span>
    </Tooltip>
  );
}

/**
 * A panel that makes a link, as the original's `UrlPanelContent`: the choice of what it opens, a
 * dashboard's options, the short URL, and the button that copies it. Each panel has its own: it
 * starts afresh each time it is shown.
 */
function UrlPanel({
  objectType,
  savedUrl,
  embedded,
  withOptions,
}: {
  objectType: string;
  savedUrl?: string;
  embedded: boolean;
  withOptions: boolean;
}) {
  // The address of the page: what a snapshot is made of, and what the saved object's link keeps
  useLocation();
  const href = window.location.href;
  const saved = savedUrl !== undefined;
  const [kind, setKind] = useState<'snapshot' | 'savedObject'>('snapshot');
  const [options, setOptions] = useState<EmbedOptions>(EMBED_DEFAULTS);
  const [useShort, setUseShort] = useState(false);
  // The last short URL made: it stays the link while another is made
  const [shortUrl, setShortUrl] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [shortError, setShortError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    []
  );
  // The page moved on: its short URL opens what it was, so it is forgotten, as the original forgets it
  const madeOn = useRef(href);
  useEffect(() => {
    if (madeOn.current === href) return;
    madeOn.current = href;
    setShortUrl(undefined);
    setUseShort(false);
  }, [href]);

  const extra = withOptions ? options : undefined;
  const create = async (target: string) => {
    setCreating(true);
    setShortError(undefined);
    try {
      const made = await shortenUrl(services.http, target);
      if (!live.current) return;
      setShortUrl(made);
      setUseShort(true);
    } catch (failure) {
      if (!live.current) return;
      setShortUrl(undefined);
      setUseShort(false);
      setShortError(`Unable to create short URL. Error: ${failureOf(failure)}`);
    } finally {
      if (live.current) setCreating(false);
    }
  };
  const onShortChange = (checked: boolean) => {
    if (!checked || shortUrl !== undefined) setUseShort(checked);
    else void create(snapshotUrl(href, embedded, extra));
  };
  // Other options make another page: its short URL is made at once when the switch is on
  const onOptionChange = (key: keyof EmbedOptions, value: boolean) => {
    const next = { ...options, [key]: value };
    setOptions(next);
    if (useShort) void create(snapshotUrl(href, embedded, next));
  };

  const link =
    kind === 'savedObject' ? savedObjectUrl(href, embedded, extra) : useShort ? shortUrl : snapshotUrl(href, embedded, extra);
  const shared = link === undefined ? undefined : embedded ? iframeTag(link) : link;
  const copy = () => {
    const text = shared ?? '';
    if (copySelection(text)) {
      setCopied(true);
      return;
    }
    // Where the browser copies no selection, its clipboard may take the text all the same
    navigator.clipboard?.writeText(text).then(
      () => live.current && setCopied(true),
      () => undefined
    );
  };

  const labelId = useId();
  const groupId = useId();
  const helpId = useId();
  const choices = [
    { id: 'snapshot' as const, label: 'Snapshot', tip: SNAPSHOT_TIP(objectType), testId: 'exportAsSnapshot', disabled: false },
    { id: 'savedObject' as const, label: 'Saved object', tip: SAVED_OBJECT_TIP(objectType), testId: 'exportAsSavedObject', disabled: !saved },
  ];
  return (
    <div className="shlShare__form" data-test-subj="shareUrlForm">
      <div className="shlShare__row">
        <label className="atlFormRow__label shlShare__label" id={labelId} htmlFor={groupId}>
          Generate the link as
        </label>
        <div id={groupId} role="radiogroup" aria-labelledby={labelId} aria-describedby={saved ? undefined : helpId}>
          {choices.map((option) => (
            <label
              key={option.id}
              className={cx('shlShare__choice', option.disabled && 'shlShare__choice--disabled')}
              data-test-subj={option.testId}
            >
              <input
                type="radio"
                className="shlShare__radio"
                name={groupId}
                checked={kind === option.id}
                disabled={option.disabled}
                onChange={() => setKind(option.id)}
              />
              <span>{option.label}</span>
              <InfoTip content={option.tip} />
            </label>
          ))}
        </div>
        {!saved && (
          <span className="atlFormRow__help shlShare__help" id={helpId}>
            {`Can't share as saved object until the ${objectType} has been saved.`}
          </span>
        )}
      </div>
      {withOptions && (
        <fieldset className="shlShare__row shlShare__options" data-test-subj="embedUrlParamExtension">
          <legend className="atlFormRow__label shlShare__legend">Include</legend>
          {EMBED_OPTIONS.map((option) => (
            <label key={option.key} className="shlShare__choice">
              <input
                type="checkbox"
                className="shlShare__check"
                checked={options[option.key]}
                onChange={(event) => onOptionChange(option.key, event.target.checked)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      {/* Only a snapshot is shortened: the link of a saved object is short already */}
      {kind === 'snapshot' && (
        <div className="shlShare__row" data-test-subj="createShortUrl">
          <div className="shlShare__short">
            <Switch
              compressed
              checked={useShort}
              onChange={onShortChange}
              label={
                creating ? (
                  <span>
                    <span className="atlSpinner shlShare__spinner" /> Short URL
                  </span>
                ) : (
                  'Short URL'
                )
              }
              testId="useShortUrl"
            />
            <InfoTip content={SHORT_URL_TIP} />
          </div>
          {shortError && <span className="atlFormRow__help shlShare__help">{shortError}</span>}
        </div>
      )}
      <div className="shlShare__copy">
        {/* As the original's, it says that it copied over the button, until the pointer leaves */}
        <Tooltip block content={copied ? 'Copied' : ''} className={copied ? undefined : 'shlShare__noTip'} delay="regular">
          <Button
            full
            className="shlShare__copyButton"
            onClick={copy}
            onMouseLeave={() => setCopied(false)}
            disabled={creating || shared === ''}
            data-share-url={shared}
            testId="copyShareUrlButton"
          >
            <span className="shlShare__copyText">{embedded ? 'Copy iFrame code' : 'Copy link'}</span>
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
