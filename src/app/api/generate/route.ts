import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { SYSTEM_PROMPT } from '@/lib/system-prompt';

export const maxDuration = 120;

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

    // Merge system prompt into user message for better third-party LLM compatibility
    const userMessage = `${SYSTEM_PROMPT}\n\n---\n\nUser request: Generate an SDF 3D model for: ${prompt}\n\nOutput only the function map(p) code. No markdown fences, no explanations.`;

    const result = await generateText({
      model: aiModel,
      prompt: userMessage,
      temperature: 0.7,
      maxTokens: 4096,
      abortSignal: req.signal,
    });

    return new Response(JSON.stringify({ text: result.text }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'LLM call failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
