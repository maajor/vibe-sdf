import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { SYSTEM_PROMPT } from '@/lib/system-prompt';
import { transpile } from '@/lib/transpiler';

export const maxDuration = 120;

const MAX_ATTEMPTS = 5;

function cleanLLMOutput(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

export async function POST(req: Request) {
  const { prompt, apiKey, baseUrl, provider, model } = await req.json();

  if (!apiKey || !prompt) {
    return new Response(JSON.stringify({ error: 'API key and prompt are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let aiModel;

  try {
    if (provider === 'anthropic') {
      const client = createAnthropic({ apiKey, baseURL: baseUrl || undefined });
      aiModel = client(model || 'claude-sonnet-4-20250514');
    } else {
      const client = createOpenAICompatible({ name: 'openai-compatible', baseURL: baseUrl || undefined, apiKey });
      aiModel = client.chatModel(model || 'gpt-4o');
    }
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Failed to initialize AI client' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let lastCode = '';
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (req.signal.aborted) {
      return new Response(JSON.stringify({ error: 'Request cancelled' }), {
        status: 499,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build the prompt for this attempt
    let userMessage: string;

    if (attempt === 1) {
      userMessage = `${SYSTEM_PROMPT}\n\n---\n\nUser request: Generate an SDF 3D model for: ${prompt}\n\nOutput only the function map(p) code. No markdown fences, no explanations.`;
    } else {
      userMessage = `${SYSTEM_PROMPT}\n\n---\n\nThe code you generated has compilation errors. Fix them.\n\nOriginal request: Generate an SDF 3D model for: ${prompt}\n\nGenerated code:\n${lastCode}\n\nErrors:\n${lastError}\n\nOutput only the corrected function map(p) code. No markdown fences, no explanations.`;
    }

    let resultText: string;
    try {
      const result = await generateText({
        model: aiModel,
        prompt: userMessage,
        abortSignal: req.signal,
      });
      resultText = result.text;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        return new Response(JSON.stringify({ error: 'Request cancelled' }), {
          status: 499,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'LLM call failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    lastCode = cleanLLMOutput(resultText);

    // Validate with transpiler
    const transpileResult = transpile(lastCode);

    if (!transpileResult.error) {
      return new Response(JSON.stringify({ text: lastCode, attempts: attempt }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Save error for next iteration's feedback
    lastError = transpileResult.error;
    console.log(`[generate] Attempt ${attempt} failed transpilation, retrying...\n${lastError}`);
  }

  // All attempts exhausted — return the last code anyway so the user can see it
  return new Response(JSON.stringify({
    text: lastCode,
    error: `Could not produce valid SDF code after ${MAX_ATTEMPTS} attempts.\n\nLast compilation error:\n${lastError}`,
    attempts: MAX_ATTEMPTS,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
