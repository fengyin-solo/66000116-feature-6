import React, { useState, useEffect } from 'react';
import { ANNOTATION_COLORS, SegmentAnnotation } from '../types';
import { AnnotationDraft } from '../store/eeg';

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const panelStyle: React.CSSProperties = {
  background: '#fff',
  padding: '24px',
  borderRadius: '12px',
  width: '460px',
  maxHeight: '80vh',
  overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
};
const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid #e0e0e0',
  borderRadius: '6px',
  fontSize: '13px',
  boxSizing: 'border-box',
};

const ColorPicker: React.FC<{ value: string; onChange: (c: string) => void }> = ({ value, onChange }) => (
  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
    {ANNOTATION_COLORS.map(c => (
      <button
        key={c}
        type="button"
        onClick={() => onChange(c)}
        aria-label={`颜色 ${c}`}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: c,
          border: value === c ? '2px solid #333' : '2px solid transparent',
          cursor: 'pointer',
          padding: 0,
        }}
      />
    ))}
  </div>
);

interface RowState {
  label: string;
  start: string;
  end: string;
  color: string;
}

const toDraft = (row: RowState): AnnotationDraft => ({
  label: row.label,
  start: parseFloat(row.start),
  end: parseFloat(row.end),
  color: row.color,
});

/** 批量添加标注：一次提交多行，任何一行非法则整体不写入（由 store 校验） */
export const BatchAnnotationDialog: React.FC<{
  duration: number;
  initialTime?: number;
  onClose: () => void;
  onSubmit: (drafts: AnnotationDraft[]) => string | null;
}> = ({ duration, initialTime, onClose, onSubmit }) => {
  const makeRow = (): RowState => ({
    label: '',
    start: initialTime !== undefined ? Math.min(initialTime, duration).toFixed(1) : '0',
    end: initialTime !== undefined ? Math.min(initialTime + 3, duration).toFixed(1) : Math.min(3, duration).toFixed(1),
    color: ANNOTATION_COLORS[0],
  });
  const [rows, setRows] = useState<RowState[]>([makeRow()]);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<RowState>) => {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setError(null);
  };

  const handleSubmit = () => {
    const err = onSubmit(rows.map(toDraft));
    if (err) setError(err);
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={e => e.stopPropagation()}>
        <h4 style={{ margin: '0 0 4px', fontSize: '16px', color: '#333' }}>批量添加片段标注</h4>
        <div style={{ fontSize: '12px', color: '#999', marginBottom: '16px' }}>
          时间范围 0 – {duration.toFixed(1)}s；一次提交多行，任一非法则整批不保存。
        </div>

        {rows.map((row, i) => (
          <div key={i} style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            marginBottom: 8,
            padding: 8,
            background: '#f7f9fc',
            borderRadius: 8,
          }}>
            <span style={{ fontSize: '11px', color: '#999', width: 16, flexShrink: 0 }}>{i + 1}</span>
            <input
              type="text"
              value={row.label}
              placeholder="标注名称"
              onChange={e => update(i, { label: e.target.value })}
              style={{ ...inputStyle, flex: 2, minWidth: 0 }}
            />
            <input
              type="number"
              min={0}
              max={duration}
              step={0.1}
              value={row.start}
              title="起点(秒)"
              onChange={e => update(i, { start: e.target.value })}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />
            <span style={{ color: '#999', fontSize: 12 }}>–</span>
            <input
              type="number"
              min={0}
              max={duration}
              step={0.1}
              value={row.end}
              title="终点(秒)"
              onChange={e => update(i, { end: e.target.value })}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />
            <ColorPicker value={row.color} onChange={c => update(i, { color: c })} />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#d32f2f', fontSize: 14, flexShrink: 0 }}
                aria-label="删除该行"
              >✕</button>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() => setRows([...rows, { ...makeRow(), color: ANNOTATION_COLORS[rows.length % ANNOTATION_COLORS.length] }])}
          style={{
            width: '100%', padding: '8px', marginBottom: 12,
            border: '1px dashed #90caf9', borderRadius: 8,
            background: 'transparent', color: '#1565c0', fontSize: 13, cursor: 'pointer',
          }}
        >
          ＋ 再添加一条
        </button>

        {error && (
          <div style={{
            marginBottom: 12, padding: '8px 12px', borderRadius: 6,
            background: '#ffebee', color: '#c62828', fontSize: '12px',
          }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: '#f5f5f5', color: '#666', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
            取消
          </button>
          <button onClick={handleSubmit} style={{ padding: '8px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
            全部保存
          </button>
        </div>
      </div>
    </div>
  );
};

/** 逐条编辑单条标注 */
export const EditAnnotationDialog: React.FC<{
  annotation: SegmentAnnotation;
  duration: number;
  onClose: () => void;
  onSubmit: (patch: { label: string; start: number; end: number; color: string }) => string | null;
}> = ({ annotation, duration, onClose, onSubmit }) => {
  const [label, setLabel] = useState(annotation.label);
  const [start, setStart] = useState(String(annotation.start));
  const [end, setEnd] = useState(String(annotation.end));
  const [color, setColor] = useState(annotation.color);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const err = onSubmit({ label, start: parseFloat(start), end: parseFloat(end), color });
    if (err) setError(err);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...panelStyle, width: '380px' }} onClick={e => e.stopPropagation()}>
        <h4 style={{ margin: '0 0 16px', fontSize: '16px', color: '#333' }}>编辑标注</h4>
        <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: 4 }}>名称</label>
        <input
          type="text"
          value={label}
          autoFocus
          onChange={e => { setLabel(e.target.value); setError(null); }}
          style={{ ...inputStyle, width: '100%', marginBottom: 12 }}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
        />
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: 4 }}>起点 (s)</label>
            <input type="number" min={0} max={duration} step={0.1} value={start}
              onChange={e => { setStart(e.target.value); setError(null); }}
              style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: 4 }}>终点 (s)</label>
            <input type="number" min={0} max={duration} step={0.1} value={end}
              onChange={e => { setEnd(e.target.value); setError(null); }}
              style={{ ...inputStyle, width: '100%' }} />
          </div>
        </div>
        <div style={{ marginBottom: error ? 12 : 16 }}>
          <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: 6 }}>颜色</label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        {error && (
          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: '#ffebee', color: '#c62828', fontSize: '12px' }}>
            ⚠ {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: '#f5f5f5', color: '#666', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
            取消
          </button>
          <button onClick={handleSubmit} style={{ padding: '8px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

/** 通用确认框（用于整组删除） */
export const ConfirmDialog: React.FC<{
  title: string;
  message: string;
  confirmText?: string;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ title, message, confirmText = '删除', onConfirm, onClose }) => (
  <div style={overlayStyle} onClick={onClose}>
    <div style={{ ...panelStyle, width: '340px' }} onClick={e => e.stopPropagation()}>
      <h4 style={{ margin: '0 0 12px', fontSize: '16px', color: '#c62828' }}>{title}</h4>
      <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.6, marginBottom: 20 }}>{message}</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ padding: '8px 16px', background: '#f5f5f5', color: '#666', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
          取消
        </button>
        <button onClick={onConfirm} style={{ padding: '8px 16px', background: '#d32f2f', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
          {confirmText}
        </button>
      </div>
    </div>
  </div>
);
