/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Discover's "Download as CSV", as the original's: a button over a popover that offers the rows on
 * screen, or every hit up to 10,000 when there are more of them, and the messages that tell how
 * the download went.
 */

import { useId, useRef, useState } from 'react';
import { Button, CallOut } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Popover, downloadFile } from '../../components/overlay';
import type { RawHit } from '../../lib/docs';
import type { IndexPattern } from '../../lib/types';
import { services } from '../../services';
import { MAX_DOWNLOAD_CSV_COUNT, csvColumns, csvFileName, csvOptions, csvWriter, unparseCsv, type CsvOption } from './csv';

const META_FIELDS = ['_source', '_id', '_type', '_index', '_score'];

/** The file of some documents under the columns of the page, with the settings of the page */
export function discoverCsv(rows: RawHit[], indexPattern: IndexPattern, columns: string[]): string {
  const names = csvColumns(columns, indexPattern.timeFieldName, services.uiSettings.get<boolean>('doc_table:hideTimeColumn', false));
  const writer = csvWriter(indexPattern, services.formatSettings(), services.uiSettings.get<string[]>('metaFields', META_FIELDS));
  return unparseCsv(
    names,
    rows.map((row) => writer.row(row, names)),
    { delimiter: services.uiSettings.get<unknown>('csv:separator', ','), quotes: services.uiSettings.get<unknown>('csv:quoteValues', true) }
  );
}

/** Hands the file to the browser as the original's saveDataAsCsv: UTF-8 text after a byte order mark */
function saveCsv(csv: string) {
  downloadFile(csvFileName(new Date(), services.timeZone()), new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
}

export interface DownloadCsvProps {
  rows: RawHit[];
  /** How many documents matched */
  hits: number;
  indexPattern: IndexPattern;
  /** The columns of the page's state, as they are */
  columns: string[];
  /** The documents of the page's search again, as many as asked, without the histogram */
  fetchRows: (size: number, signal: AbortSignal) => Promise<RawHit[]>;
}

/**
 * The choices of the popover, as the original's DiscoverDownloadCsvPopoverContent: the rows on
 * screen or as many hits as may be downloaded, and the button that downloads the one chosen
 */
export function DownloadCsvPopoverContent({
  rowsCount,
  hitsCount,
  onDownload,
}: {
  rowsCount: number;
  hitsCount: number;
  onDownload: (option: CsvOption) => void;
}) {
  const name = useId();
  const [selected, setSelected] = useState<CsvOption>('visible');
  const { maxCount, showMax } = csvOptions(rowsCount, hitsCount);
  const options: Array<{ id: CsvOption; label: string; testId: string }> = [
    { id: 'visible', label: `Visible (${rowsCount.toLocaleString()})`, testId: 'dscDownloadCsvOptionVisible' },
    ...(showMax ? [{ id: 'max' as const, label: `Max available (${maxCount.toLocaleString()})`, testId: 'dscDownloadCsvOptionMax' }] : []),
  ];
  // The radios of the kit's RadioGroup, each in a box that carries its test id and holds its input
  // and its label, as the original's EuiRadio (scripts pick an option by the label in that box)
  return (
    <div className="dscDownloadCsvPopoverContent" data-test-subj="dscDownloadCsvPopoverContent">
      <div className="dscDownloadCsvPopoverContent__titleWrapper">
        <div data-test-subj="dscDownloadCsvTitle">
          <strong>Download as CSV</strong>
        </div>
      </div>
      <div className="dscDownloadCsvPopoverContent__form">
        <div className="dscDownloadCsvPopoverContent__options" role="radiogroup">
          {options.map((option) => (
            <div key={option.id} className="atlRadio" data-test-subj={option.testId}>
              <input
                type="radio"
                id={`${name}${option.id}`}
                name={name}
                value={option.id}
                checked={option.id === selected}
                onChange={() => setSelected(option.id)}
              />
              <label htmlFor={`${name}${option.id}`}>{option.label}</label>
            </div>
          ))}
        </div>
        {showMax && (
          <div className="dscDownloadCsvCallout" data-test-subj="dscDownloadCsvCallout">
            <CallOut tone="warning">There is a limit of {MAX_DOWNLOAD_CSV_COUNT.toLocaleString()} total result downloads.</CallOut>
          </div>
        )}
        <div className="dscDownloadCsvPopoverContent__submit">
          <Button full testId="dscDownloadCsvSubmit" onClick={() => onDownload(selected)}>
            Download CSV
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The button and its popover. "Max available" searches again for up to 10,000 documents while a
 * message, which can cancel it, says the file is being made; a message then says how it went.
 */
export function DownloadCsv({ rows, hits, indexPattern, columns, fetchRows }: DownloadCsvProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const loadingToast = useRef<number | undefined>(undefined);

  const dismissLoading = () => {
    if (loadingToast.current !== undefined) services.toasts.dismiss(loadingToast.current);
    loadingToast.current = undefined;
  };
  const cancel = () => {
    if (!controller.current) return;
    controller.current.abort();
    dismissLoading();
    services.toasts.warning('Download CSV cancelled');
  };

  const download = async (option: CsvOption) => {
    try {
      let chosen = rows;
      if (option === 'max') {
        setLoading(true);
        loadingToast.current = services.toasts.info(
          'Working on CSV file',
          <Button variant="dangerEmpty" testId="dscDownloadCsvAbort" onClick={cancel}>
            Cancel download
          </Button>,
          100000000
        );
        if (!hits) throw new Error('No hits');
        controller.current?.abort();
        controller.current = new AbortController();
        chosen = await fetchRows(Math.min(hits, MAX_DOWNLOAD_CSV_COUNT), controller.current.signal);
      }
      saveCsv(discoverCsv(chosen, indexPattern, columns));
      dismissLoading();
      services.toasts.success('CSV download successful.');
    } catch (failure) {
      // A cancelled download has said so already
      if ((failure as Error).name !== 'AbortError') {
        dismissLoading();
        services.toasts.danger('Unable to download CSV. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      position="downCenter"
      className="dscDownloadCsvPopover"
      button={
        <button
          type="button"
          className="dscResults__button"
          data-test-subj="dscDownloadCsvButton"
          disabled={loading}
          onClick={() => setOpen(true)}
        >
          <Icon name="download" />
          Download as CSV
        </button>
      }
    >
      <DownloadCsvPopoverContent
        rowsCount={rows.length}
        hitsCount={hits}
        onDownload={(option) => {
          setOpen(false);
          void download(option);
        }}
      />
    </Popover>
  );
}
