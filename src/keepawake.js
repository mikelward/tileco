// Keep awake (SPEC.md §11): Search+S, or the cup on tileco's bar, holds the
// display on with chrome.power until it's turned off. Chrome drops the
// request when the browser restarts, and storage.session empties then too,
// so the two agree and it's never left on across a login, as in tide.

export const KEEP_AWAKE_KEY = "keepAwake";

// What the bar's cup and the toolbar button say, in tide's and tilemo's words.
export function words(on) {
  return on ? "Keeping awake" : "Not keeping awake";
}

export async function isOn(storage) {
  return (await storage.session.get(KEEP_AWAKE_KEY))[KEEP_AWAKE_KEY] === true;
}

// Turn keep awake over, and say so on the toolbar button. `api` is chrome.
export async function toggle(api) {
  const on = !(await isOn(api.storage));
  if (on) api.power.requestKeepAwake("display");
  else api.power.releaseKeepAwake();
  await api.storage.session.set({ [KEEP_AWAKE_KEY]: on });
  await api.action?.setTitle({ title: `tileco · ${words(on)}` });
  return on;
}
