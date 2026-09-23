import React, { useEffect, useMemo, useState } from 'react';
import { useEEGStore } from '../store/eeg';
import { AnnotationDraft, AnnotationFieldErrors, MutationResult, Recording, SegmentAnnotation } from '../types';
import {
  ANNOTATION_LABELS,
  formatClock,
  getLabelColor,
  getLabelName,
  sortAnnotations,
  validateAnnotation,
} from '../utils/annotations';

interface Banner {
  type: 'error' | 'success' | 'warning';
  text: string;
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid #d0d7de',
  borderRadius: '6px',
  fontSize: '12px',
  boxSizing: 'border-box',
};

const errorInputStyle: React.CSSProperties = { ...inputStyle, borderColor: '#d32f2f', background: '#fff5f5' };

const BannerView: React.FC<{ banner: Banner | null }> = ({ banner }) => {
  if (!banner) return null;
  const colors = {
    error: { bg: '#ffebee', fg: '#b71c1c', border: '#ef9a9a' },
    success: { bg: '#e8f5e9', fg: '#1b5e20', border: '#a5d6a7' },
    warning: { bg: '#fff8e1', fg: '#e65100', border: '#ffcc80' },
  }[banner.type];
  return (
    <div
      style={{
        marginTop: '8px',
        padding: '8px 10px',
        fontSize: '11px',
        lineHeight: 1.5,
        borderRadius: '6px',
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        wordBreak: 'break-all',
      }}
    >
      {banner.type === 'error' ? '⚠ ' : banner.type === 'warning' ? 'ℹ ' : '✓ '}
      {banner.text}
    </div>
  );
};

const LabelSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}> = ({ value, onChange, invalid }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    style={{ ...(invalid ? errorInputStyle : inputStyle), cursor: 'pointer' }}
  >
    <option value="">类别…</option>
    {ANNOTATION_LABELS.map((l) => (
      <option key={l.id} value={l.id}>
        {l.name}
      </option>
    ))}
  </select>
);

/** 把批量添加返回的逐行错误（按非空行序号）映射回表单行 */
const mapRowErrors = (
  drafts: AnnotationDraft[],
  rowErrors?: Record<string, AnnotationFieldErrors>,
): Record<number, AnnotationFieldErrors> => {
  const result: Record<number, AnnotationFieldErrors> = {};
  if (!rowErrors) return result;
  let nonEmptyIdx = -1;
  drafts.forEach((d, i) => {
    const filled = d.start !== null || d.end !== null || (d.note?.trim() ?? '') !== '';
    if (filled) {
      nonEmptyIdx += 1;
      if (rowErrors[String(nonEmptyIdx)]) result[i] = rowErrors[String(nonEmptyIdx)];
    }
  });
  return result;
};

interface AnnotationPanelProps {
  recording: Recording;
  currentTime: number;
}

