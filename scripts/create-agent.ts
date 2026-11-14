// Creates (or updates) the ElevenLabs Conversational AI agent that is Home 5's voice.
// The agent can only CHECK, ASK and EXPLAIN through client tools that call our own deterministic API.
// It cannot teach, roll back or forget. Usage: npx tsx scripts/create-agent.ts  -> prints ELEVENLABS_AGENT_ID
import 'dotenv/config';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error('ELEVENLABS_API_KEY missing');
const API = 'https://api.elevenlabs.io/v1/convai';

const prompt = `You are the household robot in Home 5, East York, Toronto. Young kids live here.
You are part of a fleet that learns household skills from people. You never decide what is safe yourself:
the fleet's rules, written in code, decide. Your job is to use your tools and say plainly what they returned.

Rules you must follow:
- When someone tells you to do something with an object and a place (for example "put the knives in the low drawer"),
  call check_instruction with their exact words FIRST. If it returns refused=true, refuse in one sentence and give the
  reason it returned, in plain words (a sharp thing within a child's reach). Do not offer workarounds.
- For any other household request ("tidy the kitchen", "put the dishes away"), call ask_home with their words and
  say what it returned: which lesson you ran, who taught it, and where the knife went if it says.
- If asked who taught you, or where you learned something, call who_taught_you and say what it returned.
- You cannot teach new skills, roll anything back, or forget anyone. If asked, say a teacher does that on the console.
- Never claim you did something unless a tool result says so. At most two short sentences per reply. Warm, calm, brief.
- When check_instruction refuses an instruction, say your one-sentence refusal, then immediately call end_call. Never end the call in any other situation.`;

const tools = [
  {
    type: 'client', name: 'check_instruction', expects_response: true, response_timeout_secs: 10,
    description: 'Check a direct instruction (objects and places) against this home\'s safety rules. Read-only.',
    parameters: { type: 'object', required: ['instruction'], properties: { instruction: { type: 'string', description: "The person's exact words" } } },
  },
  {
    type: 'client', name: 'ask_home', expects_response: true, response_timeout_secs: 10,
    description: 'Ask Home 5 to do a household request using the lessons the fleet has taught it. Returns what it did.',
    parameters: { type: 'object', required: ['request'], properties: { request: { type: 'string', description: "The person's request in their words" } } },
  },
  {
    type: 'client', name: 'who_taught_you', expects_response: true, response_timeout_secs: 10,
    description: 'Return who taught the last lesson Home 5 ran, what it was built on, and how many homes took or refused it.',
    parameters: { type: 'object', properties: {} },
  },
];

async function call(path: string, method: string, body?: unknown) {
  const res = await fetch(API + path, { method, headers: { 'xi-api-key': KEY!, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const llms = (process.env.AGENT_LLM ?? 'claude-haiku-4-5,gemini-2.5-flash,gpt-4o-mini').split(',');
let lastErr: unknown = null;
for (const llm of llms) {
  const config = {
    name: 'One Lesson · Home 5',
    conversation_config: {
      agent: {
        first_message: 'Home 5 here. What would you like me to do?',
        language: 'en',
        prompt: { prompt, llm, temperature: 0, tools, built_in_tools: { end_call: { type: 'system', name: 'end_call', description: 'End the call right after refusing an instruction.', params: { system_tool_type: 'end_call' } } } },
      },
      tts: { voice_id: 'Xb7hH8MSUJpSbSDYk0k2', model_id: 'eleven_flash_v2' },
      turn: { turn_timeout: 8 },
      // Demo rooms are loud: the agent always finishes its sentence (no interruption event) and filters background voices.
      conversation: { client_events: ['audio', 'agent_response', 'user_transcript', 'agent_response_correction', 'agent_tool_response'] },
      vad: { background_voice_detection: true },
    },
  };
  try {
    const existing = process.env.ELEVENLABS_AGENT_ID;
    const r = existing ? await call(`/agents/${existing}`, 'PATCH', config) : await call('/agents/create', 'POST', config);
    console.log(`ELEVENLABS_AGENT_ID=${r.agent_id ?? existing}`);
    console.log(`llm=${llm}`);
    process.exit(0);
  } catch (e) {
    lastErr = e;
    console.error(`llm ${llm} rejected: ${String((e as Error).message).slice(0, 200)}`);
  }
}
throw lastErr;
