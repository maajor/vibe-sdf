import { SYSTEM_PROMPT } from '@/lib/system-prompt';

export const maxDuration = 120;

export async function POST(req: Request) {
  const { prompt, apiKey, baseUrl, model } = await req.json();

  if (!apiKey || !prompt) {
    return new Response(JSON.stringify({ error: 'API key and prompt are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const userMessage = `User request: Generate an SDF 3D model for: ${prompt}\n\nOutput only the function map(p) code. No markdown fences, no explanations.`;
    
    const url = `${baseUrl || 'https://api.openai.com'}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API returned ${response.status}: ${error}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    return new Response(JSON.stringify({ text }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    console.error('LLM call failed:', e);

    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'LLM call failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
