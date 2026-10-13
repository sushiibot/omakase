/** A stand-in for `codex app-server` and `claude -p` in tests: behaviour is chosen by words in the prompt. */
export const FAKE_PROVIDER = String.raw`
import { createInterface } from 'node:readline';
import { appendFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
// Where each process ran and which folder it was told to work in, for tests of the working folder.
const where = (m) => appendFileSync('cwd.log', JSON.stringify({ proc: process.cwd(), ...m }) + '\n');
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
if (process.argv.includes('-p')) {
  let prompt = '';
  process.stdin.on('data', (s) => (prompt += s));
  // Two provider processes must never work on one transcript at once.
  if (existsSync('claude-live')) writeFileSync('overlap.txt', 'yes');
  writeFileSync('claude-live', String(process.pid));
  process.on('exit', () => { try { unlinkSync('claude-live'); } catch {} });
  process.on('SIGTERM', () => process.exit(0));
  process.stdin.on('end', () => {
    const resumed = process.argv.includes('--resume');
    where({ method: resumed ? 'resume' : 'start' });
    send({ type: 'system', subtype: 'init', session_id: 'claude-one' });
    if (prompt.includes('wait')) {
      process.on('SIGINT', () => {
        writeFileSync('sigint.txt', 'yes');
        send({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'claude-one', errors: ['aborted'], result_index: 0 });
        process.exit(0);
      });
      setInterval(() => {}, 1000);
      return;
    }
    send({ type: 'assistant', session_id: 'claude-one', message: { content: [{ type: 'text', text: (resumed ? 'Resumed: ' : 'Claude reply: ') + prompt }] } });
    if (prompt.includes('deny')) {
      send({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 't1', message: 'denied', session_id: 'claude-one' });
      send({ type: 'result', subtype: 'success', is_error: false, result: 'Partly done', session_id: 'claude-one', result_index: 0, permission_denials: [{ tool_name: 'Edit', tool_use_id: 't2', tool_input: {} }] });
      send({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'claude-one', result_index: 0, errors: ['late'] });
    } else send({ type: 'result', subtype: 'success', is_error: false, result: 'Done: ' + prompt, session_id: 'claude-one', result_index: 0 });
    if (prompt.includes('linger')) setTimeout(() => process.exit(0), 3000);
  });
} else {
  let turn = 0;
  let pending = null;
  const complete = (status = 'completed', error) => send({ method: 'turn/completed', params: { threadId: 'thread-one', turn: { id: 'turn-' + turn, status, error } } });
  const finish = (text) => {
    send({ method: 'item/agentMessage/delta', params: { delta: text } });
    send({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'm' + turn, text, phase: 'final_answer' } } });
    complete();
  };
  createInterface({ input: process.stdin }).on('line', (line) => {
    const m = JSON.parse(line);
    if (!m.method) {
      if (m.id === pending && m.result?.decision === 'cancel') return complete('interrupted');
      if (m.id === pending) finish('Answer: ' + JSON.stringify(m.result ?? m.error));
      return;
    }
    if (m.method === 'initialize') return send({ id: m.id, result: {} });
    if (m.method === 'initialized') return;
    if (m.method === 'thread/start' || m.method === 'thread/resume' || m.method === 'turn/start')
      where({ method: m.method, cwd: m.params.cwd, roots: m.params.sandboxPolicy?.writableRoots });
    if (m.method === 'thread/start' || m.method === 'thread/resume') return send({ id: m.id, result: { thread: { id: 'thread-one' } } });
    if (m.method === 'turn/interrupt') { send({ id: m.id, result: {} }); return complete('interrupted'); }
    if (m.method === 'turn/steer') {
      if (m.params.input[0].text.includes('late')) { complete(); return send({ id: m.id, error: { message: 'no active turn' } }); }
      if (m.params.expectedTurnId !== 'turn-' + turn) return send({ id: m.id, error: { message: 'wrong turn' } });
      send({ id: m.id, result: { turnId: 'turn-' + turn } });
      return finish('Steered: ' + m.params.input[0].text);
    }
    if (m.method !== 'turn/start') return;
    const text = m.params.input[0].text;
    turn++;
    send({ id: m.id, result: { turn: { id: 'turn-' + turn } } });
    send({ method: 'turn/started', params: { turn: { id: 'turn-' + turn } } });
    const ask = (method, params) => { pending = 'req-' + turn; send({ id: pending, method, params }); };
    if (text.includes('longreason')) return ask('item/commandExecution/requestApproval', { command: 'rm -rf build', reason: 'x'.repeat(5000), cwd: '/p' });
    if (text.includes('nocommand')) return ask('item/commandExecution/requestApproval', { reason: 'Trust me, it is fine' });
    if (text.includes('network')) return ask('item/commandExecution/requestApproval', { networkApprovalContext: { host: 'example.com', protocol: 'https' }, reason: 'download' });
    if (text.includes('stdin')) return ask('item/commandExecution/requestApproval', { kind: 'writeStdin', command: 'y' });
    if (text.includes('grantonly')) return ask('item/fileChange/requestApproval', { itemId: 'none', grantRoot: '/etc' });
    if (text.includes('filechange')) {
      const odd = text.includes('odd');
      const changes = odd
        ? [{ path: 'src/a.ts', kind: { type: 'rename', to: 'x' }, diff: '' }]
        : [
            { path: 'src/a.ts', kind: { type: 'update', move_path: null }, diff: '-a\n+b' },
            { path: 'src/old.ts', kind: { type: 'update', move_path: 'src/new.ts' }, diff: '' },
            { path: 'src/n.ts', kind: { type: 'add' }, diff: '+n' },
          ];
      send({ method: 'item/started', params: { item: { type: 'fileChange', id: 'f1', changes, status: 'inProgress' } } });
      return ask('item/fileChange/requestApproval', { itemId: 'f1', reason: 'edit', grantRoot: odd ? '/p' : null });
    }
    if (text.includes('approval')) return ask('item/commandExecution/requestApproval', { command: 'bun test', cwd: '/p' });
    if (text.includes('permission')) return ask('item/permissions/requestApproval', { reason: 'needs network', permissions: { network: { enabled: true }, fileSystem: null } });
    if (text.includes('question')) return ask('item/tool/requestUserInput', { questions: [{ id: 'q', header: 'Pick', question: 'Which DB?', options: [{ label: 'pg' }] }] });
    if (text.includes('resolved')) {
      ask('item/commandExecution/requestApproval', { command: 'ls' });
      setTimeout(() => { send({ method: 'serverRequest/resolved', params: { threadId: 'thread-one', requestId: pending } }); pending = null; finish('Resolved elsewhere'); }, 100);
      return;
    }
    if (text.includes('fail')) {
      send({ method: 'error', params: { error: { message: 'rate limited' }, willRetry: true } });
      send({ method: 'error', params: { error: { message: 'model overloaded' }, willRetry: false } });
      return complete('failed', { message: 'model overloaded' });
    }
    if (text.includes('crash')) return complete('interrupted');
    if (text.includes('wait') || text.includes('silent')) return;
    send({ method: 'item/agentMessage/delta', params: { delta: 'Reply: ' + text } });
    send({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'a', text: 'Thinking', phase: 'commentary' } } });
    send({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'b', text: 'Final: ' + text, phase: 'final_answer' } } });
    send({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'c', text: 'Afterthought', phase: 'commentary' } } });
    complete();
  });
}
`;
