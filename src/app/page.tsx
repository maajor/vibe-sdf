'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import CodeEditor from '@/components/CodeEditor';

const Viewport = dynamic(() => import('@/components/Viewport'), { ssr: false });

type Provider = 'openai' | 'anthropic';

function cleanLLMOutput(text: string): string {
  let cleaned = text.trim();
  // Strip markdown code fences the LLM might add despite instructions
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

const SAMPLES = [
  { file: 'house.sdf', label: 'House', prompt: 'A cozy cottage' },
  { file: 'castle.sdf', label: 'Castle', prompt: 'A medieval stone castle with curtain walls forming a square, four tall corner towers with battlements, a central keep, a gatehouse with an archway and portcullis, and a surrounding moat with a small drawbridge.' },
  { file: 'knight_in_armor.sdf', label: 'Knight', prompt: 'A knight in armor' },
  { file: 'aircraft_carrier.sdf', label: 'Aircraft Carrier', prompt: 'A flying aircraft carrier with a flat deck on top, control tower, planes parked on deck, massive jet engines underneath keeping it aloft, and radar dishes' },
];

export default function Home() {
  // Restore saved settings from localStorage
  const savedSettings = typeof window !== 'undefined'
    ? (() => { try { return JSON.parse(localStorage.getItem('vibe-sdf-settings') || '{}'); } catch { return {}; } })()
    : {} as Record<string, string>;

  const [provider, setProvider] = useState<Provider>((savedSettings as Record<string, string>).provider === 'anthropic' ? 'anthropic' : 'openai');
  const [apiKey, setApiKey] = useState(savedSettings.apiKey || '');
  const [baseUrl, setBaseUrl] = useState(savedSettings.baseUrl || '');
  const [model, setModel] = useState(savedSettings.model || '');
  const [prompt, setPrompt] = useState('');
  const [code, setCode] = useState('');
  const [renderCode, setRenderCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editorMaximized, setEditorMaximized] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Persist settings
  useEffect(() => {
    try {
      localStorage.setItem('vibe-sdf-settings', JSON.stringify({ provider, apiKey, baseUrl, model }));
    } catch { /* ignore */ }
  }, [provider, apiKey, baseUrl, model]);

  const handleGenerate = useCallback(async () => {
    if (!apiKey.trim() || !prompt.trim()) return;

    setIsLoading(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim() || undefined,
          provider,
          model: model.trim() || undefined,
        }),
        signal: controller.signal,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Error ${res.status}`);
        return;
      }

      const cleaned = cleanLLMOutput(data.text || '');
      setCode(cleaned);
      setRenderCode(cleaned);

      if (data.error) {
        setError(data.error);
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name !== 'AbortError') setError(e.message || 'Generation failed');
      else if (!(e instanceof DOMException)) setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [apiKey, baseUrl, prompt, provider, model]);

  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
    setRenderCode(value);
    setError(null);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left panel — controls + code editor */}
      <div className="w-[400px] flex-shrink-0 flex flex-col border-r border-[#1a1a2a] bg-[#0d0d14]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#1a1a2a]">
          <h1 className="text-lg font-bold text-white tracking-tight">Vibe SDF</h1>
          <p className="text-[11px] text-[#5a5a7a] mt-0.5">Describe it, see it in 3D</p>
        </div>

        {/* Provider + API key */}
        <div className="px-4 py-3 space-y-2 border-b border-[#1a1a2a]">
          <div className="flex gap-2">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className="bg-[#14141e] border border-[#2a2a3a] rounded-md px-2 py-1.5 text-sm text-[#c8c8e0] outline-none focus:border-[#5a5aff]"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API Key"
              className="flex-1 min-w-0 bg-[#14141e] border border-[#2a2a3a] rounded-md px-2.5 py-1.5 text-sm text-[#c8c8e0] placeholder:text-[#3a3a5a] outline-none focus:border-[#5a5aff]"
            />
          </div>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Model (default: gpt-4o / claude-sonnet-4)"
            className="w-full bg-[#14141e] border border-[#2a2a3a] rounded-md px-2.5 py-1.5 text-sm text-[#c8c8e0] placeholder:text-[#3a3a5a] outline-none focus:border-[#5a5aff]"
          />
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="Base URL (optional, for third-party LLM)"
            className="w-full bg-[#14141e] border border-[#2a2a3a] rounded-md px-2.5 py-1.5 text-sm text-[#c8c8e0] placeholder:text-[#3a3a5a] outline-none focus:border-[#5a5aff]"
          />
        </div>

        {/* Prompt + generate */}
        <div className="px-4 py-3 space-y-2 border-b border-[#1a1a2a]">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isLoading && apiKey.trim() && prompt.trim()) {
                handleGenerate();
              }
            }}
            placeholder={'Describe a 3D object... e.g. "a red coffee mug"'}
            rows={3}
            className="w-full bg-[#14141e] border border-[#2a2a3a] rounded-md px-3 py-2 text-sm text-[#c8c8e0] placeholder:text-[#3a3a5a] outline-none focus:border-[#5a5aff] resize-none"
          />
          <button
            onClick={isLoading ? () => abortRef.current?.abort() : handleGenerate}
            disabled={!isLoading && (!apiKey.trim() || !prompt.trim())}
            className={`w-full py-2 rounded-md text-sm font-medium transition-colors ${
              isLoading
                ? 'bg-[#ff4444] hover:bg-[#ff3333] text-white'
                : 'bg-[#3a3aff] hover:bg-[#5555ff] text-white disabled:opacity-30 disabled:cursor-not-allowed'
            }`}
          >
            {isLoading ? 'Cancel' : 'Generate'}
          </button>
        </div>

        {/* Samples */}
        <div className="px-4 py-2 border-b border-[#1a1a2a]">
          <span className="text-[11px] text-[#5a5a7a] font-medium uppercase tracking-wider">Samples</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {SAMPLES.map((s) => (
              <button
                key={s.file}
                onClick={async () => {
                  try {
                    const res = await fetch(`/samples/${s.file}`);
                    const text = await res.text();
                    setCode(text);
                    setRenderCode(text);
                    setPrompt(s.prompt);
                    setError(null);
                  } catch {
                    setError('Failed to load sample');
                  }
                }}
                className="px-2 py-1 text-[11px] rounded bg-[#14141e] border border-[#2a2a3a] text-[#8888aa] hover:text-[#c8c8e0] hover:border-[#5a5aff] transition-colors"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Code editor */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-4 py-1.5 border-b border-[#1a1a2a] flex items-center justify-between shrink-0">
            <span className="text-[11px] text-[#5a5a7a] font-medium uppercase tracking-wider">Code</span>
            {isLoading && <span className="text-[11px] text-[#5a5aff] animate-pulse">streaming...</span>}
          </div>
          <div className="flex-1 min-h-0">
            <CodeEditor value={code} onChange={handleCodeChange} onToggleMaximize={() => setEditorMaximized(true)} />
          </div>
        </div>

        {/* Error bar */}
        {error && (
          <div className="px-3 py-2 bg-[#2a0a0a] border-t border-[#4a1a1a] text-[#ff6a6a] text-xs font-mono whitespace-pre-wrap max-h-24 overflow-auto shrink-0">
            {error}
          </div>
        )}
      </div>

      {/* Right panel — 3D viewport */}
      <div className="flex-1 relative">
        <Viewport code={renderCode} onError={setError} />
      </div>

      {/* Fullscreen code editor overlay */}
      {editorMaximized && (
        <div className="fixed inset-0 z-50 bg-[#0d0d14] flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a2a]">
            <span className="text-[11px] text-[#5a5a7a] font-medium uppercase tracking-wider">Code Editor</span>
            <button
              onClick={() => setEditorMaximized(false)}
              className="px-3 py-1 text-xs rounded bg-[#14141e] border border-[#2a2a3a] text-[#8888aa] hover:text-white hover:border-[#5a5aff] transition-colors"
            >
              Esc to close
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <CodeEditor value={code} onChange={handleCodeChange} maximized onToggleMaximize={() => setEditorMaximized(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
