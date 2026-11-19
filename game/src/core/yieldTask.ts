// Yield to the event loop with a message instead of a timer: hidden windows throttle timers to
// about one per second, but messages still run immediately. Pending promise callbacks (cutscene
// scripts) get to run before the next frame.

const channel = new MessageChannel();
const waiting: (() => void)[] = [];
channel.port1.onmessage = () => waiting.shift()?.();

export function yieldTask() {
  return new Promise<void>((resolve) => {
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });
}
