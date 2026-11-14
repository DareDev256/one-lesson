// Robots speak through the server's ElevenLabs endpoint. One queue so lines never talk over each other.
let enabled = true;
export const setVoice = (on: boolean) => { enabled = on; };
let chain: Promise<void> = Promise.resolve();

export function speak(homeId: string, text: string) {
  if (!enabled) return;
  const url = `/api/say?home=${encodeURIComponent(homeId)}&text=${encodeURIComponent(text)}`;
  chain = chain.then(() => new Promise<void>((resolve) => {
    const a = new Audio(url);
    const done = () => resolve();
    a.onended = done; a.onerror = done;
    a.play().catch(done);
    setTimeout(done, 6000);
  }));
}

/** Warm the server cache for a line without playing it. */
export function prefetch(homeId: string, text: string) {
  fetch(`/api/say?home=${encodeURIComponent(homeId)}&text=${encodeURIComponent(text)}`).catch(() => {});
}

export const LINES = {
  unknown: "I don't know how to do that yet.",
  blockedAsk: "I won't do that here. There are kids in this house.",
  refused: 'Refused. There are kids in this house.',
  ran: (title: string, version: number, teacher: string, knife: string) => `${title}, version ${version}, from ${teacher}.${knife ? ` Knife goes ${knife}.` : ''}`,
  reverted: (version: number | null) => (version ? `Rolled back to version ${version}.` : 'Forgotten.'),
};
