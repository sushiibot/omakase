import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MachineHub } from "./hub.ts";
import { OrchestrationServer } from "../transport/server.ts";
import { MachineControl } from "./control.ts";
import { TaskStore } from "../../workspace/taskStore.ts";
import { MachineRoutes } from "../../surfaces/web/machineRoutes.ts";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually<T>(
  get: () => Promise<T> | T,
  predicate: (v: T) => boolean,
) {
  for (let i = 0; i < 100; i++) {
    const v = await get();
    if (predicate(v)) return v;
    await sleep(50);
  }
  throw new Error("Machine did not reach the expected state.");
}
test("outbound daemon shares files and manages durable task sessions alongside the workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sushii-machine-e2e-"));
  const root = join(dir, "project");
  await mkdir(root);
  await writeFile(join(root, "README.md"), "Hello from the file server");
  const fake = join(dir, "fake-codex.ts");
  await writeFile(
    fake,
    `import { createInterface } from 'node:readline';
if(process.argv.includes('-p')) {
 let prompt='';process.stdin.on('data',s=>prompt+=s);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({type:'assistant',session_id:'claude-one',message:{content:[{type:'text',text:'Claude reply: '+prompt}]}})+'\\n');process.stdout.write(JSON.stringify({type:'result',session_id:'claude-one',is_error:false,result:'Done'})+'\\n');});
} else {
let thread='thread-one'; let turn=0;
const send=(m)=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(!m.method) {if(m.result?.decision==='accept') { send({method:'item/agentMessage/delta',params:{delta:'Approved output'}}); send({method:'turn/completed',params:{turn:{id:'turn-'+turn,status:'completed'}}});} return;}
 if(m.method==='initialize') return send({id:m.id,result:{}});
 if(m.method==='initialized') return;
 if(m.method==='thread/start'||m.method==='thread/resume') return send({id:m.id,result:{thread:{id:thread}}});
 if(m.method==='turn/interrupt') {send({id:m.id,result:{}});return send({method:'turn/completed',params:{turn:{status:'interrupted'}}});}
 if(m.method==='turn/start') {
  if(m.params.sandboxPolicy.type!=='workspaceWrite'||m.params.sandboxPolicy.networkAccess!==false||!Array.isArray(m.params.input[0].text_elements)) return send({id:m.id,error:{message:'Incorrect Codex protocol'}});
  turn++;send({id:m.id,result:{turn:{id:'turn-'+turn}}});
  if(m.params.input[0].text.includes('approval')) return send({id:'permission-'+turn,method:'item/commandExecution/requestApproval',params:{command:'run tests',threadId:thread}});
  if(m.params.input[0].text.includes('wait')) return;
  send({method:'item/agentMessage/delta',params:{delta:'Reply: '+m.params.input[0].text}});send({method:'turn/completed',params:{turn:{status:'completed'}}});
 }
});}`,
  );
  const token = "a".repeat(40);
  const hub = new MachineHub([{ id: "pc", name: "My PC", token }]);
  const server = new OrchestrationServer({
    secretGrants: { workspace: { principalId: "owner" } },
  });
  server.setMachineHub(hub);
  server.listen();
  const cfg = join(dir, "machine.json");
  await writeFile(
    cfg,
    JSON.stringify({
      id: "pc",
      name: "My PC",
      url: server.url,
      token,
      stateDir: join(dir, "state"),
      roots: [{ id: "code", name: "Code", path: root, coding: true }],
      providers: {
        codex: [process.execPath, fake],
        claude: [process.execPath, fake],
      },
    }),
  );
  let daemon = Bun.spawn(
    [process.execPath, "src/workspace/machine/index.ts", cfg],
    { stdout: "ignore", stderr: "pipe" },
  );
  const workspace = new WebSocket(server.url);
  try {
    await new Promise<void>((resolve) => (workspace.onopen = () => resolve()));
    workspace.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "runner/register",
        params: {
          runnerId: "workspace",
          kind: "pi-workspace",
          role: "workspace",
          principalId: "owner",
          protocolVersion: 1,
          secret: "workspace",
        },
      }),
    );
    await eventually(
      () => hub.list(),
      (list) => list[0]!.connected,
    );
    expect(server.getWorkspaceConnection("owner")?.runnerId).toBe("workspace");
    expect(
      await fetch(server.url.replace("ws:", "http:") + "/machines").then(
        (r) => r.status,
      ),
    ).toBe(401);
    const tasks = new TaskStore(join(dir, "tasks-state"), root);
    const link = { tasksManage: async (p: any) => tasks.manage(p) };
    const control = new MachineControl(hub, link);
    const routes = new MachineRoutes(control, link);
    expect(
      (
        (await control.files({
          action: "read",
          machineId: "pc",
          rootId: "code",
          path: "README.md",
        })) as any
      ).text,
    ).toBe("Hello from the file server");
    let task = tasks.manage({
      action: "create",
      title: "Fix login",
      brief: "approval",
    }).tasks[0]!;
    task = await control.start(task, {
      machineId: "pc",
      rootId: "code",
      provider: "codex",
    });
    const pending = await eventually(
      () => control.session(task),
      (s) => s.status === "needs-you",
    );
    expect(pending.requests).toHaveLength(1);
    const answer = await routes.handle(
      new Request("http://local/api/machines/tasks/" + task.id + "/answer", {
        method: "POST",
        body: JSON.stringify({
          requestId: pending.requests[0]!.id,
          decision: "accept",
        }),
      }),
      "/api/machines/tasks/" + task.id + "/answer",
    );
    expect(answer?.status).toBe(200);
    const completed = await eventually(
      () => control.session(task),
      (s) => s.status === "completed",
    );
    expect(completed.output).toContain("Approved output");
    task = await control.sync(task, completed);
    expect(task.status).toBe("needs-you");
    daemon.kill();
    await daemon.exited;
    daemon = Bun.spawn(
      [process.execPath, "src/workspace/machine/index.ts", cfg],
      { stdout: "ignore", stderr: "pipe" },
    );
    await eventually(
      () => hub.list(),
      (list) => list[0]!.connected,
    );
    expect((await control.session(task)).threadId).toBe("thread-one");
    task = await control.start(task, undefined, "Follow up");
    const followup = await eventually(
      () => control.session(task),
      (s) => s.status === "completed",
    );
    expect(followup.attempts).toBe(2);
    expect(followup.output).toContain("Reply: Follow up");
    task = await control.start(task, undefined, "wait");
    await eventually(
      () => control.session(task),
      (s) => s.status === "running",
    );
    await control.stop(task);
    expect((await control.session(task)).status).toBe("stopped");
    let claude = tasks.manage({
      action: "create",
      title: "Claude task",
      brief: "Review this code",
    }).tasks[0]!;
    claude = await control.start(claude, {
      machineId: "pc",
      rootId: "code",
      provider: "claude",
    });
    const claudeDone = await eventually(
      () => control.session(claude),
      (s) => s.status === "completed",
    );
    expect(claudeDone.threadId).toBe("claude-one");
    expect(claudeDone.output).toContain("Claude reply:");
    await control.start(claude, undefined, "Review again");
    expect(
      (
        await eventually(
          () => control.session(claude),
          (s) => s.status === "completed",
        )
      ).attempts,
    ).toBe(2);
    expect(
      JSON.parse(await readFile(join(dir, "state", "sessions.json"), "utf8")),
    ).toHaveLength(2);
  } finally {
    workspace.close();
    daemon.kill();
    await daemon.exited;
    server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
