/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The page that adds the sample data sets, opens what they bring and removes them, as the home
 * plugin of OpenSearch Dashboards draws it: /app/home#/tutorial_directory, and the same page as
 * an application of its own, /app/import_sample_data.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  INSTALLED_STATUS,
  UNINSTALLED_STATUS,
  type SampleDataSetSummary,
} from '../../../common/sample_data';
import { Button, CallOut, cx } from '../../components/basic';
import { Icon, type IconName } from '../../components/icon';
import { Popover, Tooltip } from '../../components/overlay';
import { href, navigate } from '../../router';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import { useBreadcrumbs } from '../../shell/state';
import '../../styles/sample_data.css';
import {
  dashboardPath,
  installSampleDataSet,
  listSampleDataSets,
  previewImageOf,
  uninstallSampleDataSet,
  viewDataLinks,
  withStatus,
  type SampleDataClientDeps,
} from './model';

// The icons of the original's links, in this product's set
const LINK_ICONS: Record<string, IconName> = {
  dashboardApp: 'dashboard',
  apmTrace: 'list',
  graphApp: 'share',
};

function clientDeps(): SampleDataClientDeps {
  return {
    http: services.http,
    uiSettings: services.uiSettings,
    indexPatterns: services.indexPatterns,
    onSettingError: (error) => services.toasts.danger('Unable to update UI setting', errorMessage(error)),
  };
}

/** "View data": the dashboard of the set, or a menu of it and the pages of other applications */
function ViewDataButton({ set }: { set: SampleDataSetSummary }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const menu = useRef<HTMLDivElement>(null);
  // The menu takes the focus on its first link, as the original's, once it is placed and shown
  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() =>
      menu.current?.querySelector<HTMLAnchorElement>('a')?.focus({ preventScroll: true })
    );
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  const label = 'View data';
  const ariaLabel = `View ${set.name}`;

  if (set.appLinks.length === 0 && set.overviewDashboard !== '') {
    return (
      <Button
        className="homSampleDataSetCard__button"
        testId={`launchSampleDataSet${set.id}`}
        aria-label={ariaLabel}
        onClick={() => navigate(dashboardPath(set.overviewDashboard))}
      >
        {label}
      </Button>
    );
  }

  const links = viewDataLinks(set, href);
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    // A click that opens another tab is the browser's; any other moves within the page
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    setOpen(false);
  };
  return (
    <span data-test-subj={`launchSampleDataSet${set.id}`}>
      <Popover
        open={open}
        onClose={close}
        align="center"
        className="homSampleDataLinks"
        button={
          <Button
            className="homSampleDataSetCard__button"
            aria-label={ariaLabel}
            icon="chevronDown"
            iconSide="right"
            onClick={() => setOpen((was) => !was)}
          >
            {label}
          </Button>
        }
      >
        <div ref={menu} className="atlMenu homSampleDataLinks__menu" role="menu" id={`sampleDataLinks${set.id}`}>
          {links.map((link) => (
            <a key={`${link.label}${link.href}`} role="menuitem" className="atlMenu__item" href={link.href} onClick={follow}>
              <Icon name={LINK_ICONS[link.icon] ?? 'link'} />
              <span className="atlGrow atlTruncate">{link.label}</span>
            </a>
          ))}
        </div>
      </Popover>
    </span>
  );
}

