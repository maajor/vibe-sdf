'use client';

import { useRef, useEffect, useCallback, useMemo } from 'react';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  maximized?: boolean;
  onToggleMaximize?: () => void;
}

// Token types for highlighting
type TokenType = 'keyword' | 'builtin' | 'number' | 'string' | 'comment' | 'operator' | 'property' | 'plain';

interface Token {
  type: TokenType;
  text: string;
}

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'new', 'true', 'false', 'null', 'undefined',
]);

const BUILTINS = new Set([
  'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4',
  'Math', 'PI',
  'sin', 'cos', 'tan', 'abs', 'min', 'max', 'sqrt', 'pow', 'exp', 'log',
  'floor', 'ceil', 'round', 'clamp', 'mix', 'step', 'smoothstep', 'length',
  'normalize', 'dot', 'cross', 'reflect', 'refract', 'mod', 'fract', 'sign',
  'atan', 'atan2', 'asin', 'acos', 'pow',
]);

const SDF_FUNCTIONS = new Set([
  'sphere', 'box', 'roundedBox', 'torus', 'cylinder', 'capsule', 'cone',
  'ellipsoid', 'hexPrism', 'triangle', 'line', 'plane',
  'union', 'subtract', 'intersect', 'smoothUnion', 'smoothSubtract',
  'smoothIntersect', 'blend',
  'rotateX', 'rotateY', 'rotateZ', 'translate', 'scale', 'repeat',
  'displace', 'twist',
]);

const COLOR_MAP: Record<TokenType, string> = {
  keyword: '#c678dd',   // purple
  builtin: '#61afef',   // blue
  number: '#d19a66',    // orange
  string: '#98c379',    // green
  comment: '#5c6370',   // dim gray
  operator: '#56b6c2',  // cyan
  property: '#e5c07b',  // yellow
  plain: '#c8c8e0',     // default text
};

function tokenize(code: string): Token[][] {
  const lines = code.split('\n');
  return lines.map(line => {
    const tokens: Token[] = [];
    let i = 0;
    while (i < line.length) {
      // Single-line comment
      if (line[i] === '/' && line[i + 1] === '/') {
        tokens.push({ type: 'comment', text: line.slice(i) });
        break;
      }
      // Strings
      if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
        const quote = line[i];
        let j = i + 1;
        while (j < line.length && line[j] !== quote) {
          if (line[j] === '\\') j++;
          j++;
        }
        tokens.push({ type: 'string', text: line.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
      // Numbers
      if (/[0-9]/.test(line[i]) || (line[i] === '.' && /[0-9]/.test(line[i + 1]))) {
        let j = i;
        if (line[j] === '0' && (line[j + 1] === 'x' || line[j + 1] === 'X')) {
          j += 2;
          while (j < line.length && /[0-9a-fA-F]/.test(line[j])) j++;
        } else {
          while (j < line.length && /[0-9.]/.test(line[j])) j++;
          if (j < line.length && (line[j] === 'e' || line[j] === 'E')) {
            j++;
            if (j < line.length && (line[j] === '+' || line[j] === '-')) j++;
            while (j < line.length && /[0-9]/.test(line[j])) j++;
          }
        }
        tokens.push({ type: 'number', text: line.slice(i, j) });
        i = j;
        continue;
      }
      // Identifiers & keywords
      if (/[a-zA-Z_$]/.test(line[i])) {
        let j = i;
        while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
        const word = line.slice(i, j);
        let type: TokenType = 'plain';
        if (KEYWORDS.has(word)) type = 'keyword';
        else if (BUILTINS.has(word) || SDF_FUNCTIONS.has(word)) type = 'builtin';
        // Check if it's a property access (preceded by .)
        else if (i > 0 && line[i - 1] === '.') type = 'property';
        tokens.push({ type, text: word });
        i = j;
        continue;
      }
      // Operators
      if (/[+\-*/%=<>!&|^~?:]/.test(line[i])) {
        let j = i + 1;
        // Multi-char operators
        if (j < line.length && /[=>&|]/.test(line[j])) j++;
        tokens.push({ type: 'operator', text: line.slice(i, j) });
        i = j;
        continue;
      }
      // Whitespace & other
      tokens.push({ type: 'plain', text: line[i] });
      i++;
    }
    return tokens;
  });
}

export default function CodeEditor({ value, onChange, readOnly, maximized, onToggleMaximize }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const tokenizedLines = useMemo(() => tokenize(value), [value]);

  const handleScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current && lineNumbersRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  useEffect(() => {
    handleScroll();
  }, [value, handleScroll]);

  return (
    <div className="relative flex h-full font-mono text-sm bg-[#1a1a24] rounded-lg overflow-hidden border border-[#2a2a3a]">
      {/* Line numbers */}
      <div
        ref={lineNumbersRef}
        className="flex-shrink-0 py-3 px-2 text-right text-[#4a4a6a] select-none overflow-hidden bg-[#14141c] border-r border-[#2a2a3a]"
        style={{ width: '3rem' }}
      >
        {tokenizedLines.map((_, i) => (
          <div key={i} className="leading-6">{i + 1}</div>
        ))}
      </div>
      {/* Highlight layer + Textarea */}
      <div className="relative flex-1 min-w-0">
        {/* Syntax highlight overlay */}
        <pre
          ref={highlightRef}
          className="absolute inset-0 p-3 overflow-hidden leading-6 pointer-events-none whitespace-pre text-sm tabular-nums m-0"
          style={{ tabSize: 2 }}
          aria-hidden="true"
        >
          {tokenizedLines.map((tokens, li) => (
            <div key={li}>
              {tokens.map((t, ti) => (
                <span key={ti} style={{ color: COLOR_MAP[t.type] }}>{t.text}</span>
              ))}
              {'\n'}
            </div>
          ))}
        </pre>
        {/* Textarea (transparent text, user types here) */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          readOnly={readOnly}
          spellCheck={false}
          className="absolute inset-0 bg-transparent text-transparent p-3 resize-none outline-none leading-6 overflow-auto tabular-nums caret-[#7b7bff]"
          style={{ tabSize: 2 }}
        />
      </div>
      {/* Maximize button */}
      {onToggleMaximize && (
        <button
          onClick={onToggleMaximize}
          className="absolute top-1.5 right-1.5 z-10 w-7 h-7 flex items-center justify-center rounded bg-[#14141e]/80 border border-[#2a2a3a] text-[#5a5a7a] hover:text-[#c8c8e0] hover:border-[#5a5aff] transition-colors"
          title={maximized ? 'Minimize' : 'Maximize'}
        >
          {maximized ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="3" y="3" width="8" height="8" rx="1" />
              <line x1="5" y1="5" x2="9" y2="9" />
              <line x1="9" y1="5" x2="5" y2="9" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="2" y="2" width="10" height="10" rx="1" />
              <line x1="5" y1="2" x2="5" y2="12" />
              <line x1="9" y1="2" x2="9" y2="12" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
