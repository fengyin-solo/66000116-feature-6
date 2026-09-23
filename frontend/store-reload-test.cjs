// 模拟“重新打开应用”：store 在加载时读取预种入的 localStorage
const { useEEGStore } = require('./.testbuild/store/eeg.js');
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } };
const s = () => useEEGStore.getState();

check('broken entry dropped, others load', s().recordings.length === 2);
const old1 = s().recordings.find(r => r.id === 'old1');
const old2 = s().recordings.find(r => r.id === 'old2');
check('legacy recording gets [] annotations (backward compatible)', Array.isArray(old1.annotations) && old1.annotations.length === 0);
check('legacy recording playable (frames kept)', old1.frames.length === 1);
check('only in-range valid annotation kept', old2.annotations.length === 1 && old2.annotations[0].id === 'g1');
check('filter restored after reopen', s().historyFilter.channel === 'C3' && s().historyFilter.annotation === '正常');

// 回放旧录制 + 跳转到迁移后保留的标注
useEEGStore.getState().setChannel('O1');
let r = s().enterPlaybackMode(old2);
check('playback legacy recording ok', r.ok);
check('playback switches to recording channel Fp1', s().selectedChannel === 'Fp1');
check('restore channel remembered O1', s().restoreChannel === 'O1');
r = s().jumpToAnnotation('old2', old2.annotations[0].id);
check('jump to migrated annotation ok', r.ok);
check('jumped time equals annotation start', s().playbackState.currentTime === 1);
check('jumped frame is the correct segment frame (relativeTime 0)', s().playbackState.currentFrame.relativeTime === 0);
check('jumped frame synced bands', s().bandPower.delta === 9);

// 无帧录制
r = s().enterPlaybackMode({ id: 'nf', name: '无帧', channel: 'Fp1', startTime: 1, endTime: 2, duration: 0, frames: [] });
check('frameless playback rejected with reason', !r.ok && /没有任何数据帧/.test(r.error || ''));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
