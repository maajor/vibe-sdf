'use client';

import { useRef, useEffect, useCallback } from 'react';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export default function CodeEditor({ value, onChange, readOnly }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  useEffect(() => {
    handleScroll();
  }, [value, handleScroll]);

  const lines = value.split('\n');

  return (
    <div className="relative flex h-full font-mono text-sm bg-[#1a1a24] rounded-lg overflow-hidden border border-[#2a2a3a]">
      {/* Line numbers */}
      <div
        ref={lineNumbersRef}
        className="flex-shrink-0 py-3 px-2 text-right text-[#4a4a6a] select-none overflow-hidden bg-[#14141c] border-r border-[#2a2a3a]"
        style={{ width: '3rem' }}
      >
        {lines.map((_, i) => (
          <div key={i} className="leading-6">{i + 1}</div>
        ))}
      </div>
      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        readOnly={readOnly}
        spellCheck={false}
        className="flex-1 bg-transparent text-[#c8c8e0] p-3 resize-none outline-none leading-6 overflow-auto tabular-nums caret-[#7b7bff]"
        style={{ tabSize: 2 }}
      />
    </div>
  );
}
