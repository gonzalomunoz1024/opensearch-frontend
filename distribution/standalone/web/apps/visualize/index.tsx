/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Visualize: the list of saved visualizations, the dialog a new one starts from (its kind, then
 * the index pattern or the saved search it is drawn from), and the editor.
 */

import { useMemo, useState } from 'react';
import { Badge, Button, cx } from '../../components/basic';
import { SearchField } from '../../components/form';
import { Icon, type IconName } from '../../components/icon';
import { Modal } from '../../components/overlay';
import { appUrl } from '../../lib/url';
import { VIS_TYPES, visIcon, visType, type VisType } from '../../lib/vis';
import { navigate, navigateHash, useLocation } from '../../router';
import { services } from '../../services';
import { Listing, ListingEmpty, type Listed, type ListingColumn } from '../../shell/listing';
import { SavedObjectFinder } from '../../shell/saved_objects_ui';
import { currentGlobalParam, useBreadcrumbs } from '../../shell/state';
import { canDraw } from '../../vis/visualization';
import { VIS_BUILDER_APP, VIS_BUILDER_TITLE, VIS_BUILDER_TYPE, visBuilderEditUrl } from '../vis_builder/model';
import { VISUALIZE, VisEditor } from './editor';
import { editorStateFor, type ContainerInfo } from './state_transfer';
import '../../styles/visualize.css';

const SOURCE_TYPES = [
  { type: 'search', name: 'Saved search', icon: 'discover' as const },
  { type: 'index-pattern', name: 'Index pattern', icon: 'index' as const },
];

// Kinds another application makes, listed with the others as OpenSearch Dashboards lists them
const ALIASES: Array<VisType & { open: () => string }> = [
  {
    name: 'vis-builder',
    title: VIS_BUILDER_TITLE,
    description: 'Create visualizations using the new VisBuilder',
    icon: 'visBuilder',
    aggBased: false,
    open: () => appUrl(VIS_BUILDER_APP, '/', { _g: currentGlobalParam() }),
  },
];
const aliasOf = (type: VisType) => ALIASES.find((alias) => alias.name === type.name);

const typeOf = (object: Listed): string => {
  if (object.type === VIS_BUILDER_TYPE) return VIS_BUILDER_TYPE;
  try {
    return (JSON.parse((object.attributes as { visState?: string }).visState ?? '{}') as { type?: string }).type ?? '';
  } catch {
    return '';
  }
};

// What VisBuilder made opens in VisBuilder
const editUrl = (object: Listed) =>
  object.type === VIS_BUILDER_TYPE ? visBuilderEditUrl(object.id) : appUrl(VISUALIZE, `/edit/${encodeURIComponent(object.id)}`);

// Such a one the original lists under a button, not a link
const opensElsewhere = (object: Listed) => object.type === VIS_BUILDER_TYPE;

const typeTitle = (type: string) => (type === VIS_BUILDER_TYPE ? VIS_BUILDER_TITLE : (visType(type)?.title ?? type));

/** visualize:enableLabs: whether the kinds still being tried out (the input controls) are offered and listed */
const labsEnabled = () => services.uiSettings.get<boolean>('visualize:enableLabs', true) !== false;

/** Without the labs, the list leaves out what was made of an experimental kind, as the original's */
const isNotLab = (object: Listed) => visType(typeOf(object))?.stage !== 'experimental';

export function Visualize() {
  const { hashPath, hashParams } = useLocation();
  const edit = /^\/edit\/(.+)$/.exec(hashPath);
  if (edit) return <VisEditor key={edit[1]} savedId={decodeURIComponent(edit[1])} />;
  if (hashPath === '/create' && hashParams.type) {
    return <VisEditor key={`create:${hashParams.type}:${hashParams.indexPattern ?? ''}:${hashParams.savedSearchId ?? ''}`} />;
  }
  return <VisualizeList creating={hashPath === '/create'} />;
}

function VisualizeList({ creating }: { creating: boolean }) {
  useBreadcrumbs([{ text: 'Visualize' }]);
  const [dialog, setDialog] = useState(creating);
  return (
    <>
      <Listing
        title="Visualizations"
        headingId="visualizeListingHeading"
        entity="visualization"
        entities="visualizations"
        types={[VIS_BUILDER_TYPE, 'visualization']}
        fields={['title', 'description', 'visState']}
        createLabel="Create visualization"
        onCreate={() => setDialog(true)}
        linkTo={editUrl}
        titleTestId={visTitleTestId}
        titleAsButton={opensElsewhere}
        editTo={editUrl}
        typeColumn={VIS_TYPE_COLUMN}
        padding="l"
        deleteErrors={{ title: 'Error deleting visualization', per: 'each' }}
        noItems={
          <ListingEmpty
            icon="visualize"
            headingId="visualizeListingHeading"
            title="Create your first visualization"
            actions={
              <Button variant="primary" icon="plus" onClick={() => setDialog(true)} testId="createVisualizationPromptButton">
                Create new visualization
              </Button>
            }
          >
            <p>You can create different visualizations based on your data.</p>
          </ListingEmpty>
        }
        keep={labsEnabled() ? undefined : isNotLab}
      />
      {dialog && (
        <NewVisModal
          onClose={() => {
            setDialog(false);
            if (creating) navigateHash('/', { _g: currentGlobalParam() }, { replace: true });
          }}
        />
      )}
    </>
  );
}

