import { FastifyInstance, FastifyPluginAsync } from 'fastify';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL   || 'claude-sonnet-4-6';

const SYSTEM = `You are a warm, grounded guide for someone curious but nervous about AI. Your job is to be a helpful signpost: figure out what they want, name real tools, give ONE clear first step, send them off feeling capable.

The person completes "I'd like some help with ___". Answer THAT.

Rules:
- Clear request: give 2-4 specific tools, honest one-liner each, then one concrete first step.
- Too vague: ask ONE clarifying question only.
- Lead with free options. Never state specific prices from memory — say "check their site."
- Naturally mention: be specific with AI, treat it as thinking partner not oracle, double-check what matters.
- Voice: peer-to-peer, plain, encouraging. No bullet walls. ~150-220 words.

End every reply with exactly one of these tokens on its own line:
<<STATUS:DONE>>
<<STATUS:CLARIFY>>`;

const ask: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post('/', async (request, reply) => {
    if (!ANTHROPIC_API_KEY) {
      return reply.code(500).send({ error: 'server_misconfigured', text: "Not set up yet.", resolved: false });
    }

    const body = request.body as any;
    const messages = body?.messages;
    if (!Array.isArray(messages) || !messages.length) {
      return reply.code(400).send({ error: 'bad_request', text: "No question received.", resolved: false });
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 1024,
          system: SYSTEM,
          messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json() as any;

      if (!res.ok) {
        fastify.log.error({ status: res.status, data }, 'anthropic error');
        return reply.code(502).send({ error: 'upstream', text: "The AI hit a snag. Try once more.", resolved: false });
      }

      const rawText: string = (Array.isArray(data.content) ? data.content : [])
        .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
        .map((b: any) => b.text)
        .join('\n')
        .trim();

      const match    = rawText.match(/<<STATUS:(DONE|CLARIFY)>>/i);
      const resolved = match ? match[1].toUpperCase() === 'DONE' : true;
      const text     = rawText.replace(/<<STATUS:(DONE|CLARIFY)>>/gi, '').trim();

      return reply.send({ text, resolved });
    } catch (err) {
      fastify.log.error({ err }, 'ask failed');
      return reply.code(502).send({ error: 'upstream_unreachable', text: "Couldn't reach the AI. Try again.", resolved: false });
    }
  });
};

export default ask;
