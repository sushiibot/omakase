import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
export class JsonProcess {
  readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private calls = new Map<
    number,
    {
      resolve(v: any): void;
      reject(e: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    command: string[],
    cwd: string,
    private event: (message: any) => void,
    private ended: (error?: string) => void,
  ) {
    this.child = spawn(command[0]!, command.slice(1), {
      cwd,
      stdio: "pipe",
      windowsHide: true,
    });
    // Never forward stderr: providers may print credentials or local environment details there.
    this.child.stderr.resume();
    let finished = false;
    const finish = (error?: string) => {
      if (finished) return;
      finished = true;
      for (const call of this.calls.values()) {
        clearTimeout(call.timer);
        call.reject(new Error(error ?? "Provider process closed."));
      }
      this.calls.clear();
      this.ended(error);
    };
    this.child.on("error", () =>
      finish("Could not start the configured provider executable."),
    );
    this.child.on("close", (code) =>
      finish(code ? `Provider exited with code ${code}.` : undefined),
    );
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      if (line.length > 2000000) {
        this.kill();
        finish("Provider output exceeded the line limit.");
        return;
      }
      try {
        const msg = JSON.parse(line);
        const call =
          msg.method === undefined && typeof msg.id === "number"
            ? this.calls.get(msg.id)
            : undefined;
        if (call) {
          this.calls.delete(msg.id);
          clearTimeout(call.timer);
          if (msg.error)
            call.reject(
              new Error(
                String(msg.error.message ?? "Provider request failed.").slice(
                  0,
                  1000,
                ),
              ),
            );
          else call.resolve(msg.result);
        } else this.event(msg);
      } catch {
        /* A provider may emit a non-JSON startup line. */
      }
    });
  }
  send(message: unknown) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(`Provider ${method} timed out.`));
      }, 30000);
      this.calls.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  get exited() {
    return this.child.exitCode !== null || this.child.signalCode !== null;
  }
  kill() {
    if (this.exited) return;
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 5000);
    timer.unref();
    this.child.once("close", () => clearTimeout(timer));
  }
  /** SIGINT lets Claude Code end its turn cleanly; SIGTERM leaves the turn unfinished. */
  interrupt(graceMs = 5000) {
    if (this.exited) return;
    this.child.kill("SIGINT");
    const timer = setTimeout(() => this.kill(), graceMs);
    timer.unref();
    this.child.once("close", () => clearTimeout(timer));
  }
}
