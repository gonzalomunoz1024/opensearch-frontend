/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The indices at the left of Query Workbench, as the plugin's tree of them: one row per index
 * with the database icon and its name cut to 50 characters (the whole name in a tooltip), rows
 * that open and close as the component library's tree view's do, and the same words while it
 * loads, when there is no index and when the list cannot be had.
 */

import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Spinner, cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Tooltip } from '../../components/overlay';
import { services } from '../../services';
import { indexTreeOf, truncateName, type IndexTree } from './model';

/** Asks the server for the indices, with the query of the version it runs on */
async function loadTree(query: string): Promise<IndexTree> {
  try {
    return indexTreeOf(await services.http.post('/api/sql_console/sqlquery', { body: { query } }));
  } catch {
    return indexTreeOf(undefined);
  }
}

/** A column of the tree's states: a spacer, then what it says, centred */
function TreeState({ children }: { children: ReactNode }) {
  return (
    <div className="qwbTreeState">
      <div className="qwbSpacer qwbSpacer--l" />
      {children}
    </div>
  );
}

function Nodes({ names }: { names: string[] }) {
  const treeId = `qwbTree${useId().replace(/:/g, '')}`;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<string>();

  const toggle = (id: string) => {
    setActive(id);
    setOpen((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // As the component library's tree: the arrows up and down go from row to row, right opens a
  // row and left closes it
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const buttons = [
        ...document.querySelectorAll<HTMLButtonElement>(`[data-test-subj="euiTreeViewButton-${treeId}"]`),
      ];
      const index = buttons.indexOf(event.currentTarget);
      const next = index < 0 ? undefined : buttons[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        event.preventDefault();
        setActive(next.id);
        next.focus();
      }
    } else if (event.key === 'ArrowRight' && !open.has(id)) {
      event.preventDefault();
      toggle(id);
    } else if (event.key === 'ArrowLeft' && open.has(id)) {
      event.preventDefault();
      toggle(id);
    }
  };

  return (
    <div className="qwbTree">
      <p id={`${treeId}--instruction`} className="atlScreenReaderOnly">
        You can quickly navigate this list using arrow keys.
      </p>
      <ul
        className="qwbTree__list"
        id={treeId}
        aria-describedby={`${treeId}--instruction`}
        aria-label="OpenSearch Folder Tree"
        data-test-subj="opensearch-tree"
      >
        {names.map((name, index) => {
          const id = `element_${index}`;
          const isOpen = open.has(id);
          return (
            <li key={`${name}/${index}`} className={cx('qwbTree__node', isOpen && 'qwbTree__node--open')}>
              <button
                type="button"
                id={id}
                className={cx('qwbTree__button', active === id && 'qwbTree__button--active')}
                aria-controls={`${treeId}_${id}`}
                aria-expanded={isOpen}
                data-test-subj={`euiTreeViewButton-${treeId}`}
                onClick={() => toggle(id)}
                onKeyDown={(event) => onKeyDown(event, id)}
              >
                <span className="qwbTree__icon">
                  <Icon name="database" />
                </span>
                <span className="qwbTree__label">
                  <Tooltip content={name} position="right" delay="long">
                    <span className="qwbTree__text">{truncateName(name)}</span>
                  </Tooltip>{' '}
                </span>
              </button>
              <div id={`${treeId}_${id}`} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The indices of the cluster, loaded once with the query of its version */
export function IndexTree({ query }: { query: string }) {
  const [tree, setTree] = useState<IndexTree>();
  useEffect(() => {
    let stale = false;
    setTree(undefined);
    void loadTree(query).then((loaded) => {
      if (!stale) setTree(loaded);
    });
    return () => {
      stale = true;
    };
  }, [query]);

  if (!tree) {
    return (
      <TreeState>
        <div className="qwbTreeState__item">
          <Spinner size="l" />
        </div>
        <div className="qwbTreeState__item qwbTreeState__item--fixed">Loading indices</div>
      </TreeState>
    );
  }
  if ('message' in tree) {
    return (
      <TreeState>
        <div className="qwbTreeState__item">
          <Icon name="alert" />
        </div>
        <div className="qwbTreeState__item qwbTreeState__item--fixed">Failed to load indices</div>
        <div className="qwbTreeState__item qwbTreeState__item--fixed">
          <div className="qwbTreeState__message">
            <div className="qwbTreeState__text">{tree.message}</div>
          </div>
        </div>
      </TreeState>
    );
  }
  if (tree.names.length === 0) {
    return (
      <TreeState>
        <div className="qwbTreeState__item">
          <Icon name="database" />
        </div>
        <div className="qwbTreeState__item qwbTreeState__item--fixed">No indices found</div>
      </TreeState>
    );
  }
  return <Nodes names={tree.names} />;
}

/** What the column shows at the address of a data source, with no data source to pick */
export function ConnectionPrompt() {
  return (
    <div className="qwbPrompt">
      <span className="qwbPrompt__icon">
        <Icon name="database" />
      </span>
      <div className="qwbSpacer qwbSpacer--m" />
      <div className="qwbPrompt__body">
        <p>Select a Data Source Connection to fetch Databases</p>
      </div>
    </div>
  );
}
