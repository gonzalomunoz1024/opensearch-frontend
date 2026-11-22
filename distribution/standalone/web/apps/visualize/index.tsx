/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Visualize: the list of saved visualizations, the dialog a new one starts from (its kind, then
 * the index pattern or the saved search it is drawn from), and the editor.
 */

import { useMemo, useState } from 'react';
import { Badge, cx } from '../../components/basic';
import { SearchField } from '../../components/form';
import { Icon, type IconName } from '../../components/icon';
import { Modal } from '../../components/overlay';
import { appUrl } from '../../lib/url';
import { VIS_TYPES, visIcon, visType, type VisType } from '../../lib/vis';
import { navigate, navigateHash, useLocation } from '../../router';
import { Listing, type Listed } from '../../shell/listing';
import { SavedObjectFinder } from '../../shell/saved_objects_ui';
import { currentGlobalParam, useBreadcrumbs } from '../../shell/state';
import { canDraw } from '../../vis/visualization';
import { VIS_BUILDER_APP, VIS_BUILDER_TITLE, VIS_BUILDER_TYPE, visBuilderEditUrl } from '../vis_builder/model';
import { VISUALIZE, VisEditor } from './editor';
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

const typeTitle = (type: string) => (type === VIS_BUILDER_TYPE ? VIS_BUILDER_TITLE : (visType(type)?.title ?? type));

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
        entity="visualization"
        entities="visualizations"
        types={[VIS_BUILDER_TYPE, 'visualization']}
        fields={['title', 'description', 'visState']}
        createLabel="Create visualization"
        onCreate={() => setDialog(true)}
        linkTo={editUrl}
        editTo={editUrl}
        extraColumns={[
          {
            id: 'type',
            name: 'Type',
            width: 170,
            render: (object) => {
              const type = typeOf(object);
              return (
                <span className="atlRow">
                  <Icon name={type === VIS_BUILDER_TYPE ? 'visBuilder' : (visIcon(type) as IconName)} />
                  {typeTitle(type)}
                </span>
              );
            },
            sortValue: (object) => typeTitle(typeOf(object)),
          },
        ]}
        emptyBody="You can create different visualizations based on your data."
        testId="visualizeLandingPage"
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

/** "New Visualization": every kind there is, then what an aggregation-based one is drawn from */
export function NewVisModal({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const [hovered, setHovered] = useState<VisType>();
  const [chosen, setChosen] = useState<VisType>();

  const shown = useMemo(() => {
    const text = filter.trim().toLowerCase();
    // In the order of the letters' codes, as OpenSearch Dashboards lists them: TSVB before Tag Cloud
    const list = [...VIS_TYPES, ...ALIASES].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    return text ? list.filter((type) => type.title.toLowerCase().includes(text) || type.name.includes(text)) : list;
  }, [filter]);

  const create = (type: VisType, source: { indexPattern?: string; savedSearchId?: string } = {}) => {
    onClose();
    navigate(appUrl(VISUALIZE, '/create', { type: type.name, ...source, _g: currentGlobalParam() }), { force: true });
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
          <SearchField value={filter} onChange={setFilter} placeholder="Filter" aria-label="Filter for a visualization type" autoFocus testId="filterVisType" />
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
                        navigate(alias.open(), { force: true });
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