function CardFooter({
  set,
  processing,
  onInstall,
  onUninstall,
}: {
  set: SampleDataSetSummary;
  processing: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  if (set.status === INSTALLED_STATUS) {
    return (
      <div className="homSampleDataSetCard__footer homSampleDataSetCard__footer--spread">
        <Button
          variant="empty"
          className="homSampleDataSetCard__remove"
          loading={processing}
          onClick={onUninstall}
          testId={`removeSampleDataSet${set.id}`}
          aria-label={processing ? `Removing ${set.name}` : `Remove ${set.name}`}
        >
          {processing ? 'Removing' : 'Remove'}
        </Button>
        <ViewDataButton set={set} />
      </div>
    );
  }
  if (set.status === UNINSTALLED_STATUS) {
    return (
      <div className="homSampleDataSetCard__footer">
        <Button
          className="homSampleDataSetCard__button"
          loading={processing}
          onClick={onInstall}
          testId={`addSampleDataSet${set.id}`}
          aria-label={processing ? `Adding ${set.name}` : `Add ${set.name}`}
        >
          {processing ? 'Adding' : 'Add data'}
        </Button>
      </div>
    );
  }
  // The status could not be told: the button says why, and adds nothing, as the original's
  return (
    <div className="homSampleDataSetCard__footer">
      <Tooltip content={<p>Unable to verify dataset status, error: {set.statusMsg}</p>}>
        <Button className="homSampleDataSetCard__button" testId={`addSampleDataSet${set.id}`} aria-label={`Add ${set.name}`}>
          Add data
        </Button>
      </Tooltip>
    </div>
  );
}

function SampleDataSetCard({
  set,
  processing,
  onInstall,
  onUninstall,
}: {
  set: SampleDataSetSummary;
  processing: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const installed = set.status === INSTALLED_STATUS;
  const darkMode = services.uiSettings.get<boolean>('theme:darkMode', false) === true;
  return (
    <div
      className={cx('homSampleDataSetCard', installed && 'homSampleDataSetCard--installed')}
      data-test-subj={`sampleDataSetCard${set.id}`}
    >
      <div className="homSampleDataSetCard__top">
        <div className="homSampleDataSetCard__image">
          <img src={href(previewImageOf(set, darkMode))} alt="" />
        </div>
      </div>
      <div className="homSampleDataSetCard__content">
        <span className="homSampleDataSetCard__title atlTitleS">{set.name}</span>
        <div className="homSampleDataSetCard__description">
          <p>{set.description}</p>
        </div>
      </div>
      {installed && (
        <span className="homSampleDataSetCard__badgeWrapper">
          <span className="homSampleDataSetCard__badge" title="INSTALLED">
            INSTALLED
          </span>
        </span>
      )}
      <CardFooter set={set} processing={processing} onInstall={onInstall} onUninstall={onUninstall} />
    </div>
  );
}

function SampleDataSetCards() {
  const [sets, setSets] = useState<SampleDataSetSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [processing, setProcessing] = useState<Record<string, boolean>>({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    listSampleDataSets(clientDeps())
      .catch((error: unknown) => {
        services.toasts.danger('Unable to load sample data sets list', errorMessage(error));
        return [];
      })
      .then((list) => {
        if (!mounted.current) return;
        setSets(list);
        setProcessing({});
        setLoaded(true);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const busy = (id: string, value: boolean) => {
    if (mounted.current) setProcessing((was) => ({ ...was, [id]: value }));
  };

  const install = async (set: SampleDataSetSummary) => {
    busy(set.id, true);
    try {
      await installSampleDataSet(clientDeps(), set);
    } catch (error) {
      busy(set.id, false);
      services.toasts.danger(`Unable to install sample data set: ${set.name}`, errorMessage(error));
      return;
    }
    if (mounted.current) setSets((was) => withStatus(was, set.id, true));
    busy(set.id, false);
    services.toasts.success(`${set.name} installed`);
  };

  const uninstall = async (set: SampleDataSetSummary) => {
    busy(set.id, true);
    try {
      await uninstallSampleDataSet(clientDeps(), set);
    } catch (error) {
      busy(set.id, false);
      services.toasts.danger(`Unable to uninstall sample data set: ${set.name}`, errorMessage(error));
      return;
    }
    if (mounted.current) setSets((was) => withStatus(was, set.id, false));
    busy(set.id, false);
    services.toasts.success(`${set.name} uninstalled`);
  };

  if (loaded && sets.length === 0) {
    return (
      <div data-test-subj="sampleDataSetEmptyCallout">
        <CallOut tone="warning" title="Sample data not available">
          <p>
            Sample datasets are not supported for the selected data source. Switch to a supported
            data source to import sample data.
          </p>
        </CallOut>
      </div>
    );
  }

  return (
    <div className="homSampleDataSetCards">
      {sets.map((set) => (
        <div key={set.id} className="homSampleDataSetCards__item">
          <SampleDataSetCard
            set={set}
            processing={processing[set.id] === true}
            onInstall={() => void install(set)}
            onUninstall={() => void uninstall(set)}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The page. Within the home application its trail starts at Home; as an application of its own
 * it has only its name. The tab's title is the application's, as the original's.
 */
export function SampleDataPage({ withHomeBreadcrumb }: { withHomeBreadcrumb: boolean }) {
  useBreadcrumbs(
    withHomeBreadcrumb ? [{ text: 'Home', to: '/app/home#/' }, { text: 'Add data' }] : [{ text: 'Add data' }]
  );
  const title = withHomeBreadcrumb ? 'Home' : 'Add sample data';
  useEffect(() => {
    document.title = `${title} - ${services.boot.name}`;
  }, [title]);

  return (
    <div className="homSampleData">
      <main className="homSampleData__body">
        <h1 className="homSampleData__title atlTitleL">Add sample data</h1>
        <SampleDataSetCards />
      </main>
    </div>
  );
}
