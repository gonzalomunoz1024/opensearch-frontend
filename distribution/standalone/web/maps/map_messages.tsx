/* SPDX-License-Identifier: Apache-2.0 */

/* What a map says about its base map: map_messages of maps_legacy. */

import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Button, EmptyPrompt } from '../components/basic';
import { services } from '../services';

const regionDeniedRoots = new Map<HTMLElement, Root>();

/** Over every map of the page: the default tile service does not serve this region */
export function createRegionDeniedWarning() {
  if (document.getElementById('blocker-div')) return;
  const messageBlock = document.createElement('div');
  messageBlock.id = 'blocker-div';
  messageBlock.setAttribute('class', 'visError leaflet-popup-pane');
  // As the original: the one element moves into each map in turn, so it ends in the last
  for (const leafletDom of Array.from(document.getElementsByClassName('leaflet-container'))) {
    const container = leafletDom.appendChild(messageBlock);
    const root = createRoot(container);
    root.render(
      <EmptyPrompt icon="map" title="The default Web Map Service is currently not available in your region.">
        <p>
          You can configure OpenSearch Dashboards to use a different map server for coordinate maps by modifying the
          default WMS properties.
        </p>
      </EmptyPrompt>
    );
    regionDeniedRoots.set(container, root);
  }
}

export function removeRegionDeniedWarning() {
  const element = document.getElementById('blocker-div');
  if (!element) return;
  const root = regionDeniedRoots.get(element);
  if (root) {
    root.unmount();
    regionDeniedRoots.delete(element);
  }
  element.parentNode?.removeChild(element);
}

let zoomMessageDisabled = false;

function ZoomWarning() {
  const [disabled, setDisabled] = useState(false);
  return (
    <div>
      <p>
        You've reached the maximum number of zoom levels. To zoom all the way in, you can configure your own map
        server. Please go to{' '}
        <a className="atlLink" target="_blank" rel="noopener noreferrer" href="https://opensearch.org/docs/latest/dashboards/maptiles/">
          Custom WMS Configuration
        </a>{' '}
        for more information.
      </p>
      <Button
        size="s"
        variant="empty"
        disabled={disabled}
        data-test-subj="suppressZoomWarnings"
        onClick={() => {
          setDisabled(true);
          zoomMessageDisabled = true;
        }}
      >
        Don't show again
      </Button>
    </div>
  );
}

/** At the last zoom level of the maps service: a message that one's own map server goes further */
export function createZoomWarningMsg(getZoomLevel: () => number, getMaxZoomLevel: () => number) {
  return () => {
    if (!zoomMessageDisabled && getZoomLevel() === getMaxZoomLevel()) {
      services.toasts.danger('No additional zoom levels', <ZoomWarning />);
    }
  };
}
