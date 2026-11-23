/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What Discover shows in place of its results when no index pattern is chosen (the address names
 * one that cannot be read), as the original's DiscoverNoIndexPatterns: a call to pick one, and
 * where to read about each query language the query bar offers.
 */

import { Fragment } from 'react';
import { EmptyPrompt } from '../../components/basic';
import { Icon } from '../../components/icon';
import { DQL_DOCS } from '../../shell/query_bar';

/** The query bar's languages and their documentation, in the original's order */
const LANGUAGE_DOCS = [
  { title: 'DQL documentation', url: DQL_DOCS },
  { title: 'Lucene documentation', url: 'https://opensearch.org/docs/latest/query-dsl/full-text/query-string/' },
];

export function SelectData() {
  return (
    <div className="dscUninitialized" data-test-subj="discoverNoIndexPatterns">
      <EmptyPrompt icon="visBarVertical" title="Select data">
        <p>
          Select an available data source and choose a query language to use for running queries. You can use the data
          dropdown or use the enhanced data selector to select data.
        </p>
        <h4>Learn more about query languages</h4>
        <p>
          {LANGUAGE_DOCS.map((doc, index) => (
            <Fragment key={doc.title}>
              {index > 0 && ' '}
              <a href={doc.url} target="_blank" rel="noopener noreferrer">
                {doc.title} <Icon name="popout" />
              </a>
            </Fragment>
          ))}
        </p>
      </EmptyPrompt>
    </div>
  );
}
