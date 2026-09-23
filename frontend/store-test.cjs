// CommonJS 逻辑测试：localStorage mock + 失败注入
let storage = {};
let failWrites = false;
const localStorageMock = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => {
    if (failWrites) {
      const e = new Error('Quota');
      e.name = 'QuotaExceededError';
      throw e;
    }
    storage[k] = v;
  },
  removeItem: (k) => { delete storage[k]; },
  clear: () => { storage = {}; },
};
globalThis.localStorage = localStorageMock;

const { useEEGStore } = require('./.testbuild/store/eeg.js');

const mkEEG = () => ({ channels: ['Fp1', 'Fp2'], sample_rate: 256, data: { Fp1: [1, 2, 3], Fp2: [4, 5, 6] }, time: [0, 1, 2], duration: 3 });
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } };

const s = () => useEEGStore.getState();

// 1. empty stop -> error, no recording
let r = s().stopRecording('x');
check('empty stop rejected', !r.ok && /没有采集到任何数据帧/.test(r.error || ''));
check('no recording saved', s().recordings.length === 0);

// 2. create one recording with 3 frames
s().startRecording();
const bs = { focus: 1, relaxation: 2, fatigue: 3, status: 'neutral', statusLabel: '平稳', statusColor: '#000', timestamp: 0 };
const corr = { targetChannel: 'Fp1', correlations: [{ channel: 'Fp2', targetChannel: 'Fp1', correlation: 0.5, coherence: 0.6 }] };
s().addRecordingFrame(mkEEG(), { delta: 1, theta: 1, alpha: 1, beta: 1, gamma: 1 }, bs, corr);
s().addRecordingFrame(mkEEG(), { delta: 2, theta: 2, alpha: 2, beta: 2, gamma: 2 }, bs, corr);
s().addRecordingFrame(mkEEG(), { delta: 3, theta: 3, alpha: 3, beta: 3, gamma: 3 }, bs, corr);
r = s().stopRecording('测试录制');
check('recording saved', r.ok);
const rec = s().recordings[0];
check('recording has empty annotations default', Array.isArray(rec.annotations) && rec.annotations.length === 0);
rec.frames[0].relativeTime = 0; rec.frames[1].relativeTime = 3; rec.frames[2].relativeTime = 6;
rec.duration = 9;
localStorageMock.setItem('eeg_recordings', JSON.stringify(s().recordings));

// 3. batch add validation (atomic)
r = s().addAnnotations(rec.id, [
  { label: '好片段', start: 1, end: 2 },
  { label: '', start: 0, end: 1 },
]);
check('batch with empty label rejected atomically', !r.ok && /第 2 条/.test(r.error || ''));
check('no partial annotation written', s().recordings.find(x => x.id === rec.id).annotations.length === 0);

r = s().addAnnotations(rec.id, [{ label: '越界', start: 9.5, end: 10 }]);
check('out of range start rejected', !r.ok && /超出录制时长/.test(r.error || ''));

r = s().addAnnotations(rec.id, [{ label: '反转', start: 5, end: 2 }]);
check('end<start rejected', !r.ok && /终点早于起点/.test(r.error || ''));

r = s().addAnnotations(rec.id, [
  { label: 'A', start: 1, end: 2 },
  { label: 'B', start: 4, end: 5 },
  { label: 'C', start: 0, end: 9 },
]);
check('valid batch accepted', r.ok);
const anns = s().recordings.find(x => x.id === rec.id).annotations;
check('three annotations stored', anns.length === 3);
check('full-range end clamped to duration', anns[2].end === 9);

// 4. jump -> correct frame for the segment
s().setChannel('O2'); // 用户实时关注 O2
const bId = anns[1].id;
r = s().jumpToAnnotation(rec.id, bId);
check('jump ok', r.ok);
check('jump currentTime = annotation start (4)', s().playbackState.currentTime === 4);
check('jump picked correct frame (relativeTime 3)', s().playbackState.currentFrame.relativeTime === 3);
check('jump synced eeg/bands/brainstate for frame', s().bandPower.delta === 2);
check('jump paused playback', s().playbackState.isPlaying === false);
check('jump switched to recording channel', s().selectedChannel === rec.channel);
check('jump remembered restore channel O2', s().restoreChannel === 'O2');
s().jumpToAnnotation(rec.id, anns[0].id);
check('jump start=1 picks frame 0', s().playbackState.currentFrame.relativeTime === 0);
s().jumpToAnnotation(rec.id, anns[2].id);
check('jump start=0 picks frame 0', s().playbackState.currentFrame.relativeTime === 0);
r = s().jumpToAnnotation(rec.id, 'nope');
check('jump missing annotation errors', !r.ok);

// 5. setPlaybackTime clamps
s().setPlaybackTime(NaN);
check('NaN time clamps to 0', s().playbackState.currentTime === 0);
s().setPlaybackTime(100);
check('over-range clamps to duration', s().playbackState.currentTime === 9);
check('over-range picks last frame', s().playbackState.currentFrame.relativeTime === 6);

s().exitPlaybackMode();
check('exit restores user channel O2', s().selectedChannel === 'O2' && s().restoreChannel === null);

// 6. update annotation
r = s().updateAnnotation(rec.id, anns[0].id, { label: 'A2', start: 2.5, end: 3.5 });
check('update ok', r.ok);
const updated = s().recordings.find(x => x.id === rec.id).annotations.find(a => a.id === anns[0].id);
check('update applied', updated.label === 'A2' && updated.start === 2.5 && updated.end === 3.5);
r = s().updateAnnotation(rec.id, anns[0].id, { start: 20 });
check('update out-of-range rejected and original intact', !r.ok && updated.start === 2.5);
r = s().updateAnnotation(rec.id, anns[0].id, { label: '   ' });
check('update blank label rejected', !r.ok);

// 7. group delete
r = s().deleteAnnotations(rec.id, [anns[0].id, anns[1].id]);
check('group delete ok', r.ok);
check('one annotation left', s().recordings.find(x => x.id === rec.id).annotations.length === 1);
r = s().deleteAnnotations(rec.id, ['bogus']);
check('delete non-existent set errors', !r.ok);
check('remaining annotation untouched after failed delete', s().recordings.find(x => x.id === rec.id).annotations.length === 1);

// 8. save failure must not corrupt existing recordings
const before = JSON.stringify(s().recordings);
failWrites = true;
r = s().addAnnotations(rec.id, [{ label: 'X', start: 0, end: 1 }]);
check('save failure reported', !r.ok && /存储/.test(r.error || ''));
check('save failure leaves original intact (in-memory)', JSON.stringify(s().recordings) === before);
check('active recording annotations unchanged', s().recordings.find(x => x.id === rec.id).annotations.length === 1);
failWrites = false;

// 9. filter persistence
s().setHistoryFilter({ channel: 'Fp1', annotation: 'C' });
check('filter persisted to storage', JSON.parse(storage['eeg_history_filter']).channel === 'Fp1');

// 10. delete recording save failure keeps it (covered below after fresh process for reload tests)
failWrites = true;
r = s().deleteRecording(rec.id);
check('delete recording failure reported', !r.ok);
check('recording still present after failed delete', s().recordings.some(x => x.id === rec.id));
failWrites = false;
r = s().deleteRecording(rec.id);
check('delete recording ok', r.ok && !s().recordings.some(x => x.id === rec.id));
check('deleting active recording exits playback', s().playbackMode === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

