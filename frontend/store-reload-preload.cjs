// 预加载：在 store 模块加载前种入“上一次会话”的 localStorage 数据
const mkEEG = () => ({ channels: ['Fp1', 'Fp2'], sample_rate: 256, data: { Fp1: [1, 2, 3], Fp2: [4, 5, 6] }, time: [0, 1, 2], duration: 3 });
const bs = { focus: 1, relaxation: 2, fatigue: 3, status: 'neutral', statusLabel: '平稳', statusColor: '#000', timestamp: 0 };
const corr = { targetChannel: 'Fp1', correlations: [] };
const frame = { relativeTime: 0, eeg: mkEEG(), bands: { delta: 9, theta: 1, alpha: 1, beta: 1, gamma: 1 }, brainState: bs, correlation: corr };

const legacy = [
  { id: 'old1', name: '旧录制', channel: 'C3', startTime: 1, endTime: 2, duration: 6, frames: [frame] },
  {
    id: 'old2', name: '含坏标注', channel: 'Fp1', startTime: 1, endTime: 2, duration: 6,
    frames: [frame, { ...frame, relativeTime: 3 }, { ...frame, relativeTime: 6 }],
    annotations: [
      { id: 'g1', label: '正常', start: 1, end: 2, color: '#123456', createdAt: 0 },
      { id: 'g2', label: '越界', start: 100, end: 200, color: '#123456', createdAt: 0 },
      { id: 'g3', label: '反转', start: 5, end: 1, color: '#123456', createdAt: 0 },
      'garbage', null,
    ],
  },
  { id: 'broken', name: '损坏条目', frames: 'not-array' },
];
const storage = {
  eeg_recordings: JSON.stringify(legacy),
  eeg_history_filter: JSON.stringify({ channel: 'C3', annotation: '正常' }),
};
globalThis.localStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = v; },
  removeItem: (k) => { delete storage[k]; },
};
