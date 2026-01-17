const username = prompt("Enter your username:");
const socket = new WebSocket(`ws://${location.host}`);
<<<<<<< HEAD
=======
socket.binaryType = "text";
>>>>>>> df1bb8650cdbf1b2ac6980f1532d9e271aa93a77

const messages = document.getElementById("messages");
const msgBox = document.getElementById("msgBox");
const sendBtn = document.getElementById("sendBtn");

msgBox.focus();

socket.onmessage = async event => {
  let text;

  if (event.data instanceof Blob) {
    text = await event.data.text();
  } else {
    text = event.data;
  }

  const data = JSON.parse(text);

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
