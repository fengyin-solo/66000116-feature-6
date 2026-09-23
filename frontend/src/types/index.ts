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

/** 片段标注：标记录制中的一个关键时间区间 */
export interface SegmentAnnotation {
  id: string;
  label: string;
  /** 片段起点（相对录制开始的秒数） */
  start: number;
  /** 片段终点（相对录制开始的秒数） */
  end: number;
  color: string;
  createdAt: number;
}

/** 标注颜色（与频段配色风格保持一致） */
export const ANNOTATION_COLORS = ['#1565c0', '#2e7d32', '#f9a825', '#e53935', '#6a1b9a', '#00838f'];

export interface Recording {
  id: string;
  name: string;
  channel: string;
  startTime: number;
  endTime: number;
  duration: number;
  frames: RecordingFrame[];
  /** 旧版本录制没有该字段，读取时按空数组处理 */
  annotations?: SegmentAnnotation[];
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  currentFrame: RecordingFrame | null;
}

/** 历史录制筛选条件（持久化，重新打开后保留） */
export interface HistoryFilter {
  channel: string;
  annotation: string;
}

/** store 操作结果：调用方据此向用户说明成功或失败原因 */
export interface ActionResult {
  ok: boolean;
  error?: string;
}
