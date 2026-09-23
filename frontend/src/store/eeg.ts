import { create } from 'zustand';
import {
  EEGData,
  BandPower,
  BrainState,
  CorrelationData,
  Recording,
  RecordingFrame,
  PlaybackState,
  SegmentAnnotation,
  AnnotationDraft,
  MutationResult,
  HistoryFilters,
} from '../types';
import {
  generateAnnotationId,
  validateAnnotation,
  sortAnnotations,
  LABEL_NAME_MAP,
} from '../utils/annotations';

const STORAGE_KEY = 'eeg_recordings';
const FILTERS_KEY = 'eeg_history_filters';

const DEFAULT_FILTERS: HistoryFilters = { channel: 'all', annotation: 'all' };

/** 清洗单条标注，非法返回 null（保证旧数据 / 手工篡改的数据不会破坏列表） */
const sanitizeAnnotation = (
  raw: unknown,
  duration: number,
): SegmentAnnotation | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  const start = typeof a.start === 'number' ? a.start : NaN;
  const end = typeof a.end === 'number' ? a.end : NaN;
  const label = typeof a.label === 'string' ? a.label : '';
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end > duration + 1 ||
    !LABEL_NAME_MAP[label]
  ) {
    return null;
  }
  return {
    id: typeof a.id === 'string' && a.id ? a.id : generateAnnotationId(),
    label,
    start,
    end,
    note: typeof a.note === 'string' ? a.note : undefined,
    createdAt: typeof a.createdAt === 'number' ? a.createdAt : Date.now(),
  };
};

/** 兼容旧版本录制（无 annotations 字段），同时丢弃明显损坏的数据 */
const normalizeRecording = (raw: unknown): Recording | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.name !== 'string' ||
    typeof r.channel !== 'string' ||
    !Array.isArray(r.frames)
  ) {
    return null;
  }
  let duration =
    typeof r.duration === 'number' && Number.isFinite(r.duration) && r.duration >= 0
      ? r.duration
      : 0;
  const frames = (r.frames as unknown[]).filter(
    (f): f is RecordingFrame =>
      typeof f === 'object' &&
      f !== null &&
      typeof (f as RecordingFrame).relativeTime === 'number' &&
      Number.isFinite((f as RecordingFrame).relativeTime) &&
      !!(f as RecordingFrame).eeg,
  );
  // 旧版本录制可能缺少 duration，用最后一帧时间兜底，保证回放轴与标注校验可用
  if (duration === 0 && frames.length > 0) {
    duration = frames[frames.length - 1].relativeTime;
  }
  const rawAnnotations = Array.isArray(r.annotations) ? r.annotations : [];
  const annotations = rawAnnotations
    .map((a) => sanitizeAnnotation(a, duration || Number.MAX_SAFE_INTEGER))
    .filter((a): a is SegmentAnnotation => a !== null);
  return {
    id: r.id,
    name: r.name,
    channel: r.channel,
    startTime: typeof r.startTime === 'number' ? r.startTime : 0,
    endTime: typeof r.endTime === 'number' ? r.endTime : 0,
    duration,
    frames,
    annotations,
  };
};

const loadRecordings = (): Recording[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeRecording)
      .filter((r): r is Recording => r !== null);
  } catch {
    return [];
  }
};

const loadFilters = (): HistoryFilters => {
  try {
    const stored = localStorage.getItem(FILTERS_KEY);
    if (!stored) return DEFAULT_FILTERS;
    const parsed = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_FILTERS;
    const channel =
      typeof parsed.channel === 'string' ? parsed.channel : DEFAULT_FILTERS.channel;
    const annotation =
      typeof parsed.annotation === 'string'
        ? parsed.annotation
        : DEFAULT_FILTERS.annotation;
    return { channel, annotation };
  } catch {
    return DEFAULT_FILTERS;
  }
};

/**
 * 原子写入：先序列化，写入失败（配额 / 隐私模式等）时抛出错误，
 * 调用方必须保留内存中的原录制，不能因一次失败丢弃数据。
 */
