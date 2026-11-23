/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Saved queries in the search bar, as OpenSearch Dashboards has them: the button before the
 * query opens the list of saved queries to load or delete, with the buttons that save the query
 * of the moment, and the form that names it and says whether its filters and its time range go
 * with it. The texts and the names tests find them by are the original's.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, CallOut, cx } from '../components/basic';
import { FormRow, Switch, TextField } from '../components/form';
import { Icon } from '../components/icon';
import { Modal, Popover, Tooltip } from '../components/overlay';
import { Pagination } from '../components/table';
import { errorMessage } from '../services/http';
import {
  sortSavedQueries,
  titleConflicts,
  type SaveQueryMeta,
  type SavedQuery,
  type SavedQueryAttributes,
  type SavedQueryState,
} from '../lib/saved_query';
import { services } from '../services';
import { isPinned } from './filter_bar';
import { globalParamWith } from './state';

/** What the page is asked to take when a saved query is loaded, saved or cleared */
export interface SavedQueryChange extends SavedQueryState {
  /** The saved query the page now has; none once it is cleared */
  id?: string;
  /** Write it over the address the browser is at instead of as a new step back */
  replace?: boolean;
}

/** The `_g` a saved query leaves: the pinned filters, and its time range when it has one */
export function savedQueryGlobalParam(change: SavedQueryChange): string {
  return globalParamWith({
    filters: change.filters.filter(isPinned),
    ...(change.time ? { time: change.time } : {}),
    ...(change.refreshInterval ? { refreshInterval: change.refreshInterval } : {}),
  });
}

/** The filters a saved query leaves that the page keeps as its own */
export const pageFiltersOf = (change: SavedQueryChange) => change.filters.filter((filter) => !isPinned(filter));

const PER_PAGE = 50;
const DESCRIPTION_TEXT = 'Save query text and filters that you want to use again.';

function SavedQueryItem({
  savedQuery,
  selected,
  onSelect,
  onDelete,
}: {
  savedQuery: SavedQuery;
  selected: boolean;
  onSelect: (savedQuery: SavedQuery) => void;
  onDelete: (savedQuery: SavedQuery) => void;
}) {
  const { title, description } = savedQuery.attributes;
  // The names tests find the row by, the selected one's twice over, as the original writes them
  const selectTestId = selected
    ? `load-saved-query-${title}-button saved-query-list-item-selected`
    : `load-saved-query-${title}-button`;
  return (
    <li className={cx('shlSavedQueries__item', selected && 'shlSavedQueries__item--selected')}>
      <button
        type="button"
        className="shlSavedQueries__load"
        onClick={() => onSelect(savedQuery)}
        aria-label={
          selected
            ? `Saved query button selected ${title}. Press to clear any changes.`
            : `Saved query button ${title}`
        }
        data-test-subj={`saved-query-list-item ${selectTestId} ${selected ? 'saved-query-list-item-selected' : ''}`}
      >
        {selected && <Icon name="check" />}
        <span className="shlSavedQueries__label" title={title} data-test-subj="osdSavedQueryListItemLabel">
          <span className="shlSavedQueries__name">{title}</span>
          {description && (
            // The description in a tip over its icon, which Tab stops at, as the original's
            <Tooltip content={description} delay="regular">
              <span className="shlSavedQueries__tip" tabIndex={0}>
                <Icon name="info" title={`${title} description`} />
              </span>
            </Tooltip>
          )}
        </span>
      </button>
      <button
        type="button"
        className="shlSavedQueries__delete"
        onClick={() => onDelete(savedQuery)}
        aria-label={`Delete saved query ${title}`}
        title={`Delete saved query ${title}`}
        data-test-subj={`delete-saved-query-${title}-button`}
      >
        <Icon name="trash" size="s" />
      </button>
    </li>
  );
}

