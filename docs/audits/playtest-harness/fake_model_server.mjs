// fake_model_server.mjs — a tiny OpenAI-compatible STREAMING echo server, for STUB-MODE validation
// of the mirror harness WITHOUT a live key. It exercises the real FE /api/chat_stream → stream_llm
// path (so the SSE token timeline + filmstrip capture rails get real deltas to record), but its
// output is DETERMINISTIC echo text — never real narration. This is a validation aid only; the
// real mirror audit runs against the live model (ORWELL_TEST_OPENROUTER_KEY).
//
// Endpoints:
//   GET  /v1/models                 → one model id (so the FE endpoint probe succeeds)
//   POST /v1/chat/completions        → streams a fixed reply as OpenAI SSE chunks (delta.content),
//                                       a reasoning preamble (delta.reasoning), a usage chunk, and a
//                                       terminal finish_reason — covering every trace/stream channel.
//
//   node docs/audits/playtest-harness/fake_model_server.mjs            # listens on :8011
//   FAKE_MODEL_PORT=8011 FAKE_FINISH=length node ...fake_model_server.mjs   # force a truncation finish
import { createServer } from 'http';

const PORT = parseInt(process.env.FAKE_MODEL_PORT || '8011', 10);
const MODEL = process.env.FAKE_MODEL_ID || 'fake/echo-stream';
const FINISH = process.env.FAKE_FINISH || 'stop'; // 'stop' | 'length' | 'tool_calls'

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    return send(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'fake' }] });
  }
  if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let stream = false; let lastUser = '';
      try { const j = JSON.parse(body); stream = !!j.stream; const msgs = j.messages || []; for (const m of msgs) if (m.role === 'user') lastUser = typeof m.content === 'string' ? m.content : JSON.stringify(m.content); } catch (_) {}
      // A deterministic reply DERIVED from the prompt so both windows on the same game get identical
      // text (the mirror invariant) but different turns get different text.
      const seed = (lastUser || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const reasoning = `Considering the room and who is present. (echo of: ${seed})`;
      const reply = `The house settles for a moment. [stub-echo] ${seed}`;
      if (!stream) {
        return send(res, 200, { id: 'fake', object: 'chat.completion', model: MODEL, choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 16, total_tokens: 56 } });
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const chunk = (delta, extra = {}) => res.write(`data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`);
      // reasoning preamble (channel: delta.reasoning)
      for (const w of reasoning.split(' ')) chunk({ reasoning: w + ' ' });
      // reply body (channel: delta.content)
      for (const w of reply.split(' ')) chunk({ content: w + ' ' });
      // usage chunk
      res.write(`data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', model: MODEL, choices: [], usage: { prompt_tokens: 40, completion_tokens: 16, total_tokens: 56 } })}\n\n`);
      // terminal finish_reason (the trace/stream signal the harness audits for completeness)
      res.write(`data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: FINISH }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
    return;
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`fake model server on http://127.0.0.1:${PORT} (model ${MODEL}, finish=${FINISH})`));
