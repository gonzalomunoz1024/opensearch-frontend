/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What a TSVB panel shows in its body when its request failed, or when its markdown could not be
 * filled in: an alert icon, a title and the reason, read from the error as the product reads it.
 * The product's server turns a failure into this shape (handle_error_response.js); here the
 * browser does, since it sends the requests itself.
 */

import { Icon } from '../../components/icon';
import { HttpFetchError } from '../../services/http';

/** A failure as the product hands it to its panel: OpenSearch's error, or a message */
export interface TsvbPanelError {
  message?: string;
  error?: {
    type?: string;
    reason?: string;
    caused_by?: {
      type?: string;
      reason?: string;
      title?: string;
      script_stack?: string[];
      caused_by?: { reason?: string };
    };
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The error a panel shows for what made its request fail */
export function panelError(failure: unknown): TsvbPanelError {
  // A query in DQL that could not be read gives the reason alone, without the query and the mark
  // under it
  if (isRecord(failure) && failure.name === 'DQLSyntaxError') {
    return { message: typeof failure.shortMessage === 'string' ? failure.shortMessage : String(failure.message) };
  }
  if (failure instanceof HttpFetchError) {
    let body = failure.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // Not JSON: the message stands
      }
    }
    if (isRecord(body) && isRecord(body.error)) return body as TsvbPanelError;
  }
  return { message: failure instanceof Error ? failure.message : String(failure) };
}

// The ids OpenSearch writes in square brackets in some of its reasons
const GUID_PATTERN = /\[[[a-f\d-\\]{36}\]/g;

/** The title, the reason and the script stack the product shows for an error */
export function errorDetails(error: TsvbPanelError): { title?: string; reason?: string; stack?: string } {
  const causedBy = error.error?.caused_by;
  const type = causedBy?.type || error.error?.type;
  let reason = causedBy?.reason || error.message;
  if (type === 'runtime_exception' || type === 'illegal_argument_exception') {
    reason = (error.error?.reason ?? '').replace(GUID_PATTERN, '');
  }
  if (type === 'script_exception') {
    return { title: causedBy?.title, reason: causedBy?.caused_by?.reason, stack: (causedBy?.script_stack ?? []).join('\n') };
  }
  return { title: causedBy?.title, reason: reason || undefined };
}

export function TsvbError({ error }: { error: TsvbPanelError }) {
  const { title, reason, stack } = errorDetails(error);
  return (
    <div className="visTsvbError">
      <div>
        <Icon name="warning" className="visTsvbError__icon" />
        <div className="visTsvbError__spacer" />
        {title || 'The request for this panel failed'}
        {stack !== undefined ? (
          <div className="visTsvbError__additional">
            <div>{reason}</div>
            <div className="visTsvbError__stack">{stack}</div>
          </div>
        ) : (
          reason && <div className="visTsvbError__additional">{reason}</div>
        )}
      </div>
    </div>
  );
}
