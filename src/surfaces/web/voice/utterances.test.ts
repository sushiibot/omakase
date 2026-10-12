import { expect, test } from "bun:test";
import { Utterances } from "./utterances.ts";

test("starts completed phrases before the reply finishes, preserves order and never repeats the final reply", async () => {
  const spoken: string[] = [];
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stream = new Utterances(async (text) => {
    spoken.push(text);
    if (spoken.length === 1) await hold;
  }, new AbortController().signal);
  stream.push("I'll check");
  await Bun.sleep(0);
  expect(spoken).toEqual([]);
  stream.push(" that. ");
  await Bun.sleep(0);
  expect(spoken).toEqual(["I'll check that."]);
  stream.push("", true);
  stream.push("Your calendar is ");
  stream.push("clear.");
  stream.push("", true);
  const finished = stream.finish("Your calendar is clear.");
  expect(spoken).toHaveLength(1);
  release();
  await finished;
  expect(spoken).toEqual(["I'll check that.", "Your calendar is clear."]);
});

test("legacy agents still speak, silence markers do not, and cancellation drops queued speech", async () => {
  const spoken: string[] = [];
  const abort = new AbortController();
  const stream = new Utterances(async (text) => {
    spoken.push(text);
    abort.abort();
  }, abort.signal);
  stream.push("One sentence. Another sentence. ");
  await expect(
    stream.finish("One sentence. Another sentence."),
  ).rejects.toThrow();
  expect(spoken).toEqual(["One sentence."]);
  const fallback = new Utterances(async (text) => {
    spoken.push(text);
  }, new AbortController().signal);
  await fallback.finish("Legacy reply.");
  expect(spoken.at(-1)).toBe("Legacy reply.");
  const quiet = new Utterances(async () => {
    throw new Error("must not speak");
  }, new AbortController().signal);
  quiet.push("NO_REPLY", true);
  await quiet.finish("NO_REPLY");
});

test("speech errors are captured while generation continues and propagate on completion", async () => {
  const stream = new Utterances(async () => {
    throw new Error("quota");
  }, new AbortController().signal);
  stream.push("A sentence. ");
  await Bun.sleep(0);
  await expect(stream.finish("A sentence.")).rejects.toThrow("quota");
});

test("final delivery completes a missing stream tail without repeating the spoken prefix", async () => {
  const spoken: string[] = [];
  const stream = new Utterances(async (text) => {
    spoken.push(text);
  }, new AbortController().signal);
  stream.push("First sentence. The second");
  await Bun.sleep(0);
  expect(spoken).toEqual(["First sentence."]);
  await stream.finish("First sentence. The second sentence.");
  expect(spoken).toEqual(["First sentence.", "The second sentence."]);
});
