// 端到端逻辑验证：localStorage shim + esbuild 打包 store 后在 node 运行
const esbuild = require('esbuild');
const path = require('path');
const assert = require('assert');

// ---------- localStorage shim ----------
const storage = new Map();
let failNextRecordingsWrite = false;
const localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => {
    if (k === 'eeg_recordings' && failNextRecordingsWrite) {
      failNextRecordingsWrite = false;
      const e = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    }
    storage.set(k, String(v));
  },
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};
globalThis.localStorage = localStorage;

const makeFrame = (t, tag) => ({
  relativeTime: t,
  eeg: { marker: tag, channels: ['Fp1'], sample_rate: 256, data: { Fp1: [t] }, time: [t], duration: 3 },
  bands: { delta: t, theta: t, alpha: t, beta: t, gamma: t },
  brainState: { focus: t, relaxation: t, fatigue: t, status: 'neutral', statusLabel: '平稳', statusColor: '#000', timestamp: t },
  correlation: { targetChannel: 'Fp1', correlations: [{ channel: 'Fp1', targetChannel: 'Fp1', correlation: 1, coherence: 1 }] },
});

async function main() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'src/store/eeg.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    external: ['zustand'],
  });
  const code = result.outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  const { useEEGStore } = mod.exports;
  const S = () => useEEGStore.getState();

  // ---- 1. 旧版本录制（无 annotations）+ 损坏数据可继续读取 ----
  const legacy = {
    id: 'rec_legacy', name: '旧录制', channel: 'C3',
    startTime: 1, endTime: 2, duration: 0,
    frames: [makeFrame(0, 'old0'), makeFrame(3, 'old3'), makeFrame(6, 'old6')],
  };
  const corrupt = { id: 'bad', name: '损坏', channel: 'X' }; // 无 frames
  storage.set('eeg_recordings', JSON.stringify([legacy, corrupt, null]));

  // 重新加载 store（模拟重开页面）
  delete require.cache[require.resolve('zustand')];
  const mod2 = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod2, mod2.exports, require);
  const store2 = mod2.exports.useEEGStore;
  const S2 = () => store2.getState();

  const loaded = S2().recordings;
  assert.strictEqual(loaded.length, 1, '损坏条目被丢弃，旧录制保留');
  assert.strictEqual(loaded[0].id, 'rec_legacy');
  assert.deepStrictEqual(loaded[0].annotations, [], '旧录制补齐空标注');
  assert.strictEqual(loaded[0].duration, 6, '缺少 duration 时由帧推导');
  console.log('✓ 旧录制可继续读取，损坏数据被隔离，duration 由帧推导');

  // ---- 2. 旧录制可回放，第一帧数据正确 ----
  let r = S2().enterPlaybackMode(loaded[0]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(S2().eegData.marker, 'old0');
  S2().exitPlaybackMode();
  console.log('✓ 旧录制可回放');

  // ---- 3. 批量添加标注：整批合法 -> 成功且持久化 ----
  r = S2().addAnnotations('rec_legacy', [
    { label: 'event', start: 1, end: 2, note: '事件一' },
    { label: 'artifact', start: 4, end: 5 },
  ]);
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.added.length, 2);
  const savedJson = storage.get('eeg_recordings');
  assert.ok(savedJson.includes('event') && savedJson.includes('artifact'));
  console.log('✓ 批量添加成功并持久化');

  // ---- 4. 任一条非法（越界 / 反向）-> 整批拒绝，已有标注不变 ----
  const beforeCount = S2().recordings.find((x) => x.id === 'rec_legacy').annotations.length;
  r = S2().addAnnotations('rec_legacy', [
    { label: 'event', start: 2, end: 3 },
    { label: 'event', start: 5, end: 99, note: '越界' },
  ]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('未保存任何标注'));
  assert.ok(r.rowErrors['1'].end.includes('超出录制时长'));
  let afterCount = S2().recordings.find((x) => x.id === 'rec_legacy').annotations.length;
  assert.strictEqual(afterCount, beforeCount, '整批回滚');

  r = S2().addAnnotations('rec_legacy', [
    { label: 'event', start: 5, end: 4 },
  ]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.rowErrors['0'].end.includes('晚于开始时间'));

  r = S2().addAnnotations('rec_legacy', [
    { label: 'unknown', start: 1, end: 2 },
  ]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.rowErrors['0'].label.includes('类别'));

  r = S2().addAnnotations('rec_legacy', [{ label: 'event', start: null, end: null }]);
  assert.strictEqual(r.ok, false, '空草稿被拒绝');
  console.log('✓ 越界/反向/非法类别/空行整批拒绝并逐行说明原因，原标注未破坏');

  // ---- 5. 逐条编辑 ----
  const annId = S2().recordings.find((x) => x.id === 'rec_legacy').annotations.find((a) => a.label === 'event').id;
  r = S2().updateAnnotation('rec_legacy', annId, { note: '改过的备注' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(
    S2().recordings.find((x) => x.id === 'rec_legacy').annotations.find((a) => a.id === annId).note,
    '改过的备注',
  );
  r = S2().updateAnnotation('rec_legacy', annId, { start: 5, end: 4 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.fieldErrors.end);
  console.log('✓ 逐条编辑成功，非法编辑被拒绝');

  // ---- 6. 跳转到标注 -> 对应帧的波形/频段/脑状态/相关结果正确 ----
  S2().enterPlaybackMode(S2().recordings.find((x) => x.id === 'rec_legacy'));
  const artifact = S2().recordings.find((x) => x.id === 'rec_legacy').annotations.find((a) => a.label === 'artifact');
  r = S2().jumpToAnnotation('rec_legacy', artifact.id);
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(S2().eegData.marker, 'old3', '应定位到 start=4 之前最近帧 t=3');
  assert.strictEqual(S2().brainState.focus, 3);
  assert.strictEqual(S2().bandPower.alpha, 3);
  assert.strictEqual(S2().correlationData.targetChannel, 'Fp1');
  assert.strictEqual(S2().playbackState.isPlaying, false);
  console.log('✓ 跳转后波形/频段/脑状态/相关结果与片段帧一致');

  // 跳到 event (1-2)：最近帧 t=0
  const ev = S2().recordings.find((x) => x.id === 'rec_legacy').annotations.find((a) => a.label === 'event');
  r = S2().jumpToAnnotation('rec_legacy', ev.id);
  assert.strictEqual(S2().eegData.marker, 'old0');

  // 区间 (5.7–5.9) 内没有任何采集帧（帧只在 0/3/6）-> warning + 最近帧
  const add = S2().addAnnotations('rec_legacy', [{ label: 'note', start: 5.7, end: 5.9 }]);
  assert.strictEqual(add.ok, true, add.reason);
  const tailAnn = add.added[0];
  r = S2().jumpToAnnotation('rec_legacy', tailAnn.id);
  assert.strictEqual(r.ok, true);
  assert.ok(r.warning.includes('没有采集到帧'));
  assert.strictEqual(S2().eegData.marker, 'old3', '跳到区间前最近的帧 t=3');
  console.log('✓ 标注区间无帧时跳到最近帧并说明原因');

  // ---- 7. 整组删除 ----
  const ids = S2().recordings.find((x) => x.id === 'rec_legacy').annotations.map((a) => a.id);
  r = S2().deleteAnnotations('rec_legacy', ids);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(S2().recordings.find((x) => x.id === 'rec_legacy').annotations.length, 0);
  console.log('✓ 整组删除标注成功');

  // ---- 8. 无帧录制：不可回放但标注可管理 ----
  const noframe = {
    id: 'rec_noframe', name: '空录制', channel: 'Fp1',
    startTime: 1, endTime: 2, duration: 5, frames: [], annotations: [],
  };
  storage.set('eeg_recordings', JSON.stringify([...S2().recordings, noframe]));
  const mod3 = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod3, mod3.exports, require);
  const S3 = () => mod3.exports.useEEGStore.getState();
  assert.ok(S3().recordings.some((x) => x.id === 'rec_noframe'), '无帧录制已加载进 store');
  const nf = S3().recordings.find((x) => x.id === 'rec_noframe');
  r = S3().enterPlaybackMode(nf);
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('没有任何数据帧'));
  r = S3().addAnnotations('rec_noframe', [{ label: 'good', start: 0, end: 1 }]);
  assert.strictEqual(r.ok, true, '无帧录制仍可添加标注');
  r = S3().jumpToAnnotation('rec_noframe', r.added[0].id);
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('没有任何数据帧'));
  console.log('✓ 无帧录制不可回放（说明原因），标注仍可管理');

  // ---- 9. 存储写入失败：不破坏原录制 / 标注 ----
  // 先把无帧录制纳入 store 状态（模拟页面加载后它已在 recordings 中）
  const origList = S3().recordings;
  assert.ok(origList.some((x) => x.id === 'rec_noframe'), '无帧录制已随加载进入 store');
  const origCount = origList.length;
  failNextRecordingsWrite = true;
  r = S3().addAnnotations('rec_noframe', [{ label: 'note', start: 1, end: 2 }]);
  assert.strictEqual(r.ok, false);
  assert.ok(/存储空间|存储/.test(r.reason));
  assert.strictEqual(
    S3().recordings.find((x) => x.id === 'rec_noframe').annotations.length, 1,
    '失败后内存中标注未增加',
  );
  assert.strictEqual(S3().recordings.length, origCount);
  console.log('✓ 存储失败不破坏原录制/标注');

  // ---- 10. 录制保存失败：pendingRecording 保留，可重试 ----
  const mod4 = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod4, mod4.exports, require);
  const S4 = () => mod4.exports.useEEGStore.getState();
  const existingBefore = S4().recordings.length;
  S4().startRecording();
  S4().addRecordingFrame(makeFrame(0, 'live').eeg, makeFrame(0, 'live').bands, makeFrame(0, 'live').brainState, makeFrame(0, 'live').correlation);
  failNextRecordingsWrite = true;
  r = S4().stopRecording('新录制');
  assert.strictEqual(r.ok, false);
  assert.ok(S4().pendingRecording, '失败录制被保留');
  assert.strictEqual(S4().recordings.length, existingBefore, '存储与列表未被污染');
  r = S4().retrySavePending();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(S4().recordings.length, existingBefore + 1);
  assert.strictEqual(S4().pendingRecording, null);
  console.log('✓ 保存失败保留数据，重试成功');

  // ---- 11. 无帧停止录制：说明原因 ----
  const mod5 = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod5, mod5.exports, require);
  const S5 = () => mod5.exports.useEEGStore.getState();
  S5().startRecording();
  r = S5().stopRecording('空');
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('没有采集到任何数据帧'));
  assert.strictEqual(S5().isRecording, false);
  console.log('✓ 无帧停止时说明原因且不生成录制');

  // ---- 12. 筛选持久化 + 过滤逻辑 ----
  const mod6 = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod6, mod6.exports, require);
  const S6 = () => mod6.exports.useEEGStore.getState();
  S6().setHistoryFilters({ channel: 'C3', annotation: 'event' });
  assert.strictEqual(JSON.parse(storage.get('eeg_history_filters')).channel, 'C3');
  const mod7 = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod7, mod7.exports, require);
  const f = mod7.exports.useEEGStore.getState().historyFilters;
  assert.strictEqual(f.channel, 'C3');
  assert.strictEqual(f.annotation, 'event');
  console.log('✓ 筛选条件重开后仍在');

  console.log('\n全部逻辑验证通过 ✅');
}

main().catch((e) => {
  console.error('❌ 验证失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});
