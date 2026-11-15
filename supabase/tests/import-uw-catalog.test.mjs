import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizePackage} from '../import-uw-catalog.mjs';

test('normalizes UW instructor display names without collecting account fields', () => {
  const pack = {
    docId: 'bundle',
    published: true,
    sections: [{
      type: 'LEC',
      sectionNumber: '001',
      instructionMode: 'Asynchronous Online',
      instructors: [
        {name: {first: ' Casey ', middle: null, last: 'Lee', legalFirst: 'Legal'}, email: 'qa@example.com'},
        {name: {first: 'Morgan', middle: 'J.', last: 'Shah'}},
        {name: '  Casey Lee  '},
        {name: {legalFirst: 'Only legal name'}},
        {name: null},
      ],
    }],
  };
  const result = normalizePackage(pack, {id: 'test-course'}, new Map());

  assert.deepEqual(result.instructors, ['Casey Lee', 'Morgan J. Shah']);
});
