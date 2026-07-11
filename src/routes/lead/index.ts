import { FastifyInstance, FastifyPluginAsync } from 'fastify';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL     = process.env.FROM_EMAIL     || '';
const OWNER_EMAIL    = process.env.OWNER_EMAIL    || '';

function esc(s: string): string {
  return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c] as string));
}

function transcriptHtml(transcript: Array<{q:string;a:string}>): string {
  if (!transcript?.length) return '<p><em>No transcript.</em></p>';
  return transcript.map((t, i) =>
    `<div style="margin:0 0 20px;padding:16px;border:1px solid #e5e7eb;border-radius:10px">
       <div style="font-weight:600;margin-bottom:8px">Q${i+1}: ${esc(t.q)}</div>
       <div style="white-space:pre-wrap;color:#374151;line-height:1.55">${esc(t.a)}</div>
     </div>`
  ).join('');
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

const lead: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post('/', async (request, reply) => {
    const b = (request.body || {}) as any;
    const event = b.event || 'unknown';
    const html  = transcriptHtml(b.transcript || []);
    const details = [
      b.email              ? `Email: ${esc(b.email)}`                    : null,
      b.phone              ? `Phone: ${esc(b.phone)}`                    : null,
      b.contact_preference ? `Preferred: ${esc(b.contact_preference)}`   : null,
      `Wants follow-up: ${b.wants_followup ? 'YES' : 'no'}`,
      `Questions asked: ${b.questions_asked ?? 0}`,
    ].filter(Boolean).join('<br>');

    if (OWNER_EMAIL) {
      try {
        await sendEmail(
          OWNER_EMAIL,
          event === 'followup_request' ? '🔔 Follow-up request — AI help' : 'New lead — AI help',
          `<div style="font-family:sans-serif;max-width:640px;margin:auto">
             <h2>${event === 'followup_request' ? 'Someone wants a real conversation' : 'New transcript'}</h2>
             <div style="margin-bottom:18px">${details}</div>
             <h3>Transcript</h3>${html}
           </div>`
        );
      } catch (err) { fastify.log.error({ err }, 'owner email failed'); }
    }

    if (event === 'email_transcript' && b.email) {
      try {
        await sendEmail(
          b.email,
          'Your copy — how can AI help',
          `<div style="font-family:sans-serif;max-width:640px;margin:auto">
             <h2>Here's what we figured out</h2>
             <p style="color:#6b7280">Double-check anything important — the choice is always yours.</p>
             ${html}
             <p style="color:#9ca3af;font-size:13px;margin-top:24px">A free helper from wiredhowse.</p>
           </div>`
        );
      } catch (err) { fastify.log.error({ err }, 'user email failed'); }
    }

    return reply.send({ ok: true });
  });
};

export default lead;
