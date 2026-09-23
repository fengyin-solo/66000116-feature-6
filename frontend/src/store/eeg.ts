import { create } from 'zustand';
import { EEGData, BandPower, BrainState, CorrelationData, Recording, RecordingFrame, PlaybackState, SegmentAnnotation, HistoryFilter, ActionResult, ANNOTATION_COLORS } from '../types';

const STORAGE_KEY = 'eeg_recordings';
const FILTER_KEY = 'eeg_history_filter';

const round2 = (v: number) => Math.round(v * 100) / 100;

/** 兼容旧数据：补全单条标注的必填字段，丢弃无法识别的脏数据 */
const sanitizeAnnotation = (raw: unknown, duration: number): SegmentAnnotation | null => {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.id !== 'string' || typeof a.label !== 'string' || !a.label.trim()) return null;
  const start = typeof a.start === 'number' && Number.isFinite(a.start) ? a.start : NaN;
  const end = typeof a.end === 'number' && Number.isFinite(a.end) ? a.end : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start > duration) {
    return null; // 越界标注不载入，避免污染列表与进度条
  }
  return {
    id: a.id,
    label: a.label.trim(),
    start: round2(start),
    end: round2(Math.min(end, duration)),
    color: typeof a.color === 'string' && a.color ? a.color : ANNOTATION_COLORS[0],
    createdAt: typeof a.createdAt === 'number' ? a.createdAt : 0,
  };
};

/** 读取录制列表：单条损坏不影响其它录制，旧录制（无标注）照常可读 */
const loadRecordings = (): Recording[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is Recording => !!r && typeof r === 'object' && Array.isArray((r as Recording).frames))
      .map((r) => ({
        ...r,
        annotations: Array.isArray(r.annotations)
          ? (r.annotations
              .map((a) => sanitizeAnnotation(a, r.duration))
              .filter((a): a is SegmentAnnotation => a !== null))
          : [],
      }));
  } catch {
    return [];
  }
};

/** 读取筛选条件（重新打开后保留） */
const loadFilter = (): HistoryFilter => {
  try {
    const stored = localStorage.getItem(FILTER_KEY);
    if (!stored) return { channel: 'all', annotation: 'all' };
    const parsed = JSON.parse(stored);
    return {
      channel: typeof parsed?.channel === 'string' ? parsed.channel : 'all',
      annotation: typeof parsed?.annotation === 'string' ? parsed.annotation : 'all',
    };
  } catch {
    return { channel: 'all', annotation: 'all' };
  }
};

/**
 * 原子保存：先序列化到字符串，写入失败时原列表保持不变。
 * 返回失败原因，由调用方提示用户。
 */
const persistRecordings = (recordings: Recording[]): ActionResult => {
  let serialized: string;
  try {
    serialized = JSON.stringify(recordings);
  } catch {
    return { ok: false, error: '录制数据无法序列化（可能包含异常数据），本次修改未保存' };
  }
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    return { ok: true };
  } catch (err) {
    // 配额超限或隐私模式等：不覆盖内存中的原有录制
    const reason = err instanceof DOMException && err.name === 'QuotaExceededError'
      ? '本地存储空间不足'
      : '本地存储不可用';
    return { ok: false, error: `${reason}，标注未保存，原录制不受影响` };
  }
};

const persistFilter = (filter: HistoryFilter) => {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {
    // 筛选保存失败不影响标注数据，静默处理
  }
};