/** The list of saved queries, made each time it opens, as the original's popover is */
function SavedQueryList({
  loaded,
  onLoad,
  onClear,
  onSave,
  onSaveAsNew,
  onDelete,
}: {
  loaded?: SavedQuery;
  onLoad: (savedQuery: SavedQuery) => void;
  onClear: () => void;
  onSave: () => void;
  onSaveAsNew: () => void;
  onDelete: (savedQuery: SavedQuery) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [listed, setListed] = useState(false);

  useEffect(() => {
    let live = true;
    services.savedQueries
      .findSavedQueries('', PER_PAGE, page + 1)
      .then(({ total, queries: found }) => {
        if (!live) return;
        setCount(total);
        setQueries(sortSavedQueries(found));
      })
      .catch((failure) => live && services.toasts.error(failure, 'The saved queries could not be listed'))
      .finally(() => live && setListed(true));
    return () => {
      live = false;
    };
  }, [page]);

  // The focus comes in once the list is there, as into the original's once its opening has
  // settled: on the first saved query, else on the first button
  useEffect(() => {
    const element = root.current;
    if (!listed || !element) return;
    const panel = element.closest<HTMLElement>('.atlPopover') ?? element;
    if (panel.contains(document.activeElement)) return;
    element.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"]')?.focus({ preventScroll: true });
  }, [listed]);

  // The loaded one comes first when it is on this page
  const others = queries.filter((query) => query.id !== loaded?.id);
  const rows = loaded && others.length !== queries.length ? [loaded, ...others] : others;

  return (
    <div ref={root} className="shlSavedQueries" data-test-subj="saved-query-management-popover">
      <div className="shlSavedQueries__title" id="savedQueryManagementPopoverTitle">
        Saved Queries
      </div>
      {queries.length > 0 ? (
        <>
          <p className="shlSavedQueries__text" data-test-subj="osdSavedQueryManagementText">
            {DESCRIPTION_TEXT}
          </p>
          <ul
            className="shlSavedQueries__list"
            data-test-subj="osdSavedQueryManagementList"
            aria-labelledby="savedQueryManagementPopoverTitle"
          >
            {rows.map((query) => (
              <SavedQueryItem
                key={query.id}
                savedQuery={query}
                selected={loaded?.id === query.id}
                onSelect={onLoad}
                onDelete={onDelete}
              />
            ))}
          </ul>
          <div className="shlSavedQueries__pages" data-test-subj="osdSavedQueryManagementPagination">
            <Pagination page={page} pages={Math.ceil(count / PER_PAGE)} onPage={setPage} />
          </div>
        </>
      ) : (
        <p className="shlSavedQueries__text shlSavedQueries__text--empty" data-test-subj="osdSavedQueryManagementNoSavedQueryText">
          There are no saved queries. {DESCRIPTION_TEXT}
        </p>
      )}
      {/* The saving buttons come first, as the keyboard reaches them in the original, drawn right */}
      <div className="shlSavedQueries__footer">
        {loaded ? (
          <>
            <Button
              variant="primary"
              onClick={onSave}
              aria-label={`Save changes to ${loaded.attributes.title}`}
              testId="saved-query-management-save-changes-button"
            >
              Save changes
            </Button>
            <Button onClick={onSaveAsNew} aria-label="Save as new saved query" testId="saved-query-management-save-as-new-button">
              Save as new
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onSave} aria-label="Save a new saved query" testId="saved-query-management-save-button">
            Save current query
          </Button>
        )}
        <span className="atlGrow" />
        {loaded && (
          <Button
            variant="empty"
            className="shlSavedQueries__clear"
            onClick={onClear}
            aria-label="Clear current saved query"
            testId="saved-query-management-clear-button"
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

/** The button before the query, and what it opens */
export function SavedQueryManagement({
  loaded,
  onLoad,
  onClear,
  onSave,
  onSaveAsNew,
}: {
  loaded?: SavedQuery;
  onLoad: (savedQuery: SavedQuery) => void;
  onClear: () => void;
  onSave: () => void;
  onSaveAsNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<SavedQuery>();
  const deleteOpener = useRef<HTMLElement | null>(null);
  // The question over the list is part of it: answering it does not close the list
  const close = useCallback(() => {
    if (!deleting) setOpen(false);
  }, [deleting]);

  // Cancelled, the question gives the focus back to the bin it was asked from, as the original's
  useEffect(() => {
    if (deleting) return;
    const back = deleteOpener.current;
    deleteOpener.current = null;
    if (back?.isConnected) back.focus();
  }, [deleting]);

  const remove = async (savedQuery: SavedQuery) => {
    setDeleting(undefined);
    setOpen(false);
    if (loaded?.id === savedQuery.id) onClear();
    try {
      await services.savedQueries.deleteSavedQuery(savedQuery.id);
    } catch (failure) {
      services.toasts.error(failure, `The saved query ${savedQuery.attributes.title} could not be deleted`);
    }
  };

  return (
    <>
      <Popover
        open={open}
        onClose={close}
        position="downLeft"
        // The list gives itself the focus once it has come (below)
        initialFocus={false}
        className={deleting ? 'shlSavedQueries__panel--behind' : undefined}
        anchorStyle={{ alignSelf: 'stretch' }}
        button={
          <Button
            variant="empty"
            icon="save"
            className="shlQuery__saved"
            onClick={() => setOpen(!open)}
            aria-label="See saved queries"
            title="See saved queries"
            aria-expanded={open}
            testId="saved-query-management-popover-button"
          />
        }
      >
        <SavedQueryList
          loaded={loaded}
          onLoad={(savedQuery) => {
            setOpen(false);
            onLoad(savedQuery);
          }}
          onClear={onClear}
          onSave={() => {
            setOpen(false);
            onSave();
          }}
          onSaveAsNew={() => {
            setOpen(false);
            onSaveAsNew();
          }}
          onDelete={(savedQuery) => {
            deleteOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setDeleting(savedQuery);
          }}
        />
      </Popover>
      {deleting && (
        // The original's confirmation, 400 px wide, with a title and no text; the dialog itself
        // has the focus, neither of its buttons
        <Modal
          title={`Delete "${deleting.attributes.title}"?`}
          className="atlModal--confirm shlSavedQueries__confirm"
          testId="confirmModal"
          onClose={() => setDeleting(undefined)}
          footer={
            <>
              <Button variant="empty" onClick={() => setDeleting(undefined)} testId="confirmModalCancelButton">
                Cancel
              </Button>
              <Button variant="dangerFill" onClick={() => void remove(deleting)} testId="confirmModalConfirmButton">
                Delete
              </Button>
            </>
          }
        >
          {null}
        </Modal>
      )}
    </>
  );
}

/** The form that saves the query: a new one, or the loaded one again under its name */
export function SaveQueryForm({
  savedQuery,
  showFilterOption,
  showTimeFilterOption,
  onSave,
  onClose,
}: {
  /** The loaded saved query when its changes are saved; none for a new one */
  savedQuery?: SavedQueryAttributes;
  showFilterOption: boolean;
  showTimeFilterOption: boolean;
  onSave: (meta: SaveQueryMeta) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(savedQuery?.title ?? '');
  const [enabled, setEnabled] = useState(Boolean(savedQuery));
  const [description, setDescription] = useState(savedQuery?.description ?? '');
  const [includeFilters, setIncludeFilters] = useState(savedQuery ? Boolean(savedQuery.filters) : true);
  // Off unless the saved query had one: a time range in a saved query overrides the time picker
  // whenever it is loaded, which is rarely wanted
  const [includeTime, setIncludeTime] = useState(Boolean(savedQuery?.timefilter));
  const [existing, setExisting] = useState<SavedQuery[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const form = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    services.savedQueries
      .getAllSavedQueries()
      .then((all) => live && setExisting(sortSavedQueries(all)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Its name cannot change when its changes are saved: the dialog itself has the focus then, as
  // the original's, whose first focus, the name, cannot take it. As it opens only.
  useEffect(() => {
    if (savedQuery) form.current?.closest<HTMLElement>('.atlModal')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    // A first press shows what is wrong; the form says so until the name changes
    const found = titleConflicts(title, existing, Boolean(savedQuery))
      ? ['Name conflicts with an existing saved query']
      : [];
    if (found.join('\n') !== errors.join('\n')) {
      setErrors(found);
      return;
    }
    if (errors.length) return;
    onSave({
      title,
      description,
      shouldIncludeFilters: includeFilters,
      shouldIncludeTimeFilter: includeTime,
    });
  };

  const invalid = errors.length > 0;
  // Called once, as the errors appear; not on each change of the form while they show
  const focusOnMount = useCallback((node: HTMLDivElement | null) => node?.focus(), []);
  return (
    <Modal
      title="Save query"
      titleSize="l"
      className="shlSaveQuery"
      onClose={onClose}
      testId="saveQueryFormModal"
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId="savedQueryFormCancelButton">
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={invalid || !enabled} testId="savedQueryFormSaveButton">
            Save
          </Button>
        </>
      }
    >
      {/* The original's form of compressed rows, 400 px wide and 16 px apart */}
      <div ref={form} className="shlSaveQuery__form" data-test-subj="saveQueryForm">
        {invalid && (
          // Given the focus as it comes, as the original's, so that it is read out
          <div className="shlSaveQuery__errorBox" tabIndex={-1} ref={focusOnMount}>
            <CallOut tone="critical" title="Please address the errors in your form.">
              <ul className="shlSaveQuery__errors">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </CallOut>
          </div>
        )}
        <div className="shlSaveQuery__text">{DESCRIPTION_TEXT}</div>
        <FormRow
          label={<span className={cx(invalid && 'atlFormRow__label--invalid')}>Name</span>}
          help="Name is required and must be unique without leading or trailing spaces."
        >
          <TextField
            name="title"
            value={title}
            compact
            disabled={Boolean(savedQuery)}
            invalid={invalid}
            onChange={(value) => {
              setEnabled(Boolean(value));
              setErrors([]);
              setTitle(value);
            }}
            onBlur={() => {
              const trimmed = title.trim();
              if (title.length > trimmed.length) setTitle(trimmed);
            }}
            testId="saveQueryFormTitle"
          />
        </FormRow>
        <FormRow label="Description">
          <TextField
            name="description"
            value={description}
            compact
            onChange={setDescription}
            testId="saveQueryFormDescription"
          />
        </FormRow>
        {showFilterOption && (
          <Switch
            checked={includeFilters}
            onChange={setIncludeFilters}
            label="Include filters"
            compressed
            testId="saveQueryFormIncludeFiltersOption"
          />
        )}
        {showTimeFilterOption && (
          <Switch
            checked={includeTime}
            onChange={setIncludeTime}
            label="Include time filter"
            compressed
            testId="saveQueryFormIncludeTimeFilterOption"
          />
        )}
      </div>
    </Modal>
  );
}

/** The sentence a failure to save is told with, as the original tells it */
export function saveFailureText(failure: unknown): string {
  const message = errorMessage(failure);
  return `An error occurred while saving your query${message ? `: ${message}` : ''}`;
}
