import React from 'react';
import { useEEGStore } from '../store/eeg';
import { ANNOTATION_LABELS } from '../utils/annotations';

const CHANNELS = ['Fp1', 'Fp2', 'F3', 'F4', 'C3', 'C4', 'P3', 'P4', 'O1', 'O2'];
const CHANNEL_NAMES: Record<string, string> = {
  Fp1: '左前额', Fp2: '右前额', F3: '左额', F4: '右额',
  C3: '左中央', C4: '右中央', P3: '左顶', P4: '右顶',
  O1: '左枕', O2: '右枕',
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: '110px',
  padding: '5px 8px',
  border: '1px solid #cfd8dc',
  borderRadius: '6px',
  fontSize: '11px',
  background: '#fff',
  color: '#37474f',
  cursor: 'pointer',
};

/** 历史录制筛选：按通道 + 按标注类别 / 有无标注（选择会持久化） */
export const HistoryFilterBar: React.FC<{ total: number; shown: number }> = ({ total, shown }) => {
  const historyFilters = useEEGStore((s) => s.historyFilters);
  const setHistoryFilters = useEEGStore((s) => s.setHistoryFilters);

  return (
    <div
      style={{
        marginBottom: '10px',
        padding: '8px',
        background: '#f4f7fa',
        borderRadius: '8px',
        border: '1px solid #e3e9f0',
      }}
    >
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', color: '#78909c', flexShrink: 0 }}>筛选</span>
        <select
          value={historyFilters.channel}
          onChange={(e) => setHistoryFilters({ channel: e.target.value })}
          style={selectStyle}
          title="按录制通道过滤"
        >
          <option value="all">全部通道</option>
          {CHANNELS.map((ch) => (
            <option key={ch} value={ch}>
              {ch} · {CHANNEL_NAMES[ch]}
            </option>
          ))}
        </select>
        <select
          value={historyFilters.annotation}
          onChange={(e) => setHistoryFilters({ annotation: e.target.value })}
          style={selectStyle}
          title="按标注过滤"
        >
          <option value="all">全部标注</option>
          <option value="any">含标注</option>
          <option value="none">无标注</option>
          {ANNOTATION_LABELS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div style={{ marginTop: '6px', fontSize: '10px', color: '#90a4ae', display: 'flex', justifyContent: 'space-between' }}>
        <span>
          {shown === total ? `共 ${total} 条` : `筛选出 ${shown} / ${total} 条`}
        </span>
        {(historyFilters.channel !== 'all' || historyFilters.annotation !== 'all') && (
          <button
            onClick={() => setHistoryFilters({ channel: 'all', annotation: 'all' })}
            style={{ border: 'none', background: 'transparent', color: '#1565c0', fontSize: '10px', cursor: 'pointer', padding: 0 }}
          >
            清除筛选
          </button>
        )}
      </div>
    </div>
  );
};