const genId = () => `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** 批量添加用的输入行 */
export interface AnnotationDraft {
  label: string;
  start: number;
  end: number;
  color?: string;
}

/** 批量编辑用的输入行（带 id） */
export interface AnnotationEdit {
  id: string;
  label: string;
  start: number;
  end: number;
  color?: string;
}

interface EEGState {
  eegData: EEGData | null;
  selectedChannel: string;
  bandPower: BandPower | null;
  isStreaming: boolean;
  brainState: BrainState | null;
  correlationData: CorrelationData | null;
  isRecording: boolean;
  recordingStartTime: number;
  currentRecordingFrames: RecordingFrame[];
  recordings: Recording[];
  historyFilter: HistoryFilter;
  playbackMode: boolean;
  activeRecording: Recording | null;
  playbackState: PlaybackState;
  /** 进入回放前用户选择的实时通道，退出回放时恢复 */
  restoreChannel: string | null;
  setEEGData: (d: EEGData | null) => void;
  setChannel: (c: string) => void;
  setBandPower: (b: BandPower | null) => void;
  setStreaming: (v: boolean) => void;
  setBrainState: (s: BrainState | null) => void;
  setCorrelationData: (c: CorrelationData | null) => void;
  startRecording: () => void;
  stopRecording: (name: string) => ActionResult;
  addRecordingFrame: (eeg: EEGData, bands: BandPower, brainState: BrainState, correlation: CorrelationData) => void;
  deleteRecording: (id: string) => ActionResult;
  setHistoryFilter: (patch: Partial<HistoryFilter>) => void;
  addAnnotations: (recordingId: string, drafts: AnnotationDraft[]) => ActionResult;
  updateAnnotation: (recordingId: string, annotationId: string, patch: Partial<Omit<SegmentAnnotation, 'id' | 'createdAt'>>) => ActionResult;
  deleteAnnotations: (recordingId: string, annotationIds: string[]) => ActionResult;
  enterPlaybackMode: (recording: Recording) => ActionResult;
  exitPlaybackMode: () => void;
  setPlaybackTime: (time: number) => void;
  jumpToAnnotation: (recordingId: string, annotationId: string) => ActionResult;
  togglePlayback: () => void;
  setPlaybackPlaying: (playing: boolean) => void;
}

/** 选取某个时间点对应的帧（frames 按 relativeTime 升序） */
const pickFrame = (frames: RecordingFrame[], time: number): RecordingFrame => {
  let picked = frames[0];
  for (const f of frames) {
    if (f.relativeTime <= time) picked = f;
    else break;
  }
  return picked;
};

export const useEEGStore = create<EEGState>((set, get) => ({
  eegData: null,
  selectedChannel: 'Fp1',
  bandPower: null,
  isStreaming: false,
  brainState: null,
  correlationData: null,
  isRecording: false,
  recordingStartTime: 0,
  currentRecordingFrames: [],
  recordings: loadRecordings(),
  historyFilter: loadFilter(),
  playbackMode: false,
  activeRecording: null,
  restoreChannel: null,
  playbackState: {
    isPlaying: false,
    currentTime: 0,
    currentFrame: null,
  },
  setEEGData: (d) => set({ eegData: d }),
  setChannel: (c) => set({ selectedChannel: c }),
  setBandPower: (b) => set({ bandPower: b }),
  setStreaming: (v) => set({ isStreaming: v }),
  setBrainState: (s) => set({ brainState: s }),
  setCorrelationData: (c) => set({ correlationData: c }),
  startRecording: () => {
    set({
      isRecording: true,
      recordingStartTime: Date.now(),
      currentRecordingFrames: [],
      playbackMode: false,
      activeRecording: null,
    });
  },
  stopRecording: (name) => {
    const { currentRecordingFrames, recordingStartTime, selectedChannel, recordings } = get();
    // 一帧都没有：明确告知，不产生空录制
    if (currentRecordingFrames.length === 0) {
      set({ isRecording: false, recordingStartTime: 0, currentRecordingFrames: [] });
      return { ok: false, error: '没有采集到任何数据帧（至少需要一帧），未保存录制' };
    }
    const endTime = Date.now();
    const duration = (endTime - recordingStartTime) / 1000;
    const newRecording: Recording = {
      id: `rec_${endTime}`,
      name: name || `录制 ${new Date(recordingStartTime).toLocaleString()}`,
      channel: selectedChannel,
      startTime: recordingStartTime,
      endTime,
      duration,
      frames: currentRecordingFrames,
      annotations: [],
    };
    const next = [...recordings, newRecording];
    const result = persistRecordings(next);
    if (!result.ok) {
      // 保存失败：内存中也不追加，保证界面与已存数据一致，原录制完好
      set({ isRecording: false, recordingStartTime: 0, currentRecordingFrames: [] });
      return result;
    }
    set({
      isRecording: false,
      recordingStartTime: 0,
      currentRecordingFrames: [],
      recordings: next,
    });
    return { ok: true };
  },
  addRecordingFrame: (eeg, bands, brainState, correlation) => {
    const { isRecording, recordingStartTime, currentRecordingFrames } = get();
    if (!isRecording) return;
    const relativeTime = (Date.now() - recordingStartTime) / 1000;
    const frame: RecordingFrame = { relativeTime, eeg, bands, brainState, correlation };
    set({ currentRecordingFrames: [...currentRecordingFrames, frame] });
  },
  deleteRecording: (id) => {
    const recordings = get().recordings;
    const next = recordings.filter(r => r.id !== id);
    if (next.length === recordings.length) return { ok: false, error: '录制不存在，可能已被删除' };
    const result = persistRecordings(next);
    if (!result.ok) return result; // 保存失败：保留内存原列表，原录制完好
    const { activeRecording } = get();
    if (activeRecording?.id === id) {
      const { restoreChannel } = get();
      set({
        recordings: next,
        playbackMode: false,
        activeRecording: null,
        restoreChannel: null,
        selectedChannel: restoreChannel ?? get().selectedChannel,
        playbackState: { isPlaying: false, currentTime: 0, currentFrame: null },
      });
    } else {
      set({ recordings: next });
    }
    return { ok: true };
  },
  setHistoryFilter: (patch) => {
    const filter = { ...get().historyFilter, ...patch };
    persistFilter(filter);
    set({ historyFilter: filter });
  },
  addAnnotations: (recordingId, drafts) => {
    const { recordings, activeRecording } = get();
    const target = recordings.find(r => r.id === recordingId);
    if (!target) return { ok: false, error: '录制不存在，无法添加标注' };
    if (drafts.length === 0) return { ok: false, error: '请至少填写一条标注' };

    // 先在临时副本上构建并校验：任何一条非法都整体拒绝，绝不半写
    const built: SegmentAnnotation[] = [];
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      const label = d.label?.trim();
      if (!label) return { ok: false, error: `第 ${i + 1} 条标注缺少名称` };
      if (!Number.isFinite(d.start) || !Number.isFinite(d.end)) {
        return { ok: false, error: `第 ${i + 1} 条标注时间无效` };
      }
      const start = round2(d.start);
      const end = round2(d.end);
      if (start < 0) return { ok: false, error: `第 ${i + 1} 条标注起点不能小于 0` };
      if (start > target.duration) {
        return { ok: false, error: `第 ${i + 1} 条标注起点 ${start}s 超出录制时长 ${target.duration.toFixed(1)}s` };
      }
      if (end < start) return { ok: false, error: `第 ${i + 1} 条标注终点早于起点` };
      built.push({
        id: genId(),
        label,
        start,
        end: round2(Math.min(end, target.duration)),
        color: d.color || ANNOTATION_COLORS[built.length % ANNOTATION_COLORS.length],
        createdAt: Date.now(),
      });
    }

    const next = recordings.map(r =>
      r.id === recordingId ? { ...r, annotations: [...(r.annotations ?? []), ...built] } : r
    );
    const result = persistRecordings(next);
    if (!result.ok) return result;

    // 正在回放该录制时同步替换 activeRecording（回放不中断，标注立即出现）
    set({
      recordings: next,
      activeRecording: activeRecording?.id === recordingId
        ? next.find(r => r.id === recordingId) ?? activeRecording
        : activeRecording,
    });
    return { ok: true };
  },
  updateAnnotation: (recordingId, annotationId, patch) => {
    const { recordings, activeRecording } = get();
    const target = recordings.find(r => r.id === recordingId);
    const current = target?.annotations?.find(a => a.id === annotationId);
    if (!target || !current) return { ok: false, error: '标注不存在，可能已被删除' };

    const label = patch.label !== undefined ? patch.label.trim() : current.label;
    if (patch.label !== undefined && !label) return { ok: false, error: '标注名称不能为空' };
    const start = patch.start !== undefined ? round2(patch.start) : current.start;
    const end = patch.end !== undefined ? round2(patch.end) : current.end;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: '标注时间无效' };
    if (start < 0) return { ok: false, error: '标注起点不能小于 0' };
    if (start > target.duration) {
      return { ok: false, error: `起点 ${start}s 超出录制时长 ${target.duration.toFixed(1)}s` };
    }
    if (end < start) return { ok: false, error: '标注终点不能早于起点' };

    const updated: SegmentAnnotation = {
      ...current,
      label,
      start,
      end: round2(Math.min(end, target.duration)),
      color: patch.color ?? current.color,
    };
    const next = recordings.map(r => r.id === recordingId
      ? { ...r, annotations: (r.annotations ?? []).map(a => a.id === annotationId ? updated : a) }
      : r);
    const result = persistRecordings(next);
    if (!result.ok) return result;
    set({
      recordings: next,
      activeRecording: activeRecording?.id === recordingId
        ? next.find(r => r.id === recordingId) ?? activeRecording
        : activeRecording,
    });
    return { ok: true };
  },
  deleteAnnotations: (recordingId, annotationIds) => {
    const { recordings, activeRecording } = get();
    const target = recordings.find(r => r.id === recordingId);
    if (!target) return { ok: false, error: '录制不存在' };
    const idSet = new Set(annotationIds);
    const existing = (target.annotations ?? []).filter(a => idSet.has(a.id));
    if (existing.length === 0) return { ok: false, error: '所选标注不存在，可能已被删除' };

    const next = recordings.map(r => r.id === recordingId
      ? { ...r, annotations: (r.annotations ?? []).filter(a => !idSet.has(a.id)) }
      : r);
    const result = persistRecordings(next);
    if (!result.ok) return result;
    set({
      recordings: next,
      activeRecording: activeRecording?.id === recordingId
        ? next.find(r => r.id === recordingId) ?? activeRecording
        : activeRecording,
    });
    return { ok: true };
  },
  enterPlaybackMode: (recording) => {
    if (!recording.frames || recording.frames.length === 0) {
      return { ok: false, error: '该录制没有任何数据帧，无法回放' };
    }
    const frame = recording.frames[0];
    const { selectedChannel, playbackMode } = get();
    set({
      playbackMode: true,
      activeRecording: recording,
      // 仅在从实时视图首次进入时记录待恢复通道；连续回放其它录制不覆盖
      restoreChannel: playbackMode ? get().restoreChannel : selectedChannel,
      selectedChannel: recording.channel,
      playbackState: { isPlaying: false, currentTime: 0, currentFrame: frame },
      eegData: frame.eeg,
      bandPower: frame.bands,
      brainState: frame.brainState,
      correlationData: frame.correlation,
    });
    return { ok: true };
  },
  exitPlaybackMode: () => {
    const { restoreChannel } = get();
    set({
      playbackMode: false,
      activeRecording: null,
      restoreChannel: null,
      // 恢复进入回放前关注的实时通道
      selectedChannel: restoreChannel ?? get().selectedChannel,
      playbackState: { isPlaying: false, currentTime: 0, currentFrame: null },
    });
  },
  setPlaybackTime: (time) => {
    const { activeRecording, playbackState } = get();
    if (!activeRecording || activeRecording.frames.length === 0) return;
    // 钳制到 [0, duration]，避免 NaN 或越界时间破坏视图
    const clamped = Math.max(0, Math.min(activeRecording.duration, Number.isFinite(time) ? time : 0));
    const frame = pickFrame(activeRecording.frames, clamped);
    set({
      playbackState: { ...playbackState, currentTime: clamped, currentFrame: frame },
      eegData: frame.eeg,
      bandPower: frame.bands,
      brainState: frame.brainState,
      correlationData: frame.correlation,
    });
  },
  jumpToAnnotation: (recordingId, annotationId) => {
    const { recordings } = get();
    const target = recordings.find(r => r.id === recordingId);
    const annotation = target?.annotations?.find(a => a.id === annotationId);
    if (!target) return { ok: false, error: '录制不存在，无法跳转' };
    if (!annotation) return { ok: false, error: '标注不存在，可能已被删除' };
    if (target.frames.length === 0) return { ok: false, error: '该录制没有任何数据帧，无法跳转' };

    // 取不晚于标注起点的最新一帧；若起点早于首帧时间（帧为离散采样），使用首帧
    const frame = pickFrame(target.frames, annotation.start);
    const { selectedChannel, playbackMode } = get();
    set({
      playbackMode: true,
      activeRecording: target,
      restoreChannel: playbackMode ? get().restoreChannel : selectedChannel,
      selectedChannel: target.channel,
      playbackState: { isPlaying: false, currentTime: annotation.start, currentFrame: frame },
      eegData: frame.eeg,
      bandPower: frame.bands,
      brainState: frame.brainState,
      correlationData: frame.correlation,
    });
    return { ok: true };
  },
  togglePlayback: () => {
    const { playbackState } = get();
    set({
      playbackState: { ...playbackState, isPlaying: !playbackState.isPlaying },
    });
  },
  setPlaybackPlaying: (playing) => {
    set({
      playbackState: { ...get().playbackState, isPlaying: playing },
    });
  },
}));
