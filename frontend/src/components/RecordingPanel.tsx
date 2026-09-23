import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useEEGStore } from '../store/eeg';
import { Recording } from '../types';
import { AnnotationPanel } from './AnnotationPanel';
import { HistoryFilterBar } from './HistoryFilterBar';
import {
  ANNOTATION_LABELS,
  formatClock,
  getLabelColor,
  getLabelName,
  recordingMatchesFilters,
} from '../utils/annotations';

const CHANNEL_NAMES: Record<string, string> = {
  Fp1: '左前额', Fp2: '右前额', F3: '左额', F4: '右额',
  C3: '左中央', C4: '右中央', P3: '左顶', P4: '右顶',
  O1: '左枕', O2: '右枕'
};

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatTime = (ms: number): string => {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const RecordingPanel: React.FC = () => {
  const {
    isRecording,
    currentRecordingFrames,
    recordings,
    historyFilters,
    saveError,
    pendingRecording,
    playbackMode,
    activeRecording,
    playbackState,
    startRecording,
    stopRecording,
    retrySavePending,
    cancelPendingRecording,
    deleteRecording,
    enterPlaybackMode,
    exitPlaybackMode,
    setPlaybackTime,
    togglePlayback,
    setPlaybackPlaying,
    jumpToAnnotation,
    selectedChannel,
  } = useEEGStore();

  const [recordingName, setRecordingName] = useState('');
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [banner, setBanner] = useState<{ type: 'error' | 'warning'; text: string } | null>(null);
  const timerRef = useRef<number | null>(null);
  const playbackTimerRef = useRef<number | null>(null);

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
        if (!activeRecording || activeRecording.frames.length === 0) return;
        const lastFrameTime = activeRecording.frames[activeRecording.frames.length - 1].relativeTime;
        const newTime = playbackState.currentTime + 0.1;
        if (newTime >= lastFrameTime) {
          setPlaybackTime(lastFrameTime);
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

  const filteredRecordings = useMemo(
    () => [...recordings].reverse().filter((r) => recordingMatchesFilters(r, historyFilters)),
    [recordings, historyFilters],
  );

  const handleStartRecording = () => {
    setBanner(null);
    startRecording();
  };

  const handleStopRecording = () => {
    setShowNameDialog(true);
  };

  const handleConfirmSave = () => {
    const result = stopRecording(recordingName.trim());
    setShowNameDialog(false);
    setRecordingName('');
    if (!result.ok) {
      if (result.reason && !result.reason.includes('尚未保存')) {
        setBanner({ type: 'warning', text: result.reason });
      }
      // 保存失败时 store 保留 pendingRecording 并显示重试条
    }
  };

  const handleCancelSave = () => {
    cancelPendingRecording();
    setShowNameDialog(false);
    setRecordingName('');
  };

  const handlePlayRecording = (recording: Recording) => {
    setBanner(null);
    const result = enterPlaybackMode(recording);
    if (!result.ok) {
      setBanner({ type: 'error', text: result.reason ?? '无法进入回放' });
    }
  };

  const handleDeleteRecording = (id: string) => {
    const result = deleteRecording(id);
    if (!result.ok) {
      setBanner({ type: 'error', text: result.reason ?? '删除失败' });
    }
  };

  const handleJumpFromHistory = (recordingId: string, annotationId: string) => {
    setBanner(null);
    const result = jumpToAnnotation(recordingId, annotationId);
    if (!result.ok) {
      setBanner({ type: 'error', text: result.reason ?? '跳转失败' });
    } else if (result.warning) {
      setBanner({ type: 'warning', text: result.warning });
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setPlaybackTime(time);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeRecording) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const time = percentage * activeRecording.duration;
    setPlaybackTime(time);
  };

  // 当前回放时刻命中的标注（用于头部提示）
  const activeAnnotation = activeRecording?.annotations.find(
    (a) => playbackState.currentTime >= a.start && playbackState.currentTime < a.end,
  );

  const lastFrameTime = activeRecording && activeRecording.frames.length > 0
    ? activeRecording.frames[activeRecording.frames.length - 1].relativeTime
    : 0;

  return (
    <div style={{ padding: '16px', background: '#fff', borderRadius: '12px', margin: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '20px' }}>⏺</span>
        录制与回放
      </h3>

      {banner && (
        <div style={{
          marginBottom: '12px',
          padding: '8px 10px',
          fontSize: '11px',
          lineHeight: 1.5,
          borderRadius: '6px',
          background: banner.type === 'error' ? '#ffebee' : '#fff8e1',
          color: banner.type === 'error' ? '#b71c1c' : '#e65100',
          border: `1px solid ${banner.type === 'error' ? '#ef9a9a' : '#ffcc80'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '8px',
        }}>
          <span>{banner.type === 'error' ? '⚠ ' : 'ℹ '}{banner.text}</span>
          <button
            onClick={() => setBanner(null)}
            style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: '12px' }}
          >
            ✕
          </button>
        </div>
      )}

      {saveError && pendingRecording && (
        <div style={{
          marginBottom: '12px',
          padding: '10px',
          borderRadius: '8px',
          background: '#fff3e0',
          border: '1px solid #ffb74d',
        }}>
          <div style={{ fontSize: '11px', color: '#e65100', lineHeight: 1.5, marginBottom: '8px' }}>
            ⚠ {saveError}
            <br />
            录制「{pendingRecording.name}」（{pendingRecording.frames.length} 帧）仍保留在内存中，原历史录制未受影响。
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => {
                const r = retrySavePending();
                if (r.ok) setBanner(null);
              }}
              style={{ padding: '5px 12px', fontSize: '11px', borderRadius: '5px', border: 'none', background: '#e65100', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
            >
              重试保存
            </button>
            <button
              onClick={cancelPendingRecording}
              style={{ padding: '5px 12px', fontSize: '11px', borderRadius: '5px', border: '1px solid #ffb74d', background: '#fff', color: '#e65100', cursor: 'pointer' }}
            >
              放弃该录制
            </button>
          </div>
        </div>
      )}

      {!playbackMode && (
        <div style={{ marginBottom: '16px' }}>
          {!isRecording ? (
            <button
              onClick={handleStartRecording}
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
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <span style={{ fontSize: '16px' }}>⏺</span>
              开始录制 ({CHANNEL_NAMES[selectedChannel] || selectedChannel})
            </button>
          ) : (
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px',
                background: '#ffebee',
                borderRadius: '8px',
                marginBottom: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: '#d32f2f',
                    animation: 'pulse 1s infinite',
                  }} />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: '#d32f2f' }}>录制中</span>
                </div>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#333' }}>
                  {formatDuration(elapsedTime)} · {currentRecordingFrames.length} 帧
                </span>
              </div>
              <button
                onClick={handleStopRecording}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#757575',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ⏹ 停止录制
              </button>
            </div>
          )}
        </div>
      )}

      {playbackMode && activeRecording && (
        <div style={{
          marginBottom: '16px',
          padding: '14px',
          background: 'linear-gradient(135deg, #e3f2fd, #bbdefb)',
          borderRadius: '10px',
          border: '1px solid #90caf9',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1565c0' }}>
                {activeRecording.name}
              </div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                {CHANNEL_NAMES[activeRecording.channel] || activeRecording.channel} · {formatDuration(activeRecording.duration)}
                {activeAnnotation && (
                  <span style={{ marginLeft: '6px', color: getLabelColor(activeAnnotation.label), fontWeight: 600 }}>
                    · 正在「{getLabelName(activeAnnotation.label)}」片段
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={exitPlaybackMode}
              style={{
                padding: '6px 12px',
                background: '#fff',
                color: '#1565c0',
                border: '1px solid #90caf9',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              退出回放
            </button>
          </div>

          {activeRecording.frames.length === 0 ? (
            <div style={{
              padding: '16px',
              textAlign: 'center',
              fontSize: '12px',
              color: '#b71c1c',
              background: '#ffebee',
              borderRadius: '8px',
              border: '1px solid #ef9a9a',
            }}>
              ⚠ 该录制没有任何数据帧，波形 / 频段 / 脑状态 / 相关结果无法回放；仍可在下方管理标注。
            </div>
          ) : (
            <>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '10px',
              }}>
                <button
                  onClick={togglePlayback}
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    background: '#1565c0',
                    color: '#fff',
                    border: 'none',
                    fontSize: '18px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {playbackState.isPlaying ? '⏸' : '▶'}
                </button>

                <div style={{ flex: 1 }}>
                  <div
                    onClick={handleProgressClick}
                    style={{
                      height: '12px',
                      background: '#90caf9',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        background: '#1565c0',
                        width: `${(playbackState.currentTime / Math.max(activeRecording.duration, 0.001)) * 100}%`,
                        borderRadius: '6px',
                        transition: 'width 0.1s linear',
                      }}
                    />
                    {/* 标注片段标记 */}
                    {activeRecording.annotations.map((a) => (
                      <div
                        key={a.id}
                        title={`${getLabelName(a.label)} ${formatClock(a.start, true)}–${formatClock(a.end, true)}（点击跳转）`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const r = jumpToAnnotation(activeRecording.id, a.id);
                          if (!r.ok) setBanner({ type: 'error', text: r.reason ?? '跳转失败' });
                          else if (r.warning) setBanner({ type: 'warning', text: r.warning });
                        }}
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: `${(a.start / Math.max(activeRecording.duration, 0.001)) * 100}%`,
                          width: `${Math.max(2, ((a.end - a.start) / Math.max(activeRecording.duration, 0.001)) * 100)}%`,
                          background: getLabelColor(a.label),
                          opacity: playbackState.currentTime >= a.start && playbackState.currentTime < a.end ? 0.95 : 0.55,
                          borderLeft: '1px solid rgba(255,255,255,0.9)',
                          borderRight: '1px solid rgba(255,255,255,0.9)',
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={activeRecording.duration}
                    step="0.1"
                    value={playbackState.currentTime}
                    onChange={handleSeek}
                    style={{
                      width: '100%',
                      marginTop: '4px',
                      opacity: 0,
                      position: 'absolute',
                      pointerEvents: 'none',
                    }}
                  />
                </div>

                <span style={{ fontSize: '12px', color: '#666', minWidth: '96px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatClock(playbackState.currentTime, true)} / {formatClock(lastFrameTime, true)}
                </span>
              </div>

              {playbackState.currentFrame && (
                <div>
                  <div style={{
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap',
                    padding: '8px',
                    background: 'rgba(255,255,255,0.5)',
                    borderRadius: '6px',
                    marginBottom: '6px',
                  }}>
                    <span style={{ fontSize: '11px', color: '#1976d2' }}>专注: {playbackState.currentFrame.brainState.focus.toFixed(0)}</span>
                    <span style={{ fontSize: '11px', color: '#388e3c' }}>放松: {playbackState.currentFrame.brainState.relaxation.toFixed(0)}</span>
                    <span style={{ fontSize: '11px', color: '#d32f2f' }}>疲劳: {playbackState.currentFrame.brainState.fatigue.toFixed(0)}</span>
                    <span style={{ fontSize: '11px', color: '#666' }}>|</span>
                    <span style={{ fontSize: '11px', color: '#1565c0' }}>α: {playbackState.currentFrame.bands.alpha.toFixed(2)}</span>
                    <span style={{ fontSize: '11px', color: '#e53935' }}>β: {playbackState.currentFrame.bands.beta.toFixed(2)}</span>
                    <span style={{ fontSize: '11px', color: '#2e7d32' }}>θ: {playbackState.currentFrame.bands.theta.toFixed(2)}</span>
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap',
                    padding: '8px',
                    background: 'rgba(255,255,255,0.5)',
                    borderRadius: '6px',
                  }}>
                    <span style={{ fontSize: '11px', color: '#666', fontWeight: 500 }}>相关度:</span>
                    {playbackState.currentFrame?.correlation.correlations
                      .filter(c => c.channel !== playbackState.currentFrame?.correlation.targetChannel)
                      .slice(0, 3)
                      .map((c, i) => (
                        <span key={i} style={{ fontSize: '11px', color: '#6a1b9a' }}>
                          {c.channel}: {(Math.abs(c.correlation) * 100).toFixed(0)}%
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}

          <AnnotationPanel recording={activeRecording} currentTime={playbackState.currentTime} />
        </div>
      )}

      <div>
        <div style={{
          fontSize: '12px',
          color: '#666',
          marginBottom: '8px',
          fontWeight: 500,
        }}>
          历史录制 ({recordings.length})
        </div>

        <HistoryFilterBar total={recordings.length} shown={filteredRecordings.length} />

        {recordings.length === 0 ? (
          <div style={{
            padding: '24px',
            textAlign: 'center',
            color: '#999',
            fontSize: '13px',
            border: '1px dashed #e0e0e0',
            borderRadius: '8px',
          }}>
            暂无录制记录
          </div>
        ) : filteredRecordings.length === 0 ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: '#90a4ae',
            fontSize: '12px',
            border: '1px dashed #b0bec5',
            borderRadius: '8px',
          }}>
            没有符合当前筛选条件的录制
          </div>
        ) : (
          <div style={{ maxHeight: '320px', overflow: 'auto' }}>
            {filteredRecordings.map((recording) => (
              <div
                key={recording.id}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: activeRecording?.id === recording.id
                    ? '2px solid #1565c0'
                    : '1px solid #e0e0e0',
                  marginBottom: '8px',
                  background: activeRecording?.id === recording.id ? '#e3f2fd' : '#fff',
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '6px',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#333',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{recording.name}</span>
                      {recording.frames.length === 0 && (
                        <span title="该录制没有数据帧，无法回放" style={{
                          flexShrink: 0, fontSize: '10px', padding: '1px 6px', borderRadius: '8px',
                          background: '#ffebee', color: '#b71c1c', border: '1px solid #ef9a9a',
                        }}>
                          无帧
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
                      {formatTime(recording.startTime)} · {CHANNEL_NAMES[recording.channel] || recording.channel}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button
                      onClick={() => handlePlayRecording(recording)}
                      disabled={recording.frames.length === 0}
                      title={recording.frames.length === 0 ? '该录制没有数据帧，无法回放' : ''}
                      style={{
                        padding: '4px 10px',
                        background: activeRecording?.id === recording.id ? '#1565c0' : '#f5f5f5',
                        color: activeRecording?.id === recording.id ? '#fff' : '#1565c0',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 500,
                        cursor: recording.frames.length === 0 ? 'not-allowed' : 'pointer',
                        opacity: recording.frames.length === 0 ? 0.55 : 1,
                      }}
                    >
                      {activeRecording?.id === recording.id ? '回放中' : '▶ 回放'}
                    </button>
                    <button
                      onClick={() => handleDeleteRecording(recording.id)}
                      style={{
                        padding: '4px 8px',
                        background: '#ffebee',
                        color: '#d32f2f',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <span style={{ fontSize: '11px', color: '#666', flexShrink: 0 }}>
                    {formatDuration(recording.duration)} · {recording.frames.length} 帧
                  </span>
                  {recording.annotations.length > 0 ? (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 0 }}>
                      {recording.annotations.slice(0, 4).map((a) => (
                        <button
                          key={a.id}
                          onClick={() => handleJumpFromHistory(recording.id, a.id)}
                          disabled={recording.frames.length === 0}
                          title={`${getLabelName(a.label)} ${formatClock(a.start, true)}–${formatClock(a.end, true)}${a.note ? ' · ' + a.note : ''}（点击跳转）`}
                          style={{
                            padding: '1px 7px',
                            fontSize: '10px',
                            borderRadius: '9px',
                            border: `1px solid ${getLabelColor(a.label)}`,
                            background: `${getLabelColor(a.label)}14`,
                            color: getLabelColor(a.label),
                            cursor: recording.frames.length === 0 ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {getLabelName(a.label)} {formatClock(a.start)}
                        </button>
                      ))}
                      {recording.annotations.length > 4 && (
                        <span style={{ fontSize: '10px', color: '#90a4ae', padding: '1px 4px' }}>
                          +{recording.annotations.length - 4}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span style={{ fontSize: '11px', color: '#999' }}>{recording.channel}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNameDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: '#fff',
            padding: '24px',
            borderRadius: '12px',
            width: '320px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            <h4 style={{ margin: '0 0 16px', fontSize: '16px', color: '#333' }}>
              保存录制
            </h4>
            <input
              type="text"
              value={recordingName}
              onChange={(e) => setRecordingName(e.target.value)}
              placeholder="输入录制名称（可选）"
              autoFocus
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '14px',
                marginBottom: '16px',
                boxSizing: 'border-box',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmSave();
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={handleCancelSave}
                style={{
                  padding: '8px 16px',
                  background: '#f5f5f5',
                  color: '#666',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={handleConfirmSave}
                style={{
                  padding: '8px 16px',
                  background: '#1565c0',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
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
