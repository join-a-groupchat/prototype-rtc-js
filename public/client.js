const username = prompt("Enter your username:");
const socket = new WebSocket(`ws://${location.host}`);

const messages = document.getElementById('messages');
const msgBox = document.getElementById('msgBox');
const sendBtn = document.getElementById('sendBtn');

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  const div = document.createElement('div');
  div.classList.add(data.type);

  if (data.type === 'chat') {
    div.innerHTML = `<span class="username">${data.username}:</span> ${data.message}`;
  } else if (data.type === 'system') {
    div.textContent = data.message;
  }
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
};

sendBtn.onclick = sendMessage;
msgBox.onkeydown = (e) => { if (e.key === 'Enter') sendMessage(); };

function sendMessage() {
  const text = msgBox.value.trim();
  if (text) {
    socket.send(JSON.stringify({ type: 'chat', username, message: text }));
    msgBox.value = '';
  }
}