const persistRecordings = (recordings: Recording[]): void => {
  const serialized = JSON.stringify(recordings);
  localStorage.setItem(STORAGE_KEY, serialized);
};

const persistFilters = (filters: HistoryFilters): void => {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // 筛选保存失败不应影响标注 / 录制操作，本次会话内仍生效
  }
};

/** 找到 time 时刻应当展示的帧（取 relativeTime <= time 的最后一帧） */
const findFrameAt = (frames: RecordingFrame[], time: number): RecordingFrame => {
  let frame = frames[0];
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].relativeTime <= time) {
      frame = frames[i];
    } else {
      break;
    }
  }
  return frame;
};

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
  historyFilters: HistoryFilters;
  /** 保存录制失败时暂存的录制，便于用户重试（不会被直接丢弃） */
  pendingRecording: Recording | null;
  saveError: string | null;
  playbackMode: boolean;
  activeRecording: Recording | null;
  playbackState: PlaybackState;
  setEEGData: (d: EEGData | null) => void;
  setChannel: (c: string) => void;
  setBandPower: (b: BandPower | null) => void;
  setStreaming: (v: boolean) => void;
  setBrainState: (s: BrainState | null) => void;
  setCorrelationData: (c: CorrelationData | null) => void;
  startRecording: () => void;
  /** 停止并保存；无帧或写入失败时返回原因，失败不会清空已采集的帧 */
  stopRecording: (name: string) => MutationResult;
  /** 保存失败后重试写入 */
  retrySavePending: () => MutationResult;
  clearSaveError: () => void;
  /** 放弃本次未保存的录制 */
  cancelPendingRecording: () => void;
  addRecordingFrame: (
    eeg: EEGData,
    bands: BandPower,
    brainState: BrainState,
    correlation: CorrelationData,
  ) => void;
  deleteRecording: (id: string) => MutationResult;
  enterPlaybackMode: (recording: Recording) => MutationResult;
  exitPlaybackMode: () => void;
  setPlaybackTime: (time: number) => void;
  togglePlayback: () => void;
  setPlaybackPlaying: (playing: boolean) => void;
  /** 跳转到标注片段；区间内没有任何帧时给出 warning，但不改变已有回放位置之外的状态 */
  jumpToAnnotation: (recordingId: string, annotationId: string) => MutationResult;
  addAnnotations: (recordingId: string, drafts: AnnotationDraft[]) => MutationResult;
  updateAnnotation: (
    recordingId: string,
    annotationId: string,
    patch: Partial<Omit<SegmentAnnotation, 'id' | 'createdAt'>>,
  ) => MutationResult;
  deleteAnnotations: (recordingId: string, annotationIds: string[]) => MutationResult;
  setHistoryFilters: (filters: Partial<HistoryFilters>) => void;
}

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
  historyFilters: loadFilters(),
  pendingRecording: null,
  saveError: null,
  playbackMode: false,
  activeRecording: null,
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
      pendingRecording: null,
      saveError: null,
      playbackMode: false,
      activeRecording: null,
    });
  },

  stopRecording: (name) => {
    const state = get();
    const { currentRecordingFrames, recordingStartTime, selectedChannel } = state;

    if (currentRecordingFrames.length === 0) {
      // 无帧：不生成录制、不写存储，直接结束录制态
      set({ isRecording: false, currentRecordingFrames: [], recordingStartTime: 0 });
      return { ok: false, reason: '录制中没有采集到任何数据帧，未生成录制' };
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

    const recordings = [...get().recordings, newRecording];
    try {
      persistRecordings(recordings);
    } catch (err) {
      // 保存失败：保留已采集的录制供重试，绝不丢弃，也不改动原存储
      set({
        saveError:
          err instanceof DOMException && err.name === 'QuotaExceededError'
            ? '本地存储空间不足，录制尚未保存，请清理后重试'
            : '录制保存失败，数据仍保留，可重试保存',
        pendingRecording: newRecording,
        isRecording: false,
      });
      return {
        ok: false,
        reason:
          err instanceof DOMException && err.name === 'QuotaExceededError'
            ? '本地存储空间不足，录制尚未保存，请清理后重试'
            : '录制保存失败，数据仍保留，可重试保存',
      };
    }

    set({
      isRecording: false,
      recordingStartTime: 0,
      currentRecordingFrames: [],
      pendingRecording: null,
      saveError: null,
      recordings,
    });
    return { ok: true };
  },

  retrySavePending: () => {
    const { pendingRecording, recordings } = get();
    if (!pendingRecording) {
      return { ok: false, reason: '没有待保存的录制' };
    }
    const next = [...recordings, pendingRecording];
    try {
      persistRecordings(next);
    } catch (err) {
      const reason =
        err instanceof DOMException && err.name === 'QuotaExceededError'
          ? '本地存储空间仍不足，请先清理历史录制后再重试'
          : '录制保存失败，请稍后重试';
      set({ saveError: reason });
      return { ok: false, reason };
    }
    set({
      recordings: next,
      pendingRecording: null,
      saveError: null,
    });
    return { ok: true };
  },

  clearSaveError: () => set({ saveError: null }),

  cancelPendingRecording: () =>
    set({
      isRecording: false,
      recordingStartTime: 0,
      currentRecordingFrames: [],
      pendingRecording: null,
      saveError: null,
    }),

  addRecordingFrame: (eeg, bands, brainState, correlation) => {
    const { isRecording, recordingStartTime, currentRecordingFrames } = get();
    if (!isRecording) return;
    const relativeTime = (Date.now() - recordingStartTime) / 1000;
    const frame: RecordingFrame = { relativeTime, eeg, bands, brainState, correlation };
    set({ currentRecordingFrames: [...currentRecordingFrames, frame] });
  },

  deleteRecording: (id) => {
    const current = get().recordings;
    const target = current.find((r) => r.id === id);
    if (!target) {
      return { ok: false, reason: '录制不存在，可能已被删除' };
    }
    const recordings = current.filter((r) => r.id !== id);
    try {
      persistRecordings(recordings);
    } catch (err) {
      return {
        ok: false,
        reason:
          err instanceof DOMException && err.name === 'QuotaExceededError'
            ? '删除失败：本地存储写入异常'
            : '删除失败：无法写入本地存储，原录制未受影响',
      };
    }
    const { activeRecording } = get();
    if (activeRecording?.id === id) {
      set({
        recordings,
        playbackMode: false,
        activeRecording: null,
        playbackState: { isPlaying: false, currentTime: 0, currentFrame: null },
      });
    } else {
      set({ recordings });
    }
    return { ok: true };
  },

  enterPlaybackMode: (recording) => {
    if (recording.frames.length === 0) {
      return {
        ok: false,
        reason: '该录制没有任何数据帧，无法回放（标注仍可查看和管理）',
      };
    }
    const firstFrame = recording.frames[0];
    set({
      playbackMode: true,
      activeRecording: recording,
      playbackState: {
        isPlaying: false,
        currentTime: firstFrame.relativeTime,
        currentFrame: firstFrame,
      },
      eegData: firstFrame.eeg,
      bandPower: firstFrame.bands,
      brainState: firstFrame.brainState,
      correlationData: firstFrame.correlation,
    });
    return { ok: true };
  },

  exitPlaybackMode: () => {
    set({
      playbackMode: false,
      activeRecording: null,
      playbackState: {
        isPlaying: false,
        currentTime: 0,
        currentFrame: null,
      },
    });
  },

  setPlaybackTime: (time) => {
    const { activeRecording } = get();
    if (!activeRecording || activeRecording.frames.length === 0) return;
    const frames = activeRecording.frames;
    const clamped = Math.max(
      frames[0].relativeTime,
      Math.min(time, frames[frames.length - 1].relativeTime),
    );
    const frame = findFrameAt(frames, clamped);
    set({
      playbackState: {
        ...get().playbackState,
        currentTime: clamped,
        currentFrame: frame,
      },
      eegData: frame.eeg,
      bandPower: frame.bands,
      brainState: frame.brainState,
      correlationData: frame.correlation,
    });
  },

  togglePlayback: () => {
    const { playbackState } = get();
    set({
      playbackState: {
        ...playbackState,
        isPlaying: !playbackState.isPlaying,
      },
    });
  },

  setPlaybackPlaying: (playing) => {
    set({
      playbackState: {
        ...get().playbackState,
        isPlaying: playing,
      },
    });
  },

  jumpToAnnotation: (recordingId, annotationId) => {
    const state = get();
    // 始终以 record 列表中的最新对象为准（标注增删改后 activeRecording 可能滞后）
    const recording =
      state.recordings.find((r) => r.id === recordingId) ??
      (state.activeRecording?.id === recordingId ? state.activeRecording : undefined);
    if (!recording) {
      return { ok: false, reason: '录制不存在或已被删除' };
    }
    const annotation = recording.annotations.find((a) => a.id === annotationId);
    if (!annotation) {
      return { ok: false, reason: '标注不存在或已被删除' };
    }
    if (recording.frames.length === 0) {
      return {
        ok: false,
        reason: '该录制没有任何数据帧，无法跳转回放',
      };
    }
    if (annotation.start > recording.duration + 1e-6 || annotation.end < 0) {
      return {
        ok: false,
        reason: `标注区间（${annotation.start.toFixed(1)}s - ${annotation.end.toFixed(
          1,
        )}s）超出录制时长（${recording.duration.toFixed(1)}s）`,
      };
    }

    // 先进入回放（若来自历史列表直接跳转）
    if (!state.playbackMode || state.activeRecording?.id !== recordingId) {
      const enter = get().enterPlaybackMode(recording);
      if (!enter.ok) return enter;
    }

    const frames = recording.frames;
    // 标注区间内确实包含已采集帧才算有数据；否则跳到最近帧并明确提示
    const segmentHasFrame = frames.some(
      (f) => f.relativeTime >= annotation.start && f.relativeTime <= annotation.end,
    );

    const targetTime = Math.max(
      frames[0].relativeTime,
      Math.min(annotation.start, frames[frames.length - 1].relativeTime),
    );
    get().setPlaybackTime(targetTime);
    get().setPlaybackPlaying(false);

    if (!segmentHasFrame) {
      const beforeStart = annotation.end < frames[0].relativeTime;
      const afterEnd = annotation.start > frames[frames.length - 1].relativeTime;
      return {
        ok: true,
        warning: beforeStart
          ? `标注区间内无数据帧（录制从 ${frames[0].relativeTime.toFixed(
              1,
            )}s 开始），已跳转到最近的帧`
          : afterEnd
            ? `标注区间内无数据帧（数据仅到 ${frames[frames.length - 1].relativeTime.toFixed(
                1,
              )}s），已跳转到最近的帧`
            : `标注区间（${annotation.start.toFixed(1)}s–${annotation.end.toFixed(
                1,
              )}s）内没有采集到帧，已跳转到区间前最近的帧`,
      };
    }
    return { ok: true };
  },

  addAnnotations: (recordingId, drafts) => {
    const recording = get().recordings.find((r) => r.id === recordingId);
    if (!recording) {
      return { ok: false, reason: '录制不存在或已被删除' };
    }

    const nonEmpty = drafts.filter(
      (d) =>
        d.start !== null ||
        d.end !== null ||
        (d.note !== undefined && d.note.trim() !== ''),
    );
    if (nonEmpty.length === 0) {
      return { ok: false, reason: '请至少填写一条标注的时间区间' };
    }

    // 任一条不合法则整批拒绝（原子提交），逐行返回原因（key 为非空行序号）
    const rowErrors: MutationResult['rowErrors'] = {};
    nonEmpty.forEach((draft, index) => {
      const errors = validateAnnotation(draft, recording.duration);
      if (Object.keys(errors).length > 0) {
        rowErrors[String(index)] = errors;
      }
    });
    if (Object.keys(rowErrors).length > 0) {
      return {
        ok: false,
        reason: '有标注未通过校验，请修正后整批再提交（本次未保存任何标注）',
        rowErrors,
      };
    }

    const now = Date.now();
    const added: SegmentAnnotation[] = nonEmpty.map((d, i) => ({
      id: generateAnnotationId(),
      label: d.label,
      start: d.start as number,
      end: d.end as number,
      note: d.note?.trim() || undefined,
      createdAt: now + i,
    }));

    const recordings = get().recordings.map((r) =>
      r.id === recordingId
        ? { ...r, annotations: sortAnnotations([...r.annotations, ...added]) }
        : r,
    );
    const updated = recordings.find((r) => r.id === recordingId)!;
    try {
      persistRecordings(recordings);
    } catch (err) {
      return {
        ok: false,
        reason:
          err instanceof DOMException && err.name === 'QuotaExceededError'
            ? '本地存储空间不足，标注未保存，原录制未受影响'
            : '标注保存失败：无法写入本地存储，原录制未受影响',
      };
    }
    set({
      recordings,
      activeRecording:
        get().activeRecording?.id === recordingId
          ? updated
          : get().activeRecording,
    });
    return { ok: true, added };
  },

  updateAnnotation: (recordingId, annotationId, patch) => {
    const recording = get().recordings.find((r) => r.id === recordingId);
    if (!recording) {
      return { ok: false, reason: '录制不存在或已被删除' };
    }
    const existing = recording.annotations.find((a) => a.id === annotationId);
    if (!existing) {
      return { ok: false, reason: '标注不存在或已被删除' };
    }

    const next = {
      label: patch.label ?? existing.label,
      start: patch.start ?? existing.start,
      end: patch.end ?? existing.end,
      note:
        patch.note !== undefined ? patch.note.trim() || undefined : existing.note,
    };
    const fieldErrors = validateAnnotation(next, recording.duration);
    if (Object.keys(fieldErrors).length > 0) {
      return {
        ok: false,
        reason: '标注内容不合法，未保存修改',
        fieldErrors,
      };
    }

    const recordings = get().recordings.map((r) => {
      if (r.id !== recordingId) return r;
      return {
        ...r,
        annotations: sortAnnotations(
          r.annotations.map((a) => (a.id === annotationId ? { ...a, ...next } : a)),
        ),
      };
    });
    const updated = recordings.find((r) => r.id === recordingId)!;
    try {
      persistRecordings(recordings);
    } catch (err) {
      return {
        ok: false,
        reason:
          err instanceof DOMException && err.name === 'QuotaExceededError'
            ? '本地存储空间不足，修改未保存，原标注未受影响'
            : '标注修改保存失败，原标注未受影响',
      };
    }
    set({
      recordings,
      activeRecording:
        get().activeRecording?.id === recordingId
          ? updated
          : get().activeRecording,
    });
    return { ok: true };
  },

  deleteAnnotations: (recordingId, annotationIds) => {
    const recording = get().recordings.find((r) => r.id === recordingId);
    if (!recording) {
      return { ok: false, reason: '录制不存在或已被删除' };
    }
    const idSet = new Set(annotationIds);
    const existing = recording.annotations.filter((a) => idSet.has(a.id));
    if (existing.length === 0) {
      return { ok: false, reason: '所选标注不存在或已被删除，未做改动' };
    }

    const recordings = get().recordings.map((r) =>
      r.id === recordingId
        ? { ...r, annotations: r.annotations.filter((a) => !idSet.has(a.id)) }
        : r,
    );
    const updated = recordings.find((r) => r.id === recordingId)!;
    try {
      persistRecordings(recordings);
    } catch (err) {
      return {
        ok: false,
        reason:
          err instanceof DOMException && err.name === 'QuotaExceededError'
            ? '本地存储空间不足，删除未生效，原标注未受影响'
            : '标注删除失败：无法写入本地存储，原标注未受影响',
      };
    }
    set({
      recordings,
      activeRecording:
        get().activeRecording?.id === recordingId
          ? updated
          : get().activeRecording,
    });
    return { ok: true };
  },

  setHistoryFilters: (filters) => {
    const next = { ...get().historyFilters, ...filters };
    set({ historyFilters: next });
    persistFilters(next);
  },
}));
