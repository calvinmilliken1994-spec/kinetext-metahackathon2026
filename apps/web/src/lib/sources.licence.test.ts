/// <reference types="node" />
// Stage 7e sweep: a library page's licence is shown in plain words ('U.S. Government work'), never the registry id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLicenseText } from './sources.ts';
import { licenceText } from './presentation.ts';

test('library licence ids read as plain words, matching the presentation title card', () => {
  assert.equal(sourceLicenseText({ title: 't', license: 'US-Gov-Work', kind: 'library' }), 'U.S. Government work');
  assert.equal(sourceLicenseText({ title: 't', license: 'US-Gov-Work' }), licenceText('US-Gov-Work'));
  assert.equal(sourceLicenseText({ title: 't', license: 'CC-BY-4.0', kind: 'library' }), 'CC BY 4.0');
  assert.equal(sourceLicenseText({ title: 't', license: 'NASA media guidelines', kind: 'library' }), 'NASA media guidelines', 'free text stays');
});
