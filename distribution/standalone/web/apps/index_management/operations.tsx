/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What can be done to indexes, aliases and data streams alike: clearing their caches, flushing
 * and refreshing them. Each dialog first finds which of the chosen ones are closed, blocked or
 * red, names those apart, and does the operation to the rest.
 */

import { useEffect, useState } from 'react';
import { CallOut } from '../../components/basic';
import { services } from '../../services';
import { ism, toasts } from './common';
import { ModalButtons, ModalNames, PluginModal } from './plugin_modal';
import {
  BLOCKS,
  SINGULAR,
  blockedIndices,
  clearCacheToast,
  closedWording,
  flushBlockedMessage,
  flushToast,
  redOpenIndices,
  refreshToast,
  splitBlocked,
  type Operand,
  type Target,
} from './model';

// --- Which of the chosen ones can be worked on ----------------------------------------------------------

interface Split {
  unBlockedItems: string[];
  blockedItems: string[];
}

/** Sorts the chosen items into those an operation can be done to and those it cannot */
export async function filterBlockedItems(
  items: Operand[],
  blocks: string[],
  target: Target,
  filterRed = false
): Promise<Split> {
  let red: string[] = [];
  if (filterRed) {
    if (items.length === 0 && target !== 'indexes') {
      throw new Error('Can only filter red indexes for type index.');
    }
    const answer = await ism.call<string>('cat.indices', { h: 'i,s', health: 'red' });
    if (!answer.ok) throw new Error(answer.error);
    red = redOpenIndices(answer.response);
  }
  if (items.length === 0) return { unBlockedItems: [], blockedItems: red };
  const state = await ism.call('cluster.state', { metric: 'blocks' });
  if (!state.ok) throw new Error(state.error);
  const blocked = blockedIndices(state.response, blocks);
  for (const index of red) blocked.add(index);
  return splitBlocked(items, blocked);
}

interface OperationProps {
  items: Operand[];
  target: Target;
  onClose: () => void;
}

