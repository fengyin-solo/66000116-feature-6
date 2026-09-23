import {
  AnnotationFieldErrors,
  HistoryFilters,
  Recording,
  SegmentAnnotation,
} from '../types';

/** 可选标注类别 */
export const ANNOTATION_LABELS: { id: string; name: string; color: string }[] = [
  { id: 'event', name: '事件', color: '#e53935' },
  { id: 'artifact', name: '伪迹', color: '#f9a825' },
  { id: 'abnormal', name: '异常', color: '#8e24aa' },
  { id: 'good', name: '优质', color: '#2e7d32' },
  { id: 'note', name: '备注', color: '#1565c0' },
];

export const LABEL_NAME_MAP: Record<string, string> = Object.fromEntries(
  ANNOTATION_LABELS.map((l) => [l.id, l.name]),
);

export const getLabelColor = (labelId: string): string =>
  ANNOTATION_LABELS.find((l) => l.id === labelId)?.color ?? '#757575';

export const getLabelName = (labelId: string): string =>
  LABEL_NAME_MAP[labelId] ?? labelId;

let idSeq = 0;
export const generateAnnotationId = (): string =>
  `ann_${Date.now().toString(36)}_${(idSeq++).toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;

/** m:ss（可带一位小数），输入为秒 */
export const formatClock = (seconds: number, withFraction = false): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe - mins * 60;
  if (withFraction) {
    return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
  }
  return `${mins}:${Math.floor(secs).toString().padStart(2, '0')}`;
};

/** 录制时间轴上是否存在覆盖某一时刻的帧 */
export const frameExistsAt = (recording: Recording, time: number): boolean => {
  const frames = recording.frames;
  if (frames.length === 0) return false;
  const lastTime = frames[frames.length - 1].relativeTime;
  return time >= frames[0].relativeTime && time <= lastTime;
};

/**
 * 校验单条标注。
 * - 时间必须为有效数字、不越界（0 ~ duration）、起点早于终点
 * - 类别必须是系统已知类别
 * 返回的错误对象为空即校验通过。
 */
export const validateAnnotation = (
  input: { label: string; start: number | null; end: number | null; note?: string },
  duration: number,
): AnnotationFieldErrors => {
  const errors: AnnotationFieldErrors = {};
  const start = input.start;
  const end = input.end;

  if (start === null || !Number.isFinite(start)) {
    errors.start = '请填写开始时间';
  } else if (start < 0) {
    errors.start = '开始时间不能小于 0';
  } else if (start > duration + 1e-6) {
    errors.start = `开始时间超出录制时长（${formatClock(duration, true)}）`;
  }

  if (end === null || !Number.isFinite(end)) {
    errors.end = '请填写结束时间';
  } else if (end <= 0) {
    errors.end = '结束时间必须大于 0';
  } else if (end > duration + 1e-6) {
    errors.end = `结束时间超出录制时长（${formatClock(duration, true)}）`;
  }

  if (
    !errors.start &&
    !errors.end &&
    start !== null &&
    end !== null &&
    end <= start
  ) {
    errors.end = '结束时间必须晚于开始时间';
  }

  if (!input.label || !LABEL_NAME_MAP[input.label]) {
    errors.label = '请选择标注类别';
  }

  if (input.note && input.note.length > 200) {
    errors.note = '备注最多 200 字';
  }

  return errors;
};

/** 判断录制是否命中当前筛选条件 */
export const recordingMatchesFilters = (
  recording: Recording,
  filters: HistoryFilters,
): boolean => {
  if (filters.channel !== 'all' && recording.channel !== filters.channel) {
    return false;
  }
  switch (filters.annotation) {
    case 'all':
      return true;
    case 'any':
      return recording.annotations.length > 0;
    case 'none':
      return recording.annotations.length === 0;
    default:
      return recording.annotations.some((a) => a.label === filters.annotation);
  }
};

/** 按开始时间排序（不修改原数组） */
export const sortAnnotations = (
  annotations: SegmentAnnotation[],
): SegmentAnnotation[] =>
  [...annotations].sort((a, b) => a.start - b.start || a.end - b.end);
