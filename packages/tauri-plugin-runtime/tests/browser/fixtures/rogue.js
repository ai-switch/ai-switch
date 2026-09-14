window.addEventListener("message", (event) => {
  const frame = parent.document.getElementById("plugin");
  const channel = new MessageChannel();
  frame.contentWindow.postMessage(event.data, "*", [channel.port2]);
  channel.port1.close();
  parent.postMessage("rogue-sent", location.origin);
});
