import { useState, useEffect } from 'react';
import { useStore } from '../state/store';
import { Button } from './ui/Button';

export function JsonPreviewPanel() {
  const { getDocumentJson, loadDocument } = useStore();
  const [json, setJson] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!editMode) {
      setJson(getDocumentJson());
    }
  }, [editMode, getDocumentJson]);

  // Subscribe to store changes to refresh JSON
  useStore.subscribe(
    (state) => [state.pipeline, state.resources],
    () => {
      if (!editMode) setJson(getDocumentJson());
    }
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownload = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pipeline.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        loadDocument(text);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleApplyEdit = () => {
    loadDocument(editText);
    setEditMode(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/40 shrink-0">
        <Button size="sm" variant="ghost" onClick={() => { setJson(getDocumentJson()); }}>↻ Refresh</Button>
        <Button size="sm" variant="ghost" onClick={handleCopy}>{copied ? '✓ Copied' : 'Copy'}</Button>
        <Button size="sm" variant="ghost" onClick={handleDownload}>↓ Export</Button>
        <Button size="sm" variant="ghost" onClick={handleLoad}>↑ Import</Button>
        <div className="flex-1" />
        {editMode ? (
          <>
            <Button size="sm" variant="primary" onClick={handleApplyEdit}>Apply</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>Cancel</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => { setEditText(json); setEditMode(true); }}>Edit</Button>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        {editMode ? (
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full h-full bg-zinc-900 text-zinc-200 text-xs font-mono p-3 focus:outline-none resize-none"
            spellCheck={false}
          />
        ) : (
          <pre className="text-xs font-mono text-zinc-300 p-3 overflow-auto h-full whitespace-pre leading-relaxed">
            {json}
          </pre>
        )}
      </div>
    </div>
  );
}
