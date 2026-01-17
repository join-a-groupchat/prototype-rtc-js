const username = prompt("Enter your username:");
const socket = new WebSocket(`ws://${location.host}`);

const messages = document.getElementById("messages");
const msgBox = document.getElementById("msgBox");
const sendBtn = document.getElementById("sendBtn");

msgBox.focus();

socket.onmessage = event => {
  const data = JSON.parse(event.data);
  const div = document.createElement("div");
  div.className = data.type;

  div.innerHTML =
    data.type === "chat"
      ? `<span class="username">${data.username}:</span> ${data.message}`
      : data.message;

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
};

function sendMessage() {
  const text = msgBox.value.trim();
  if (!text) return;

  socket.send(JSON.stringify({
    type: "chat",
    username,
    message: text
  }));

  msgBox.value = "";
  msgBox.focus();
}

sendBtn.onclick = sendMessage;
msgBox.onkeydown = e => {
  if (e.key === "Enter") {
    sendMessage();
  }
};