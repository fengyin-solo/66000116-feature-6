import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useEEGStore, AnnotationDraft } from '../store/eeg';
import { Recording, SegmentAnnotation } from '../types';
import { BatchAnnotationDialog, EditAnnotationDialog, ConfirmDialog } from './AnnotationDialogs';

const CHANNEL_NAMES: Record<string, string> = {
  Fp1: '左前额', Fp2: '右前额', F3: '左额', F4: '右额',
  C3: '左中央', C4: '右中央', P3: '左顶', P4: '右顶',
  O1: '左枕', O2: '右枕'
};

const formatDuration = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatTime = (ms: number): string => {
  try {
    return new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '时间未知';
  }
};

interface Notice { type: 'success' | 'error'; text: string; key: number }

type BatchTarget = { recordingId: string; duration: number; initialTime?: number };
type EditTarget = { recordingId: string; annotation: SegmentAnnotation; duration: number };
type DeleteTarget = { recordingId: string; count: number };

const btnSmall: React.CSSProperties = {
  padding: '3px 8px',
  border: 'none',
  borderRadius: 4,
  fontSize: '11px',
  cursor: 'pointer',
};

export const RecordingPanel: React.FC = () => {
  const {
    isRecording,
    currentRecordingFrames,
    recordings,
    historyFilter,
    playbackMode,
    activeRecording,
    playbackState,
    startRecording,
    stopRecording,
    deleteRecording,
    enterPlaybackMode,
    exitPlaybackMode,
    setPlaybackTime,
    togglePlayback,
    setPlaybackPlaying,
    setHistoryFilter,
    addAnnotations,
    updateAnnotation,
    deleteAnnotations,
    jumpToAnnotation,
    selectedChannel,
  } = useEEGStore();

  const [recordingName, setRecordingName] = useState('');
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [batchTarget, setBatchTarget] = useState<BatchTarget | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  /** 展开标注管理的录制 id；勾选的标注 id 按录制隔离 */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, Set<string>>>({});
  const timerRef = useRef<number | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = (type: Notice['type'], text: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice({ type, text, key: Date.now() });
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4000);
  };

  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);

  // 历史录制中出现过的所有通道（用于通道筛选下拉）
  const channelOptions = useMemo(
    () => Array.from(new Set(recordings.map(r => r.channel))).sort(),
    [recordings]
  );
  // 所有标注名称（用于标注筛选下拉）
  const annotationLabels = useMemo(() => {
    const labels = new Set<string>();
    recordings.forEach(r => (r.annotations ?? []).forEach(a => labels.add(a.label)));
    return Array.from(labels).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [recordings]);

  const filteredRecordings = useMemo(() => {
    return recordings.filter(r => {
      if (historyFilter.channel !== 'all' && r.channel !== historyFilter.channel) return false;
      if (historyFilter.annotation !== 'all') {
        if (!(r.annotations ?? []).some(a => a.label === historyFilter.annotation)) return false;
      }
      return true;
    });
  }, [recordings, historyFilter]);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = window.setInterval(() => {
        setElapsedTime(currentRecordingFrames.length * 3);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsedTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, currentRecordingFrames.length]);

  useEffect(() => {
    if (playbackState.isPlaying && activeRecording) {
      playbackTimerRef.current = window.setInterval(() => {
        const { playbackState, activeRecording, setPlaybackTime, setPlaybackPlaying } = useEEGStore.getState();
        if (!activeRecording) return;
        const newTime = playbackState.currentTime + 0.1;
        if (newTime >= activeRecording.duration) {
          setPlaybackTime(activeRecording.duration);
          setPlaybackPlaying(false);
        } else {
          setPlaybackTime(newTime);
        }
      }, 100);
    } else {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    }
    return () => {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    };
  }, [playbackState.isPlaying, activeRecording]);

  const handleStopRecording = () => setShowNameDialog(true);

  const handleConfirmSave = () => {
    const result = stopRecording(recordingName.trim());
    setRecordingName('');
    setShowNameDialog(false);
    if (result.ok) {
      showNotice('success', '录制已保存');
    } else {
      showNotice('error', result.error || '保存失败');
    }
  };

  const handleCancelSave = () => {
    useEEGStore.setState({ isRecording: false, recordingStartTime: 0, currentRecordingFrames: [] });
    setShowNameDialog(false);
    setRecordingName('');
  };

  const handlePlayRecording = (recording: Recording) => {
    const result = enterPlaybackMode(recording);
    if (!result.ok) showNotice('error', result.error || '无法回放');
  };

  const handleDeleteRecording = (recording: Recording) => {
    const result = deleteRecording(recording.id);
    if (result.ok) showNotice('success', `已删除录制「${recording.name}」`);
    else showNotice('error', result.error || '删除失败');
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPlaybackTime(parseFloat(e.target.value));
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeRecording) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percentage = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setPlaybackTime(percentage * activeRecording.duration);
  };

  const getChecked = (recordingId: string): Set<string> => checked[recordingId] ?? new Set();

  const toggleCheck = (recordingId: string, annotationId: string) => {
    setChecked(prev => {
      const next = new Set(prev[recordingId] ?? []);
      if (next.has(annotationId)) next.delete(annotationId);
      else next.add(annotationId);
      return { ...prev, [recordingId]: next };
    });
  };

  const toggleCheckAll = (recording: Recording) => {
    setChecked(prev => {
      const ids = (recording.annotations ?? []).map(a => a.id);
      const current = prev[recording.id] ?? new Set();
      const allSelected = ids.length > 0 && ids.every(id => current.has(id));
      return { ...prev, [recording.id]: new Set(allSelected ? [] : ids) };
    });
  };

  const handleBatchSubmit = (drafts: AnnotationDraft[]): string | null => {
    if (!batchTarget) return '操作已取消';
    const result = addAnnotations(batchTarget.recordingId, drafts);
    if (!result.ok) return result.error || '保存失败';
    setBatchTarget(null);
    setExpandedId(batchTarget.recordingId);
    showNotice('success', `已添加 ${drafts.length} 条标注`);
    return null;
  };

  const handleEditSubmit = (patch: { label: string; start: number; end: number; color: string }): string | null => {
    if (!editTarget) return '操作已取消';
    const result = updateAnnotation(editTarget.recordingId, editTarget.annotation.id, patch);
    if (!result.ok) return result.error || '保存失败';
    setEditTarget(null);
    showNotice('success', '标注已更新');
    return null;
  };

  const handleGroupDelete = () => {
    if (!deleteTarget) return;
    const ids = Array.from(getChecked(deleteTarget.recordingId));
    const result = deleteAnnotations(deleteTarget.recordingId, ids);
    if (result.ok) {
      showNotice('success', `已删除 ${ids.length} 条标注`);
      setChecked(prev => ({ ...prev, [deleteTarget.recordingId]: new Set() }));
    } else {
      showNotice('error', result.error || '删除失败');
    }
    setDeleteTarget(null);
  };

  const handleJump = (recordingId: string, annotation: SegmentAnnotation) => {
    const result = jumpToAnnotation(recordingId, annotation.id);
    if (!result.ok) showNotice('error', result.error || '跳转失败');
  };

  const activeAnnotations = activeRecording?.annotations ?? [];
  const activeProgress = activeRecording ? Math.max(0, Math.min(100, (playbackState.currentTime / activeRecording.duration) * 100)) : 0;

  const selectStyle: React.CSSProperties = {
    padding: '4px 6px',
    border: '1px solid #e0e0e0',
    borderRadius: 6,
    fontSize: '12px',
    background: '#fff',
    color: '#333',
    maxWidth: '110px',
  };

  return (
    <div style={{ padding: '16px', background: '#fff', borderRadius: '12px', margin: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '20px' }}>⏺</span>
        录制与回放
      </h3>

      {notice && (
        <div
          key={notice.key}
          role="status"
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: '12px',
            lineHeight: 1.5,
            background: notice.type === 'error' ? '#ffebee' : '#e8f5e9',
            color: notice.type === 'error' ? '#c62828' : '#2e7d32',
            border: `1px solid ${notice.type === 'error' ? '#ef9a9a' : '#a5d6a7'}`,
          }}
        >
          {notice.type === 'error' ? '⚠ ' : '✓ '}{notice.text}
        </div>
      )}

      {!playbackMode && (
        <div style={{ marginBottom: '16px' }}>
          {!isRecording ? (
            <button
              onClick={startRecording}
              style={{
                width: '100%',
                padding: '12px',
                background: 'linear-gradient(135deg, #d32f2f, #b71c1c)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <span style={{ fontSize: '16px' }}>⏺</span>
              开始录制 ({CHANNEL_NAMES[selectedChannel] || selectedChannel})
            </button>
          ) : (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px', background: '#ffebee', borderRadius: '8px', marginBottom: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#d32f2f', animation: 'pulse 1s infinite' }} />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#d32f2f' }}>录制中</span>
                </div>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#333' }}>
                  {formatDuration(elapsedTime)} · {currentRecordingFrames.length} 帧
                </span>
              </div>
              <button
                onClick={handleStopRecording}
                style={{ width: '100%', padding: '10px', background: '#757575', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
              >
                ⏹ 停止录制
              </button>
            </div>
          )}
        </div>
      )}

      {playbackMode && activeRecording && (
        <div style={{
          marginBottom: '16px', padding: '14px',
          background: 'linear-gradient(135deg, #e3f2fd, #bbdefb)',
          borderRadius: 10, border: '1px solid #90caf9',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1565c0' }}>{activeRecording.name}</div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: 2 }}>
                {CHANNEL_NAMES[activeRecording.channel] || activeRecording.channel} · {formatDuration(activeRecording.duration)}
              </div>
            </div>
            <button
              onClick={exitPlaybackMode}
              style={{ padding: '6px 12px', background: '#fff', color: '#1565c0', border: '1px solid #90caf9', borderRadius: 6, fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}
            >
              退出回放
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 10 }}>
            <button
              onClick={togglePlayback}
              style={{
                width: 44, height: 44, borderRadius: '50%', background: '#1565c0', color: '#fff',
                border: 'none', fontSize: 18, cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              {playbackState.isPlaying ? '⏸' : '▶'}
            </button>

            <div style={{ flex: 1 }}>
              <div
                onClick={handleProgressClick}
                style={{ height: 10, background: '#90caf9', borderRadius: 5, cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
              >
                <div style={{ height: '100%', background: '#1565c0', width: `${activeProgress}%`, borderRadius: 5, transition: 'width 0.1s linear' }} />
                {/* 标注区间标记：置于进度层之上，点击直接跳转该片段 */}
                {activeAnnotations.map(a => (
                  <div
                    key={a.id}
                    title={`${a.label} (${a.start.toFixed(1)}–${a.end.toFixed(1)}s)`}
                    onClick={(e) => { e.stopPropagation(); handleJump(activeRecording.id, a); }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      height: '100%',
                      left: `${(a.start / activeRecording.duration) * 100}%`,
                      width: `${Math.max(1.5, ((a.end - a.start) / activeRecording.duration) * 100)}%`,
                      background: a.color,
                      opacity: 0.6,
                      borderLeft: `2px solid ${a.color}`,
                      borderRadius: 2,
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
              <input
                type="range" min={0} max={activeRecording.duration} step={0.1}
                value={playbackState.currentTime} onChange={handleSeek}
                style={{ width: '100%', marginTop: 4, opacity: 0, position: 'absolute', pointerEvents: 'none' }}
              />
            </div>

            <span style={{ fontSize: '12px', color: '#666', minWidth: 70, textAlign: 'right' }}>
              {formatDuration(playbackState.currentTime)} / {formatDuration(activeRecording.duration)}
            </span>
          </div>

          {/* 标注快捷跳转 */}
          {activeAnnotations.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {[...activeAnnotations]
                .sort((a, b) => a.start - b.start)
                .map(a => (
                  <button
                    key={a.id}
                    onClick={() => handleJump(activeRecording.id, a)}
                    title={`${a.start.toFixed(1)}–${a.end.toFixed(1)}s · 点击跳转`}
                    style={{
                      ...btnSmall,
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: `${a.color}18`, color: a.color,
                      border: `1px solid ${a.color}55`,
                      fontWeight: 500,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.color }} />
                    {a.label}
                  </button>
                ))}
            </div>
          )}

          {playbackState.currentFrame && (
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: 8, background: 'rgba(255,255,255,0.5)', borderRadius: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#1976d2' }}>专注: {playbackState.currentFrame.brainState.focus.toFixed(0)}</span>
                <span style={{ fontSize: 11, color: '#388e3c' }}>放松: {playbackState.currentFrame.brainState.relaxation.toFixed(0)}</span>
                <span style={{ fontSize: 11, color: '#d32f2f' }}>疲劳: {playbackState.currentFrame.brainState.fatigue.toFixed(0)}</span>
                <span style={{ fontSize: 11, color: '#666' }}>|</span>
                <span style={{ fontSize: 11, color: '#1565c0' }}>α: {playbackState.currentFrame.bands.alpha.toFixed(2)}</span>
                <span style={{ fontSize: 11, color: '#e53935' }}>β: {playbackState.currentFrame.bands.beta.toFixed(2)}</span>
                <span style={{ fontSize: 11, color: '#2e7d32' }}>θ: {playbackState.currentFrame.bands.theta.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: 8, background: 'rgba(255,255,255,0.5)', borderRadius: 6 }}>
                <span style={{ fontSize: 11, color: '#666', fontWeight: 500 }}>相关度:</span>
                {playbackState.currentFrame.correlation.correlations
                  .filter(c => c.channel !== playbackState.currentFrame?.correlation.targetChannel)
                  .slice(0, 3)
                  .map((c, i) => (
                    <span key={i} style={{ fontSize: 11, color: '#6a1b9a' }}>
                      {c.channel}: {(Math.abs(c.correlation) * 100).toFixed(0)}%
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>历史录制 ({filteredRecordings.length}/{recordings.length})</span>
        </div>

        {/* 筛选栏：按通道 / 按标注，选择持久化 */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={historyFilter.channel}
            onChange={e => setHistoryFilter({ channel: e.target.value })}
            style={selectStyle}
            title="按通道过滤"
          >
            <option value="all">全部通道</option>
            {channelOptions.map(ch => (
              <option key={ch} value={ch}>{ch} {CHANNEL_NAMES[ch] ? `· ${CHANNEL_NAMES[ch]}` : ''}</option>
            ))}
          </select>
          <select
            value={historyFilter.annotation}
            onChange={e => setHistoryFilter({ annotation: e.target.value })}
            style={{ ...selectStyle, maxWidth: '130px' }}
            title="按标注过滤"
          >
            <option value="all">全部标注</option>
            {annotationLabels.map(label => (
              <option key={label} value={label}>🏷 {label}</option>
            ))}
          </select>
          {(historyFilter.channel !== 'all' || historyFilter.annotation !== 'all') && (
            <button
              onClick={() => setHistoryFilter({ channel: 'all', annotation: 'all' })}
              style={{ ...btnSmall, background: '#f5f5f5', color: '#666' }}
            >
              清除筛选
            </button>
          )}
        </div>

        {recordings.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: 13, border: '1px dashed #e0e0e0', borderRadius: 8 }}>
            暂无录制记录
          </div>
        ) : filteredRecordings.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: 13, border: '1px dashed #e0e0e0', borderRadius: 8 }}>
            没有符合筛选条件的录制
          </div>
        ) : (
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {[...filteredRecordings].reverse().map((recording) => {
              const annotations = recording.annotations ?? [];
              const selectedIds = getChecked(recording.id);
              const expanded = expandedId === recording.id;
              const allSelected = annotations.length > 0 && annotations.every(a => selectedIds.has(a.id));
              return (
                <div
                  key={recording.id}
                  style={{
                    padding: 12, borderRadius: 8,
                    border: activeRecording?.id === recording.id ? '2px solid #1565c0' : '1px solid #e0e0e0',
                    marginBottom: 8,
                    background: activeRecording?.id === recording.id ? '#e3f2fd' : '#fff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {recording.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                        {formatTime(recording.startTime)} · {CHANNEL_NAMES[recording.channel] || recording.channel}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => handlePlayRecording(recording)}
                        style={{
                          ...btnSmall,
                          padding: '4px 10px',
                          background: activeRecording?.id === recording.id ? '#1565c0' : '#f5f5f5',
                          color: activeRecording?.id === recording.id ? '#fff' : '#1565c0',
                          fontWeight: 500,
                        }}
                      >
                        {recording.frames.length === 0 ? '无帧' : activeRecording?.id === recording.id ? '回放中' : '▶ 回放'}
                      </button>
                      <button
                        onClick={() => handleDeleteRecording(recording)}
                        style={{ ...btnSmall, padding: '4px 8px', background: '#ffebee', color: '#d32f2f' }}
                        title="删除录制"
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  {/* 标注摘要条 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 11, color: '#666', minWidth: 0 }}>
                      {formatDuration(recording.duration)} · {recording.frames.length} 帧 · {annotations.length} 标注
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => setBatchTarget({
                          recordingId: recording.id,
                          duration: recording.duration,
                          initialTime: activeRecording?.id === recording.id ? playbackState.currentTime : undefined,
                        })}
                        style={{ ...btnSmall, background: '#e3f2fd', color: '#1565c0' }}
                      >
                        ＋标注
                      </button>
                      <button
                        onClick={() => setExpandedId(expanded ? null : recording.id)}
                        style={{ ...btnSmall, background: '#f5f5f5', color: '#555' }}
                      >
                        {expanded ? '收起' : '管理'}
                      </button>
                    </div>
                  </div>

                  {annotations.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                      {annotations.slice(0, expanded ? annotations.length : 3).map(a => (
                        <span key={a.id} style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 8,
                          background: `${a.color}18`, color: a.color, border: `1px solid ${a.color}44`,
                          whiteSpace: 'nowrap',
                        }}>
                          {a.label} {a.start.toFixed(0)}–{a.end.toFixed(0)}s
                        </span>
                      ))}
                      {!expanded && annotations.length > 3 && (
                        <span style={{ fontSize: 10, color: '#999', padding: '2px 4px' }}>+{annotations.length - 3}</span>
                      )}
                    </div>
                  )}

                  {/* 标注管理区：多选 + 逐条编辑 + 整组删除 + 跳转 */}
                  {expanded && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee' }}>
                      {annotations.length === 0 ? (
                        <div style={{ fontSize: 11, color: '#999', padding: '4px 0 8px' }}>
                          暂无标注，点击「＋标注」批量添加关键片段。
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <label style={{ fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={() => toggleCheckAll(recording)}
                              />
                              全选 ({selectedIds.size}/{annotations.length})
                            </label>
                            <button
                              onClick={() => setDeleteTarget({ recordingId: recording.id, count: selectedIds.size })}
                              disabled={selectedIds.size === 0}
                              style={{
                                ...btnSmall,
                                background: selectedIds.size === 0 ? '#f5f5f5' : '#ffebee',
                                color: selectedIds.size === 0 ? '#bbb' : '#d32f2f',
                                cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
                              }}
                            >
                              整组删除{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                            </button>
                          </div>
                          {[...annotations]
                            .sort((a, b) => a.start - b.start)
                            .map(a => (
                              <div key={a.id} style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '4px 6px', borderRadius: 6,
                                background: selectedIds.has(a.id) ? '#f0f7ff' : 'transparent',
                                marginBottom: 2,
                              }}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(a.id)}
                                  onChange={() => toggleCheck(recording.id, a.id)}
                                  style={{ flexShrink: 0 }}
                                />
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.color, flexShrink: 0 }} />
                                <span style={{ fontSize: 12, color: '#333', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {a.label}
                                </span>
                                <span style={{ fontSize: 10, color: '#999', flexShrink: 0 }}>
                                  {a.start.toFixed(1)}–{a.end.toFixed(1)}s
                                </span>
                                <button
                                  onClick={() => handleJump(recording.id, a)}
                                  style={{ ...btnSmall, background: 'transparent', color: '#1565c0', padding: '2px 6px' }}
                                  title="回放并跳转到该片段"
                                >
                                  ⏭
                                </button>
                                <button
                                  onClick={() => setEditTarget({ recordingId: recording.id, annotation: a, duration: recording.duration })}
                                  style={{ ...btnSmall, background: 'transparent', color: '#666', padding: '2px 6px' }}
                                  title="逐条编辑"
                                >
                                  ✎
                                </button>
                              </div>
                            ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showNameDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: 24, borderRadius: 12, width: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h4 style={{ margin: '0 0 16px', fontSize: 16, color: '#333' }}>保存录制</h4>
            <input
              type="text"
              value={recordingName}
              onChange={e => setRecordingName(e.target.value)}
              placeholder="输入录制名称（可选）"
              autoFocus
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmSave(); }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleCancelSave} style={{ padding: '8px 16px', background: '#f5f5f5', color: '#666', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
                取消
              </button>
              <button onClick={handleConfirmSave} style={{ padding: '8px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {batchTarget && (
        <BatchAnnotationDialog
          duration={batchTarget.duration}
          initialTime={batchTarget.initialTime}
          onClose={() => setBatchTarget(null)}
          onSubmit={handleBatchSubmit}
        />
      )}
      {editTarget && (
        <EditAnnotationDialog
          annotation={editTarget.annotation}
          duration={editTarget.duration}
          onClose={() => setEditTarget(null)}
          onSubmit={handleEditSubmit}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="整组删除标注"
          message={`确定删除选中的 ${deleteTarget.count} 条标注吗？此操作仅删除标注，录制数据不受影响。`}
          onConfirm={handleGroupDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
};