const visTitleTestId = (title: string) => `visListingTitleLink-${title.split(' ').join('-')}`;

const VIS_TYPE_COLUMN: ListingColumn = {
  field: 'typeTitle',
  name: 'Type',
  value: (object) => typeTitle(typeOf(object)),
  render: (object) => {
    const type = typeOf(object);
    return (
      <span className="vzeListType">
        <Icon name={type === VIS_BUILDER_TYPE ? 'visBuilder' : (visIcon(type) as IconName)} />
        {typeTitle(type)}
      </span>
    );
  },
};

/**
 * "New Visualization": every kind there is, then what an aggregation-based one is drawn from. An
 * application that opens it (a dashboard's "Create new") names itself and its container: the
 * editor is opened with them, to come back to it.
 */
export function NewVisModal({
  onClose,
  originatingApp,
  containerInfo,
}: {
  onClose: () => void;
  originatingApp?: string;
  containerInfo?: ContainerInfo;
}) {
  const state = editorStateFor(originatingApp, containerInfo);
  const [filter, setFilter] = useState('');
  const [hovered, setHovered] = useState<VisType>();
  const [chosen, setChosen] = useState<VisType>();

  const shown = useMemo(() => {
    const text = filter.trim().toLowerCase();
    // In the order of the letters' codes, as OpenSearch Dashboards lists them: TSVB before Tag Cloud
    const labs = labsEnabled();
    const list = [...VIS_TYPES, ...ALIASES]
      .filter((type) => labs || type.stage !== 'experimental')
      .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    return text ? list.filter((type) => type.title.toLowerCase().includes(text) || type.name.includes(text)) : list;
  }, [filter]);

  const create = (type: VisType, source: { indexPattern?: string; savedSearchId?: string } = {}) => {
    onClose();
    navigate(appUrl(VISUALIZE, '/create', { type: type.name, ...source, _g: currentGlobalParam() }), { force: true, state });
  };

  if (chosen) {
    return (
      <Modal title={`New ${chosen.title} / Choose a source`} onClose={onClose} wide>
        <div data-test-subj="visNewDialogSearch">
          <SavedObjectFinder
            types={SOURCE_TYPES}
            pageSize={10}
            onChoose={(object) => create(chosen, object.type === 'search' ? { savedSearchId: object.id } : { indexPattern: object.id })}
            empty={<p className="atlSubdued">No matching indices or saved searches found.</p>}
          />
        </div>
      </Modal>
    );
  }

  const described = hovered;
  return (
    <Modal title="New Visualization" onClose={onClose} wide>
      <div className="vzeNew" data-test-subj="visNewDialogTypes">
        <div className="vzeNew__types">
          {/* The original's compressed search field: 32 px, its magnifier 12 px */}
          <SearchField
            compact
            value={filter}
            onChange={setFilter}
            placeholder="Filter"
            aria-label="Filter for a visualization type"
            autoFocus
            testId="filterVisType"
          />
          <span className="atlScreenReaderOnly" aria-live="polite">
            {filter ? `${shown.length} ${shown.length === 1 ? 'type' : 'types'} found` : ''}
          </span>
          <ul className="vzeNew__grid">
            {shown.map((type) => {
              const alias = aliasOf(type);
              const drawn = Boolean(alias) || canDraw(type.name);
              return (
                <li key={type.name}>
                  <button
                    type="button"
                    className={cx('vzeNew__type', !drawn && 'vzeNew__type--off')}
                    aria-disabled={!drawn}
                    onMouseEnter={() => setHovered(type)}
                    onFocus={() => setHovered(type)}
                    onMouseLeave={() => setHovered(undefined)}
                    onBlur={() => setHovered(undefined)}
                    onClick={() => {
                      if (alias) {
                        onClose();
                        navigate(alias.open(), { force: true, state });
                        return;
                      }
                      if (!drawn) return;
                      if (type.aggBased) setChosen(type);
                      else create(type);
                    }}
                    data-test-subj={`visType-${type.name}`}
                  >
                    <Icon name={type.icon as IconName} className="atlIcon--l" />
                    <span>{type.title}</span>
                    {'stage' in type && type.stage === 'experimental' && (
                      <span className="vzeNew__mark" title="Experimental">
                        E
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="vzeNew__about" aria-live="polite">
          {described ? (
            <>
              <h3 className="atlTitleXs">{described.title}</h3>
              <p>
                {described.description}
                {aliasOf(described) ? '' : '.'}
              </p>
              {!aliasOf(described) && !canDraw(described.name) && <Badge tone="warning">Not in this build yet</Badge>}
              {'stage' in described && described.stage === 'experimental' && (
                <p className="atlSubdued atlSmall">
                  This visualization is experimental. The design and implementation are less mature than stable visualizations and might be subject
                  to change.
                </p>
              )}
            </>
          ) : (
            <>
              <h3 className="atlTitleXs">Select a visualization type</h3>
              <p>Start creating your visualization by selecting a type for that visualization.</p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