export const AnnotationPanel: React.FC<AnnotationPanelProps> = ({ recording, currentTime }) => {
  const addAnnotations = useEEGStore((s) => s.addAnnotations);
  const updateAnnotation = useEEGStore((s) => s.updateAnnotation);
  const deleteAnnotations = useEEGStore((s) => s.deleteAnnotations);
  const jumpToAnnotation = useEEGStore((s) => s.jumpToAnnotation);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const emptyDraft = (): AnnotationDraft => ({ label: 'event', start: null, end: null, note: '' });
  const [drafts, setDrafts] = useState<AnnotationDraft[]>([emptyDraft(), emptyDraft(), emptyDraft()]);
  const [addRowErrors, setAddRowErrors] = useState<Record<number, AnnotationFieldErrors>>({});
  const [addError, setAddError] = useState<string | null>(null);

  const [editing, setEditing] = useState<SegmentAnnotation | null>(null);
  const [editLabel, setEditLabel] = useState('event');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editErrors, setEditErrors] = useState<AnnotationFieldErrors>({});

  // 切换录制时重置本地选择 / 编辑态
  useEffect(() => {
    setSelectedIds(new Set());
    setDeleteArmed(false);
    setBanner(null);
    setShowAdd(false);
    setEditing(null);
  }, [recording.id]);

  const annotations = useMemo(
    () => sortAnnotations(recording.annotations),
    [recording.annotations],
  );

  const hasFrames = recording.frames.length > 0;
  const allSelected = annotations.length > 0 && selectedIds.size === annotations.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDeleteArmed(false);
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(annotations.map((a) => a.id)));
    setDeleteArmed(false);
  };

  const handleJump = (annotation: SegmentAnnotation) => {
    const res = jumpToAnnotation(recording.id, annotation.id);
    setBanner(
      res.ok
        ? res.warning
          ? { type: 'warning', text: res.warning }
          : {
              type: 'success',
              text: `已跳转到「${getLabelName(annotation.label)}」片段 ${formatClock(
                annotation.start,
                true,
              )}`,
            }
        : { type: 'error', text: res.reason ?? '跳转失败' },
    );
  };

  const openAdd = () => {
    setDrafts([emptyDraft(), emptyDraft(), emptyDraft()]);
    setAddRowErrors({});
    setAddError(null);
    setShowAdd(true);
  };

  const updateDraft = (index: number, patch: Partial<AnnotationDraft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  /** 用当前回放时间快速填充某一行 */
  const fillCurrentTime = (index: number) => {
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === index
          ? {
              ...d,
              start: d.start ?? Math.round(currentTime * 10) / 10,
              end:
                d.end ??
                Math.round(Math.min(recording.duration, currentTime + 3) * 10) / 10,
            }
          : d,
      ),
    );
  };

  const handleBatchAdd = () => {
    const res: MutationResult = addAnnotations(recording.id, drafts);
    if (!res.ok) {
      setAddError(res.reason ?? '添加失败');
      setAddRowErrors(mapRowErrors(drafts, res.rowErrors));
      setBanner(null);
      return;
    }
    setShowAdd(false);
    setDrafts([emptyDraft(), emptyDraft(), emptyDraft()]);
    setAddRowErrors({});
    setAddError(null);
    setBanner({ type: 'success', text: `已保存 ${res.added?.length ?? 0} 条标注` });
  };

  const openEdit = (annotation: SegmentAnnotation) => {
    setEditing(annotation);
    setEditLabel(annotation.label);
    setEditStart(annotation.start.toFixed(1));
    setEditEnd(annotation.end.toFixed(1));
    setEditNote(annotation.note ?? '');
    setEditErrors({});
  };

  const handleEditSave = () => {
    if (!editing) return;
    const start = parseFloat(editStart);
    const end = parseFloat(editEnd);
    // 先在本地做一次即时校验提示
    const preview = validateAnnotation(
      { label: editLabel, start: Number.isNaN(start) ? null : start, end: Number.isNaN(end) ? null : end, note: editNote },
      recording.duration,
    );
    const res = updateAnnotation(recording.id, editing.id, {
      label: editLabel,
      start: Number.isNaN(start) ? (null as unknown as number) : start,
      end: Number.isNaN(end) ? (null as unknown as number) : end,
      note: editNote,
    });
    if (!res.ok) {
      setEditErrors(res.fieldErrors ?? preview);
      setBanner({ type: 'error', text: res.reason ?? '保存失败' });
      return;
    }
    setEditing(null);
    setBanner({ type: 'success', text: '标注已更新' });
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    const count = selectedIds.size;
    const res = deleteAnnotations(recording.id, [...selectedIds]);
    if (!res.ok) {
      setBanner({ type: 'error', text: res.reason ?? '删除失败' });
      return;
    }
    setSelectedIds(new Set());
    setDeleteArmed(false);
    setBanner({ type: 'success', text: `已删除 ${count} 条标注` });
  };

  return (
    <div
      style={{
        marginTop: '10px',
        padding: '10px',
        background: 'rgba(255,255,255,0.55)',
        borderRadius: '8px',
        border: '1px solid rgba(144,202,249,0.6)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: '#1565c0' }}>
          <label
            style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', margin: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={annotations.length === 0} />
          </label>
          🏷 片段标注 ({annotations.length})
          {selectedIds.size > 0 && (
            <span style={{ color: '#6a1b9a', fontWeight: 500 }}>已选 {selectedIds.size}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={openAdd}
            style={{
              padding: '4px 10px', fontSize: '11px', borderRadius: '5px',
              border: '1px solid #90caf9', background: '#fff', color: '#1565c0', cursor: 'pointer',
            }}
          >
            ＋ 批量添加
          </button>
          <button
            onClick={handleBatchDelete}
            disabled={selectedIds.size === 0}
            style={{
              padding: '4px 10px', fontSize: '11px', borderRadius: '5px', cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
              border: deleteArmed ? '1px solid #b71c1c' : '1px solid #ef9a9a',
              background: deleteArmed ? '#d32f2f' : '#ffebee',
              color: deleteArmed ? '#fff' : '#b71c1c',
              opacity: selectedIds.size === 0 ? 0.5 : 1,
            }}
          >
            {deleteArmed ? `确认删除 ${selectedIds.size} 条？` : '🗑 整组删除'}
          </button>
        </div>
      </div>

      {annotations.length === 0 ? (
        <div style={{ padding: '12px', textAlign: 'center', fontSize: '11px', color: '#90a4ae', border: '1px dashed #b0bec5', borderRadius: '6px' }}>
          暂无标注，点击「批量添加」标记关键片段
        </div>
      ) : (
        <div style={{ maxHeight: '220px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {annotations.map((a) => {
            const checked = selectedIds.has(a.id);
            const color = getLabelColor(a.label);
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '8px',
                  padding: '7px 8px', borderRadius: '6px',
                  background: checked ? '#f3e5f5' : '#fff',
                  border: `1px solid ${checked ? '#ce93d8' : '#e8edf2'}`,
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggleSelect(a.id)} style={{ marginTop: '2px' }} />
                <div
                  title={getLabelName(a.label)}
                  style={{ width: '4px', alignSelf: 'stretch', borderRadius: '2px', background: color, flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color }}>{getLabelName(a.label)}</span>
                    <span style={{ fontSize: '11px', color: '#455a64', fontVariantNumeric: 'tabular-nums' }}>
                      {formatClock(a.start, true)} – {formatClock(a.end, true)}
                    </span>
                  </div>
                  {a.note && (
                    <div style={{ fontSize: '11px', color: '#78909c', marginTop: '2px', wordBreak: 'break-all' }}>
                      {a.note}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  <button
                    onClick={() => handleJump(a)}
                    disabled={!hasFrames}
                    title={hasFrames ? '回放跳转到该片段' : '该录制无数据帧'}
                    style={{
                      padding: '3px 8px', fontSize: '11px', borderRadius: '4px', cursor: hasFrames ? 'pointer' : 'not-allowed',
                      border: '1px solid #90caf9', background: '#e3f2fd', color: '#1565c0', opacity: hasFrames ? 1 : 0.5,
                    }}
                  >
                    ⤵ 跳转
                  </button>
                  <button
                    onClick={() => openEdit(a)}
                    style={{
                      padding: '3px 8px', fontSize: '11px', borderRadius: '4px', cursor: 'pointer',
                      border: '1px solid #cfd8dc', background: '#fafafa', color: '#546e7a',
                    }}
                  >
                    ✎
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <BannerView banner={banner} />

      {/* 批量添加弹窗 */}
      {showAdd && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setShowAdd(false)}
        >
          <div
            style={{ background: '#fff', borderRadius: '12px', width: '460px', maxWidth: '92vw', maxHeight: '86vh', overflow: 'auto', padding: '18px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <h4 style={{ margin: 0, fontSize: '15px', color: '#263238' }}>批量添加片段标注</h4>
              <span style={{ fontSize: '11px', color: '#90a4ae' }}>录制时长 {formatClock(recording.duration, true)}</span>
            </div>
            <div style={{ fontSize: '11px', color: '#78909c', marginBottom: '12px' }}>
              一次可填写多行；任一行不合法则整批不提交，已填写的内容会保留
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {drafts.map((d, i) => {
                const errs = addRowErrors[i];
                return (
                  <div key={i} style={{ padding: '8px', border: '1px solid #eceff1', borderRadius: '8px', background: '#fafbfc' }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', color: '#90a4ae', width: '16px' }}>{i + 1}</span>
                      <LabelSelect value={d.label} onChange={(v) => updateDraft(i, { label: v })} invalid={!!errs?.label} />
                      <input
                        type="number" min={0} step={0.1} placeholder="开始(s)"
                        value={d.start ?? ''}
                        onChange={(e) => updateDraft(i, { start: e.target.value === '' ? null : parseFloat(e.target.value) })}
                        style={{ ...(errs?.start ? errorInputStyle : inputStyle), width: '78px' }}
                      />
                      <span style={{ fontSize: '11px', color: '#90a4ae' }}>–</span>
                      <input
                        type="number" min={0} step={0.1} placeholder="结束(s)"
                        value={d.end ?? ''}
                        onChange={(e) => updateDraft(i, { end: e.target.value === '' ? null : parseFloat(e.target.value) })}
                        style={{ ...(errs?.end ? errorInputStyle : inputStyle), width: '78px' }}
                      />
                      <button
                        onClick={() => fillCurrentTime(i)}
                        title={`填入当前回放时间 ${formatClock(currentTime, true)}`}
                        style={{
                          padding: '4px 8px', fontSize: '10px', borderRadius: '4px',
                          border: '1px solid #b39ddb', background: '#f3e5f5', color: '#6a1b9a', cursor: 'pointer',
                        }}
                      >
                        ⏱ 当前
                      </button>
                    </div>
                    <input
                      type="text" placeholder="备注（可选）"
                      value={d.note ?? ''}
                      onChange={(e) => updateDraft(i, { note: e.target.value })}
                      style={{ ...(errs?.note ? errorInputStyle : inputStyle), width: '100%', marginTop: '6px' }}
                    />
                    {errs && (
                      <div style={{ marginTop: '4px', fontSize: '10px', color: '#c62828', lineHeight: 1.5 }}>
                        {[errs.start, errs.end, errs.label, errs.note].filter(Boolean).join('；')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {drafts.length < 10 && (
              <button
                onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}
                style={{ marginTop: '8px', padding: '4px 10px', fontSize: '11px', border: 'none', background: 'transparent', color: '#1565c0', cursor: 'pointer' }}
              >
                ＋ 再加一行
              </button>
            )}
            {addError && (
              <div style={{ marginTop: '10px', padding: '8px 10px', fontSize: '11px', borderRadius: '6px', background: '#ffebee', color: '#b71c1c', border: '1px solid #ef9a9a' }}>
                ⚠ {addError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
              <button
                onClick={() => setShowAdd(false)}
                style={{ padding: '7px 16px', fontSize: '13px', borderRadius: '6px', border: '1px solid #cfd8dc', background: '#f5f5f5', color: '#546e7a', cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={handleBatchAdd}
                style={{ padding: '7px 16px', fontSize: '13px', borderRadius: '6px', border: 'none', background: '#1565c0', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
              >
                整批保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 逐条编辑弹窗 */}
      {editing && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setEditing(null)}
        >
          <div
            style={{ background: '#fff', borderRadius: '12px', width: '360px', maxWidth: '92vw', padding: '18px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ margin: '0 0 14px', fontSize: '15px', color: '#263238' }}>编辑标注</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#607d8b' }}>类别</label>
                <div style={{ marginTop: '4px' }}>
                  <LabelSelect value={editLabel} onChange={setEditLabel} invalid={!!editErrors.label} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: '#607d8b' }}>开始时间 (s)</label>
                  <input
                    type="number" min={0} step={0.1} value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                    style={{ ...(editErrors.start ? errorInputStyle : inputStyle), width: '100%', marginTop: '4px' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: '#607d8b' }}>结束时间 (s)</label>
                  <input
                    type="number" min={0} step={0.1} value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                    style={{ ...(editErrors.end ? errorInputStyle : inputStyle), width: '100%', marginTop: '4px' }}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#607d8b' }}>备注</label>
                <input
                  type="text" value={editNote} maxLength={200}
                  onChange={(e) => setEditNote(e.target.value)}
                  style={{ ...(editErrors.note ? errorInputStyle : inputStyle), width: '100%', marginTop: '4px' }}
                />
              </div>
            </div>
            {(editErrors.start || editErrors.end || editErrors.label || editErrors.note) && (
              <div style={{ marginTop: '10px', fontSize: '11px', color: '#c62828', lineHeight: 1.6 }}>
                ⚠ {[editErrors.start, editErrors.end, editErrors.label, editErrors.note].filter(Boolean).join('；')}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button
                onClick={() => setEditing(null)}
                style={{ padding: '7px 16px', fontSize: '13px', borderRadius: '6px', border: '1px solid #cfd8dc', background: '#f5f5f5', color: '#546e7a', cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={handleEditSave}
                style={{ padding: '7px 16px', fontSize: '13px', borderRadius: '6px', border: 'none', background: '#1565c0', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
