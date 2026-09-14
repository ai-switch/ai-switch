let messages = 0;
window.addEventListener("message", () => { document.getElementById("messages").textContent = String(++messages); });
