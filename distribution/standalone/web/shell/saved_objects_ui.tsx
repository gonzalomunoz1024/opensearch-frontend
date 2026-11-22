/* SPDX-License-Identifier: Apache-2.0 */

/* The dialogs every page that saves something shares: save, open, share. */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, CallOut, EmptyPrompt, Loading } from '../components/basic';
import { Checkbox, FormRow, RadioGroup, SearchField, Switch, TextArea, TextField } from '../components/form';
import { Icon, type IconName } from '../components/icon';
import { Flyout, Modal, copyText } from '../components/overlay';
import { Pagination } from '../components/table';
import { useLocation } from '../router';
import { services } from '../services';
import { errorMessage } from '../services/http';
import { shortenUrl } from '../services/short_urls';
import type { SavedObject } from '../services/saved_objects';

export interface SaveResult {
  title: string;
  description: string;
  /** Save a copy under the new title and leave the original as it is */
  asNew: boolean;
}

export function SaveModal({
  objectType,
  title: initialTitle,
  description: initialDescription,
  showDescription,
  existing,
  children,
  onSave,
  onClose,
}: {
  /** What is being saved, in words: "search", "dashboard" */
  objectType: string;
  title: string;
  description?: string;
  showDescription?: boolean;
  /** Whether it has been saved before: then it can also be saved as a new one */
  existing: boolean;
  children?: ReactNode;
  onSave: (result: SaveResult) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [asNew, setAsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState(false);

  const save = async (confirmed: boolean) => {
    if (title.trim() === '') return;
    setBusy(true);
    try {
      // A second object with a title already taken is saved only when confirmed
      const titleChanged = title.trim() !== initialTitle;
      if (!confirmed && (asNew || !existing || titleChanged)) {
        const found = await services.savedObjects.find<{ title: string }>({
          type: typeFor(objectType),
          search: `"${title.trim()}"`,
          searchFields: ['title'],
          fields: ['title'],
          perPage: 10,
        });
        if (found.saved_objects.some((object) => object.attributes.title?.toLowerCase() === title.trim().toLowerCase())) {
          setDuplicate(true);
          setBusy(false);
          return;
        }
      }
      await onSave({ title: title.trim(), description, asNew: asNew || !existing });
    } catch (error) {
      services.toasts.error(error, `The ${objectType} was not saved`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Save ${objectType}`}
      onClose={onClose}
      testId="savedObjectSaveModal"
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId="saveCancelButton">
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={title.trim() === ''}
            onClick={() => void save(duplicate)}
            testId="confirmSaveSavedObjectButton"
          >
            {duplicate ? 'Save anyway' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        className="atlStack"
        onSubmit={(event) => {
          event.preventDefault();
          void save(duplicate);
        }}
      >
        {duplicate && (
          <CallOut tone="warning" title={`A ${objectType} with the title “${title.trim()}” already exists`}>
            Saving it again makes a second one with the same title.
          </CallOut>
        )}
        {existing && (
          <Switch
            checked={asNew}
            onChange={setAsNew}
            label={`Save as new ${objectType}`}
            testId="saveAsNewCheckbox"
          />
        )}
        <FormRow label="Title" full>
          <TextField
            value={title}
            onChange={(value) => {
              setTitle(value);
              setDuplicate(false);
            }}
            invalid={title.trim() === ''}
            testId="savedObjectTitle"
            autoFocus
          />
        </FormRow>
        {showDescription && (
          <FormRow label="Description" full>
            <TextArea value={description} onChange={setDescription} rows={3} testId="savedObjectDescription" />
          </FormRow>
        )}
        {children}
      </form>
    </Modal>
  );
}

const typeFor = (objectType: string) =>
  ({ search: 'search', dashboard: 'dashboard', visualization: 'visualization', query: 'query' })[objectType] ??
  objectType;

export interface FinderType {
  type: string;
  name: string;
  icon: IconName;
}

/** A searchable list of saved objects of some types: what "Open" shows */
export function SavedObjectFinder({
  types,
  onChoose,
  pageSize = 15,
  empty,
}: {
  types: FinderType[];
  onChoose: (object: SavedObject<{ title: string }>) => void;
  pageSize?: number;
  empty?: ReactNode;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [found, setFound] = useState<{ total: number; objects: Array<SavedObject<{ title: string }>> }>();
  const typeKey = types.map((item) => item.type).join(',');

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(
      () => {
        services.savedObjects
          .find<{ title: string }>({
            type: typeKey.split(','),
            search: search.trim() ? `${search.trim().replace(/\*+$/, '')}*` : undefined,
            searchFields: ['title'],
            fields: ['title', 'visState', 'description'],
            page: page + 1,
            perPage: pageSize,
            sortField: search.trim() ? undefined : 'title',
          })
          .then((answer) => {
            if (live) setFound({ total: answer.total, objects: answer.saved_objects });
          })
          .catch((error) => {
            if (live) {
              setFound({ total: 0, objects: [] });
              services.toasts.error(error, 'The list could not be loaded');
            }
          });
      },
      search ? 200 : 0
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [typeKey, search, page, pageSize]);

  const icons = useMemo(() => new Map(types.map((item) => [item.type, item.icon])), [types]);
  return (
    <div className="atlStack" data-test-subj="savedObjectFinder">
      <SearchField
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(0);
        }}
        placeholder="Search"
        testId="savedObjectFinderSearchInput"
        autoFocus
      />
      {!found ? (
        <Loading />
      ) : found.objects.length === 0 ? (
        (empty ?? <EmptyPrompt title="No matching objects found" />)
      ) : (
        <div className="atlMenu" style={{ padding: 0 }}>
          {found.objects.map((object) => (
            <button
              key={`${object.type}:${object.id}`}
              type="button"
              className="atlMenu__item"
              onClick={() => onChoose(object)}
              data-test-subj={`savedObjectTitle${(object.attributes.title ?? '').split(' ').join('-')}`}
            >
              <Icon name={icons.get(object.type) ?? 'document'} />
              <span className="atlGrow atlTruncate">{object.attributes.title || object.id}</span>
            </button>
          ))}
        </div>
      )}
      {found && found.total > pageSize && (
        <Pagination page={page} pages={Math.ceil(found.total / pageSize)} onPage={setPage} total={found.total} />
      )}
    </div>
  );
}

export function OpenFlyout({
  title,
  types,
  onChoose,
  onClose,
  manageLink,
}: {
  title: string;
  types: FinderType[];
  onChoose: (object: SavedObject<{ title: string }>) => void;
  onClose: () => void;
  manageLink?: string;
}) {
  return (
    <Flyout
      title={title}
      onClose={onClose}
      testId="loadSearchForm"
      footer={
        manageLink ? (
          <Button variant="empty" to={manageLink}>
            Manage saved objects
          </Button>
        ) : undefined
      }
    >
      <SavedObjectFinder types={types} onChoose={onChoose} />
    </Flyout>
  );
}

/** Share: the address of what is on screen, or of the saved object behind it */
/** The original's advice on short URLs, behind the question mark beside the switch */
const SHORT_URL_TIP =
  "We recommend sharing shortened snapshot URLs for maximum compatibility. Internet Explorer has URL length restrictions, and some wiki and markup parsers don't do well with the full-length version of the snapshot URL, but the short URL should work great.";

/** The address of a page as another page shows it inside its own */
const embeddable = (url: string) => `${url}${url.includes('?') ? '&' : '?'}embed=true`;

export function ShareModal({
  objectType,
  savedUrl,
  onClose,
}: {
  objectType: string;
  /** The address of the saved object, when there is one: it follows later changes to it */
  savedUrl?: string;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'snapshot' | 'saved'>('snapshot');
  const [embed, setEmbed] = useState(false);
  // The short URLs made while the dialog is open, by the address each one opens
  const [shortUrls, setShortUrls] = useState<Record<string, string>>({});
  const [useShort, setUseShort] = useState(false);
  const [creating, setCreating] = useState(false);
  const [shortError, setShortError] = useState<string>();
  useLocation();
  const snapshot = window.location.href;
  // The page moved on: its short URLs open what it was, so they are forgotten as in the original
  useEffect(() => {
    setShortUrls({});
    setUseShort(false);
  }, [snapshot]);

  const target = (embedded: boolean) => (embedded ? embeddable(snapshot) : snapshot);
  const makeShort = async (address: string) => {
    setCreating(true);
    setShortError(undefined);
    try {
      const short = await shortenUrl(services.http, address);
      setShortUrls((known) => ({ ...known, [address]: short }));
      setUseShort(true);
    } catch (failure) {
      setUseShort(false);
      setShortError(`Unable to create short URL. Error: ${errorMessage(failure)}`);
    } finally {
      setCreating(false);
    }
  };
  const onShortChange = (checked: boolean) => {
    if (!checked || shortUrls[target(embed)]) setUseShort(checked);
    else void makeShort(target(embed));
  };
  const onEmbedChange = (checked: boolean) => {
    setEmbed(checked);
    // The page shown inside another has a short URL of its own, made as the switch is still on
    if (useShort && !shortUrls[target(checked)]) {
      setUseShort(false);
      void makeShort(target(checked));
    }
  };

  const short = useShort ? shortUrls[target(embed)] : undefined;
  const link = kind === 'saved' && savedUrl ? (embed ? embeddable(savedUrl) : savedUrl) : (short ?? target(embed));
  const shown = embed ? `<iframe src="${link}" height="600" width="800"></iframe>` : link;
  return (
    <Modal
      title={`Share this ${objectType}`}
      onClose={onClose}
      testId="shareContextMenu"
      footer={
        <Button
          variant="primary"
          icon="copy"
          disabled={creating}
          onClick={() => {
            copyText(shown, embed ? 'The embed code was copied' : 'The link was copied');
            onClose();
          }}
          testId="copyShareUrlButton"
        >
          {embed ? 'Copy iFrame code' : 'Copy link'}
        </Button>
      }
    >
      <div className="atlStack">
        <FormRow label="Generate the link as" full>
          <RadioGroup
            value={kind}
            onChange={setKind}
            options={[
              {
                id: 'snapshot',
                label: `Snapshot: the ${objectType} as it is on screen now, with its time range and filters`,
              },
              ...(savedUrl
                ? [{ id: 'saved' as const, label: `Saved object: the most recent saved version of this ${objectType}` }]
                : []),
            ]}
          />
        </FormRow>
        {/* Only a snapshot is shortened: the address of a saved object is short already */}
        {kind === 'snapshot' && (
          <div className="shlShortUrl" data-test-subj="createShortUrl">
            <span className="shlShortUrl__switch">
              <Switch checked={useShort} onChange={onShortChange} label="Short URL" testId="useShortUrl" />
              {creating && <span className="atlSpinner" />}
              <span className="shlShortUrl__tip" title={SHORT_URL_TIP}>
                <Icon name="help" title={SHORT_URL_TIP} />
              </span>
            </span>
            {shortError && <span className="atlFormRow__help">{shortError}</span>}
          </div>
        )}
        <Checkbox checked={embed} onChange={onEmbedChange} label="As code to embed in another page" />
        <TextArea value={shown} onChange={() => undefined} readOnly rows={4} code />
      </div>
    </Modal>
  );
}
