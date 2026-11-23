/* SPDX-License-Identifier: Apache-2.0 */

/* What the date picker of the bar names as the original's super date picker does. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commonlyUsedTestId } from '../../web/shell/time_picker';

describe('the commonly used ranges of the quick menu', () => {
  it('are known to tests by their name, with a line in place of its first space only', () => {
    assert.equal(commonlyUsedTestId('Today'), 'superDatePickerCommonlyUsed_Today');
    assert.equal(commonlyUsedTestId('This week'), 'superDatePickerCommonlyUsed_This_week');
    assert.equal(commonlyUsedTestId('Last 15 minutes'), 'superDatePickerCommonlyUsed_Last_15 minutes');
  });
});
