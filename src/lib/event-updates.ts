// This is only an invalidation hint. Every subscriber reads authorized server data.
const channelName = "fe-event-updates";
export function announceEventChange() {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage("changed");
    channel.close();
  } catch {
    /* Background refresh still handles browsers denying this capability. */
  }
}
export function watchEventChanges(refresh: () => void) {
  if (typeof BroadcastChannel === "undefined") return () => {};
  try {
    const channel = new BroadcastChannel(channelName);
    channel.onmessage = (event) => {
      if (event.data === "changed") refresh();
    };
    return () => channel.close();
  } catch {
    return () => {};
  }
}