/** The split of the chosen items, once it is known; every item is taken as free when it cannot be told */
function useSplit(
  { items, target }: OperationProps,
  blocks: string[],
  filterRed: boolean,
  settle: (split: Split) => boolean
) {
  const [split, setSplit] = useState<Split>();
  useEffect(() => {
    let live = true;
    filterBlockedItems(items, blocks, target, filterRed)
      .catch((): Split => ({ unBlockedItems: items.map((item) => item.name), blockedItems: [] }))
      .then((found) => {
        if (live && settle(found)) setSplit(found);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return split;
}

// --- Clear cache ----------------------------------------------------------------------------------------

const CLEAR_HINTS: Record<Target, [string, string]> = {
  indexes: [
    'Cache will be cleared for the following indexes.',
    'Cache will not be cleared for the following indexes because they may be closed or blocked.',
  ],
  aliases: [
    'Cache will be cleared for the following aliases.',
    'Cache will not be cleared for the following aliases because one or more indexes are closed or blocked.',
  ],
  'data streams': [
    'Cache will be cleared for the following data streams.',
    'Cache will not be cleared for the following data streams because one or more backing indexes are closed or blocked.',
  ],
};

export function ClearCacheModal(props: OperationProps) {
  const { items, target, onClose } = props;
  const split = useSplit(
    props,
    [BLOCKS.CLOSED, BLOCKS.META_DATA, BLOCKS.READ_ONLY, BLOCKS.READ_ONLY_ALLOW_DELETE],
    false,
    (found) => {
      if (items.length === 0 || found.blockedItems.length !== items.length) return true;
      toasts.danger(
        'Unable to clear cache',
        items.length === 1
          ? `Cache cannot be cleared for ${found.blockedItems[0]} because it is closed or blocked.`
          : `Cache cannot be cleared for the selected ${target} because they are closed or blocked.`
      );
      onClose();
      return false;
    }
  );
  if (!split) return null;
  const { unBlockedItems, blockedItems } = split;
  const [hint, blockHint] = CLEAR_HINTS[target];

  const confirm = async () => {
    const result = await ism.call('indices.clearCache', { index: unBlockedItems.join(',') || '_all' });
    if (result.ok) {
      onClose();
      toasts.success(clearCacheToast(target, unBlockedItems, items.length === 0));
    } else {
      // As the plugin's: a message that offers the whole error
      services.toasts.addError(new Error(result.error ?? ''), {
        title: 'Clear cache failed.',
        toastMessage: result.error?.includes('cluster_block_exception') ? 'One or more indexes are blocked.' : undefined,
      });
    }
  };

  return (
    <PluginModal
      title={<>Clear cache for {target}</>}
      onClose={onClose}
      footer={
        <ModalButtons
          label="Clear cache"
          disabled={items.length > 0 && unBlockedItems.length === 0}
          onCancel={onClose}
          onConfirm={() => void confirm()}
          cancelTestId="ClearCacheCancelButton"
          confirmTestId="ClearCacheConfirmButton"
        />
      }
    >
      {items.length === 0 ? (
        <>
          <p>Cache will be cleared for all open indexes.</p>
          <div className="ismSpacer ismSpacer--l" />
        </>
      ) : (
        <>
          {unBlockedItems.length > 0 && (
            <>
              <p>{hint}</p>
              <ModalNames names={unBlockedItems} />
              <div className="ismSpacer ismSpacer--l" />
            </>
          )}
          {blockedItems.length > 0 && (
            <CallOut tone="warning" size="s">
              <p className="ismModal__small">{blockHint}</p>
              <ModalNames names={blockedItems} within="callOutSmall" />
            </CallOut>
          )}
        </>
      )}
    </PluginModal>
  );
}

// --- Flush ----------------------------------------------------------------------------------------------

export function FlushModal(props: OperationProps) {
  const { items, target, onClose } = props;
  const flushAll = items.length === 0 && target === 'indexes';
  const split = useSplit(props, [BLOCKS.CLOSED], true, (found) => {
    if (items.length > 0 && items.length === found.blockedItems.length) {
      toasts.danger(
        `Unable to flush ${target}`,
        `The selected ${target} cannot be flushed because they are either closed or in red status.`
      );
      onClose();
      return false;
    }
    if (items.length === 0 && found.blockedItems.length > 0) {
      toasts.danger(
        `Unable to flush ${target}`,
        `Can not flush all open indexes because indexes [${found.blockedItems.join(',')}] are in red status.`
      );
      onClose();
      return false;
    }
    return true;
  });
  if (!split) return null;
  const { unBlockedItems, blockedItems } = split;

  const confirm = async () => {
    const result = await ism.call('indices.flush', { index: unBlockedItems.join(', ') });
    if (result.ok) toasts.success(flushToast(target, unBlockedItems));
    else toasts.danger(`Unable to flush ${target}`, result.error);
    onClose();
  };

  return (
    <PluginModal
      title={<>Flush {target}</>}
      titleTestId="flushModalTitle"
      onClose={onClose}
      footer={
        <ModalButtons
          label="Flush"
          onCancel={onClose}
          onConfirm={() => void confirm()}
          cancelTestId="flushCancelButton"
          confirmTestId="flushConfirmButton"
        />
      }
    >
      {flushAll && <p>All open indexes will be flushed.</p>}
      {unBlockedItems.length > 0 && (
        <>
          <p>{`The following ${target} will be flushed:`}</p>
          <ModalNames names={unBlockedItems} />
        </>
      )}
      {/* The plugin's two spacers stand whether or not the warning between them shows */}
      <div className="ismSpacer ismSpacer--l" />
      {blockedItems.length > 0 && (
        <div data-test-subj="flushBlockedCallout">
          <CallOut tone="warning" size="s">
            <p className="ismModal__small">{flushBlockedMessage(target)}</p>
            <ModalNames names={blockedItems} within="callOutSmall" />
          </CallOut>
        </div>
      )}
      <div className="ismSpacer ismSpacer--l" />
    </PluginModal>
  );
}

// --- Refresh --------------------------------------------------------------------------------------------

export function RefreshModal(props: OperationProps) {
  const { items, target, onClose } = props;
  const split = useSplit(props, [BLOCKS.CLOSED], true, (found) => {
    if (items.length === 0 && found.blockedItems.length > 0) {
      const verb = found.blockedItems.length === 1 ? 'is' : 'are';
      toasts.danger(
        'Unable to refresh indexes.',
        `Cannot refresh all open indexes because [${found.blockedItems.join(', ')}] ${verb} in red status.`
      );
      onClose();
      return false;
    }
    if (items.length > 0 && found.unBlockedItems.length === 0) {
      toasts.danger(
        `Unable to refresh ${target}.`,
        `All selected ${target} cannot be refreshed because ${closedWording(target)} are either closed or in red status.`
      );
      onClose();
      return false;
    }
    return true;
  });
  if (!split) return null;
  const { unBlockedItems, blockedItems } = split;
  const one = (count: number) => (count === 1 ? SINGULAR[target] : target);

  const confirm = async () => {
    const result = await ism.call('indices.refresh', { index: unBlockedItems.join(',') });
    if (result.ok) {
      toasts.success(refreshToast(target, unBlockedItems, items.length === 0 && blockedItems.length === 0));
      onClose();
    } else {
      toasts.danger(result.error);
    }
  };

  return (
    <PluginModal
      title={<>Refresh {target}</>}
      onClose={onClose}
      footer={
        <ModalButtons
          label="Refresh"
          onCancel={onClose}
          onConfirm={() => void confirm()}
          confirmTestId="refreshConfirmButton"
        />
      }
    >
      {items.length === 0 && blockedItems.length === 0 && <p>All open indexes will be refreshed.</p>}
      {unBlockedItems.length > 0 && (
        <>
          <p>{`The following ${one(unBlockedItems.length)}`} will be refreshed.</p>
          <ModalNames names={unBlockedItems} testId={(name) => `UnblockedItem-${name}`} />
        </>
      )}
      <div className="ismSpacer ismSpacer--l" />
      {blockedItems.length > 0 && (
        <CallOut
          tone="warning"
          size="s"
          icon="alert"
          title={`The following ${one(blockedItems.length)} cannot be refreshed because ${closedWording(target)} are either closed or in red status.`}
        >
          <ModalNames names={blockedItems} testId={(name) => `BlockedItem-${name}`} within="callOutTitled" />
        </CallOut>
      )}
    </PluginModal>
  );
}
