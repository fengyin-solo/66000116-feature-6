export interface EEGData { channels: string[]; sample_rate: number; data: Record<string, number[]>; time: number[]; duration: number; }
export interface BandPower { delta: number; theta: number; alpha: number; beta: number; gamma: number; }
export interface BrainState {
  focus: number;
  relaxation: number;
  fatigue: number;
  status: 'focused' | 'relaxed' | 'fatigued' | 'neutral';
  statusLabel: string;
  statusColor: string;
  timestamp: number;
}
export interface ChannelCorrelation {
  channel: string;
  targetChannel: string;
  correlation: number;
  coherence: number;
}
export interface CorrelationData {
  targetChannel: string;
  correlations: ChannelCorrelation[];
}

export interface RecordingFrame {
  relativeTime: number;
  eeg: EEGData;
  bands: BandPower;
  brainState: BrainState;
  correlation: CorrelationData;
}

/** 片段标注：标注录制时间轴上的一个关键片段 */
export interface SegmentAnnotation {
  id: string;
  /** 标注类别 id，对应 ANNOTATION_LABELS 中的条目 */
  label: string;
  /** 相对录制起点的开始时间（秒） */
  start: number;
  /** 相对录制起点的结束时间（秒，须大于 start 且不超过录制时长） */
  end: number;
  /** 备注（可选） */
  note?: string;
  createdAt: number;
}

/** 批量添加时的草稿：时间留空表示该行未填写 */
export interface AnnotationDraft {
  label: string;
  start: number | null;
  end: number | null;
  note?: string;
}

export interface AnnotationFieldErrors {
  start?: string;
  end?: string;
  label?: string;
  note?: string;
}

/** 标注 / 录制写操作的统一返回结果，失败时必须带 reason 说明原因 */
export interface MutationResult {
  ok: boolean;
  reason?: string;
  fieldErrors?: AnnotationFieldErrors;
  /** 批量添加时各行的错误，key 为调用方约定的行 id */
  rowErrors?: Record<string, AnnotationFieldErrors>;
  added?: SegmentAnnotation[];
  /** 操作成功但需要提示用户的降级信息（如标注区间内无帧） */
  warning?: string;
}

/** 历史录制列表筛选条件（持久化） */
export interface HistoryFilters {
  /** 'all' 或具体通道名 */
  channel: string;
  /** 'all' | 'any'（含标注） | 'none'（无标注） | 标注类别 id */
  annotation: string;
}

export interface Recording {
  id: string;
  name: string;
  channel: string;
  startTime: number;
  endTime: number;
  duration: number;
  frames: RecordingFrame[];
  annotations: SegmentAnnotation[];
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  currentFrame: RecordingFrame | null;
}
