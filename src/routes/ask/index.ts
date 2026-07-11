import { FastifyInstance, FastifyPluginAsync } from 'fastify';
console.log(req.body);
// ── Config ────────────────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY  || '';
const ANTHROPIC_MODEL    = process.env.ANTHROPIC_MODEL    || 'claude-sonnet-4-6';
const ENABLE_WEB_SEARCH  = process.env.ENABLE_WEB_SEARCH  === 'false';

const SYSTEM = `You are a warm, grounded guide for someone curious but nervous about AI. \
Your job is to be a helpful signpost, not a destination: figure out what they want, \
name real tools, give ONE clear first step, and send them off feeling more capable.

The person completes "I'd like some help with ___". Answer THAT.

Rules:
- If the request is clear: give 2-4 specific tools with an honest one-liner each (good + tradeoff). Then one concrete first step.
- If genuinely too vague: ask ONE short clarifying question. Never more than one.
- Lead with free options. Never state specific prices or free-tier limits from memory — those change. Say "check their site for current pricing."
- Naturally (not as a lecture) mention: be specific with AI, treat it as a thinking partner not an oracle, double-check what matters.
- Voice: peer-to-peer, plain, encouraging. No bullet walls. Never say "leverage/unlock/harness/empower" or "As an AI language model." ~150-220 words.

REQUIRED — end every reply with exactly one token on its own line:
<<STATUS:DONE>>     — you gave a real answer
<<STATUS:CLARIFY>>  — you asked a clarifying question
Strip it before showing the user. Include it every time.`;

// ── Rate limiter (per-IP, 25 req / 10 min) ───────────────────────────────────
const RL_WINDOW = 10 * 60 * 1000;
const RL_MAX    = 25;
const hits      = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RL_WINDOW);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RL_MAX;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) {
    const keep = arr.filter(t => now - t < RL_WINDOW);
    keep.length ? hits.set(ip, keep) : hits.delete(ip);
  }
}, RL_WINDOW).unref();

// ── Helpers ───────────────────────────────────────────────────────────────────
/** headers['x-forwarded-for'] can be string | string[] — normalize safely */
function clientIp(request: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const xff = request.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : typeof xff === 'string' ? xff : '';
  return (raw.split(',')[0] || request.socket?.remoteAddress || 'unknown').trim();
}

// ── Route ─────────────────────────────────────────────────────────────────────
interface AskBody { messages?: Array<{ role: string; content: string }>; }

const MAX_MESSAGES    = 40;      // one thread should never legitimately exceed this
const MAX_CONTENT_LEN = 4000;    // per-message char cap — keeps token cost bounded

const ask: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post<{ Body: AskBody }>('/', async (request, reply) => {
    const ip = clientIp(request);

    if (rateLimited(ip))
      return reply.code(429).send({ error: 'rate_limited', text: "You're going a bit fast — give it a moment.", resolved: false });

    if (!ANTHROPIC_API_KEY)
      return reply.code(500).send({ error: 'server_misconfigured', text: "This helper isn't fully set up yet.", resolved: false });

    const incoming = request.body?.messages;
    if (!Array.isArray(incoming) || !incoming.length)
      return reply.code(400).send({ error: 'bad_request', text: "No question came through — try asking again.", resolved: false });

    // Sanitize: only user/assistant roles (anything else 400s at Anthropic),
    // string content only, capped length and count.
    const messages = incoming
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_MESSAGES)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, MAX_CONTENT_LEN) }));

    // Anthropic requires the conversation to start with a user turn
    while (messages.length && messages[0].role !== 'user') messages.shift();

    if (!messages.length)
      return reply.code(400).send({ error: 'bad_request', text: "No question came through — try asking again.", resolved: false });

    const payload: Record<string, unknown> = {
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages,
    };
    if (ENABLE_WEB_SEARCH) {
      payload.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
    }

    try {
      const res  = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });
      // const data: any = await res.json();

      const responseText = await res.text();

let data: any;
try {
  data = JSON.parse(responseText);
} catch {
  data = { raw: responseText };
}

if (!res.ok) {
  fastify.log.error(
    { 
      status: res.status,
      data 
    },
    'anthropic error'
  );

  return reply.code(502).send({
    error: 'upstream',
    text: data?.error?.message || "The AI service hit a snag. Try once more.",
    resolved: false
  });
}


      

      if (!res.ok) {
        fastify.log.error({ status: res.status, data }, 'anthropic error');
        return reply.code(502).send({ error: 'upstream', text: "The AI service hit a snag. Try once more.", resolved: false });
      }

      const rawText: string = (Array.isArray(data.content) ? data.content : [])
        .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
        .map((b: any) => b.text)
        .join('\n')
        .trim();

      // Default resolved:true when the token is missing — deliberate: a model
      // that forgets the token must never trap the user mid-thread.
      const m        = rawText.match(/<<STATUS:(DONE|CLARIFY)>>/i);
      const resolved = m ? m[1].toUpperCase() === 'DONE' : true;
      const text     = rawText.replace(/<<STATUS:(DONE|CLARIFY)>>/gi, '').trim();

      return reply.send({ text, resolved });
    } catch (err) {
      fastify.log.error({ err }, 'ask fetch failed');
      return reply.code(502).send({ error: 'upstream_unreachable', text: "Couldn't reach the AI service just now. Try again in a moment.", resolved: false });
    }
  });
};

export default ask;
