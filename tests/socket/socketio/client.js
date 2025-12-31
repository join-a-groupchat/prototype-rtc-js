const username = prompt("Enter your username:");
const socket = io({
  transports: ["polling"]
});

const messages = document.getElementById("messages");
const msgBox = document.getElementById("msgBox");
const sendBtn = document.getElementById("sendBtn");

socket.on("chat", data => {
  const div = document.createElement("div");
  div.className = "chat";
  div.innerHTML = `<span class="username">${data.username}:</span> ${data.message}`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
});

function sendMessage() {
  const text = msgBox.value.trim();
  if (!text) return;

  socket.emit("chat", {
    username,
    message: text
  });

  msgBox.value = "";
}

sendBtn.onclick = sendMessage;
msgBox.onkeydown = e => e.key === "Enter" && sendMessage();
