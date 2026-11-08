const test = require('node:test');
const assert = require('node:assert/strict');
const {voicesFrom, voiceName, voiceGroups} = require('../app/src/main/assets/web/live.js');

test('Live picker excludes Korean-only voices and uses English labels', () => {
  assert.deepEqual(voicesFrom({voices:{v1:['cove','sol'],v3:['cove','hanul','haetsal','miko'],defaultV1:'cove'}}), {
    ids:['cove','miko'],defaultVoice:'cove'
  });
  const groups = voiceGroups(['cove','miko','future_voice']);
  assert.deepEqual(groups, [
    {label:'English', ids:['cove']},
    {label:'German', ids:['miko']},
    {label:'Other', ids:['future_voice']},
  ]);
  assert.equal(voiceName('future_voice'),'Future Voice');
  assert.doesNotMatch(JSON.stringify(groups),/[\uAC00-\uD7AF]/);
});

test('older runtimes without v3 retain supported non-Korean voices', () => {
  assert.deepEqual(voicesFrom({voices:{v1:['cove','sol','hanul'],defaultV1:'cove'}}), {
    ids:['cove','sol'],defaultVoice:'cove'
  });
});

test('an empty v3 selection falls back to the legacy catalog', () => {
  assert.deepEqual(voicesFrom({voices:{v1:['cove','sol'],v3:[],defaultV1:'cove'}}), {
    ids:['cove','sol'],defaultVoice:'cove'
  });
});

test('a v3 catalog containing only excluded voices falls back to v1', () => {
  assert.deepEqual(voicesFrom({voices:{v1:['cove','sol'],v3:['hanul','haetsal'],defaultV1:'cove'}}), {
    ids:['cove','sol'],defaultVoice:'cove'
  });
});
