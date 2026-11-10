const conversations = [
  {
    id: "weekend",
    name: "Weekend plans",
    initials: "W",
    color: "#f4d2b7",
    textColor: "#79513d",
    members: "4 members · 2 online",
    preview: "No messages yet",
    time: "",
    unread: 0,
    online: true,
    messages: []
  },
  {
    id: "design",
    name: "Design team",
    initials: "D",
    color: "#d8d1fa",
    textColor: "#574b91",
    members: "6 members · 1 online",
    preview: "No messages yet",
    time: "",
    unread: 0,
    messages: []
  },
  {
    id: "family",
    name: "The Sunday crew",
    initials: "S",
    color: "#c7e7d7",
    textColor: "#366a52",
    members: "5 members",
    preview: "No messages yet",
    time: "",
    unread: 0,
    messages: []
  },
  {
    id: "hikes",
    name: "Saturday hikers",
    initials: "H",
    color: "#d6e5c4",
    textColor: "#536c3d",
    members: "8 members",
    preview: "No messages yet",
    time: "",
    unread: 0,
    messages: []
  }
];

const app = document.querySelector(".chat-app");
const conversationList = document.querySelector("#conversation-list");
const conversationSearch = document.querySelector("#conversation-search");
const inboxCount = document.querySelector("#inbox-count");
const chatAvatar = document.querySelector("#chat-avatar");
const chatTitle = document.querySelector("#chat-title");
const chatSubtitle = document.querySelector("#chat-subtitle");
const messageArea = document.querySelector("#message-area");
const messageList = document.querySelector("#message-list");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const backButton = document.querySelector("#back-button");
const authStatus = document.querySelector("#auth-status");
const profileAvatar = document.querySelector("#profile-avatar");

let activeConversationId = conversations[0].id;
let currentUser = null;
let messageRequestId = 0;

const senderColors = [
  ["#e9c4d2", "#754c5d"],
  ["#c5d9ec", "#425f7b"],
  ["#d8d0f0", "#5b507d"],
  ["#f0d7b6", "#7a5a32"],
  ["#c7e7d7", "#366a52"]
];

function getSenderColors(sender) {
  const colorIndex = [...sender].reduce((total, character) => total + character.charCodeAt(0), 0) % senderColors.length;
  return senderColors[colorIndex];
}

function formatMessageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

async function verifySession() {
  const token = sessionStorage.getItem("authToken");
  if (!token) {
    window.location.replace("auth/login.html");
    return false;
  }

  try {
    const response = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.status === 401) {
      sessionStorage.removeItem("authToken");
      window.location.replace("auth/login.html");
      return false;
    }

    if (!response.ok) {
      throw new Error("The server could not verify your session.");
    }

    const result = await response.json();
    currentUser = result.user;
    profileAvatar.textContent = currentUser.name.slice(0, 1).toUpperCase();
    document.body.classList.add("authenticated");
    return true;
  } catch (error) {
    authStatus.textContent = "Could not verify your session. Check your connection and reload to try again.";
    console.error("Session verification failed:", error);
    return false;
  }
}

function getActiveConversation() {
  return conversations.find((conversation) => conversation.id === activeConversationId);
}

function makeAvatar(initials, background, color, className) {
  const avatar = document.createElement("span");
  avatar.className = className;
  avatar.textContent = initials;
  avatar.style.backgroundColor = background;
  avatar.style.color = color;
  return avatar;
}

function renderConversations() {
  const query = conversationSearch.value.trim().toLowerCase();
  const filtered = conversations.filter((conversation) =>
    conversation.name.toLowerCase().includes(query)
  );
  conversationList.replaceChildren();
  inboxCount.textContent = `${conversations.length} conversations`;

  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-search";
    empty.textContent = "No conversations found.";
    conversationList.append(empty);
    return;
  }

  filtered.forEach((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `conversation-item${conversation.id === activeConversationId ? " active" : ""}`;
    button.dataset.conversationId = conversation.id;
    button.setAttribute("aria-current", conversation.id === activeConversationId ? "true" : "false");

    const avatar = makeAvatar(conversation.initials, conversation.color, conversation.textColor, "conversation-avatar");
    if (conversation.online) {
      const status = document.createElement("span");
      status.className = "status-dot";
      status.setAttribute("aria-label", "Online");
      avatar.append(status);
    }

    const copy = document.createElement("span");
    copy.className = "conversation-copy";
    const topLine = document.createElement("span");
    topLine.className = "conversation-topline";
    const name = document.createElement("span");
    name.className = "conversation-name";
    name.textContent = conversation.name;
    const time = document.createElement("time");
    time.className = "conversation-time";
    time.textContent = conversation.time;
    topLine.append(name, time);

    const bottomLine = document.createElement("span");
    bottomLine.className = "conversation-bottomline";
    const preview = document.createElement("span");
    preview.className = "conversation-preview";
    preview.textContent = conversation.preview;
    bottomLine.append(preview);
    if (conversation.unread > 0) {
      const unread = document.createElement("span");
      unread.className = "unread-count";
      unread.textContent = conversation.unread;
      unread.setAttribute("aria-label", `${conversation.unread} unread messages`);
      bottomLine.append(unread);
    }
    copy.append(topLine, bottomLine);
    button.append(avatar, copy);
    conversationList.append(button);
  });
}

function createMessage(message) {
  const row = document.createElement("article");
  const outgoing = message.userId === currentUser.id;
  row.className = `message-row${outgoing ? " outgoing" : ""}`;

  const content = document.createElement("div");
  content.className = "message-content";
  if (!outgoing) {
    const name = document.createElement("span");
    name.className = "message-name";
    name.textContent = message.sender;
    content.append(name);
  }

  const bubble = document.createElement("p");
  bubble.className = "message-bubble";
  bubble.textContent = message.text;
  const time = document.createElement("time");
  time.className = "message-time";
  time.dateTime = new Date(message.createdAt).toISOString();
  time.textContent = formatMessageTime(message.createdAt);
  if (outgoing) {
    const readMark = document.createElement("span");
    readMark.className = "read-mark";
    readMark.setAttribute("aria-label", "Sent");
    readMark.textContent = "✓✓";
    time.append(readMark);
  }
  content.append(bubble, time);

  if (outgoing) {
    row.append(content);
  } else {
    const [background, color] = getSenderColors(message.sender);
    row.append(makeAvatar(message.sender.slice(0, 1).toUpperCase(), background, color, "message-sender-avatar"), content);
  }
  return row;
}

function renderMessages() {
  const conversation = getActiveConversation();
  chatAvatar.textContent = conversation.initials;
  chatAvatar.style.backgroundColor = conversation.color;
  chatAvatar.style.color = conversation.textColor;
  chatTitle.textContent = conversation.name;
  chatSubtitle.textContent = conversation.members;
  messageList.replaceChildren();

  if (conversation.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "day-divider";
    empty.textContent = "START A CONVERSATION";
    messageList.append(empty);
  } else {
    const divider = document.createElement("div");
    divider.className = "day-divider";
    divider.textContent = "MESSAGES";
    messageList.append(divider, ...conversation.messages.map(createMessage));
  }
  messageArea.style.scrollBehavior = "auto";
  messageArea.scrollTop = messageArea.scrollHeight;
  messageArea.style.scrollBehavior = "";
}

function showChatNotice(message, className = "chat-notice", replace = true) {
  const notice = document.createElement("p");
  notice.className = className;
  notice.textContent = message;
  if (replace) messageList.replaceChildren(notice);
  else messageList.append(notice);
}

async function loadMessages(conversation) {
  const requestId = ++messageRequestId;
  showChatNotice("Loading messages...");
  try {
    const response = await fetch(`/api/messages?conversationId=${encodeURIComponent(conversation.id)}`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem("authToken")}` }
    });
    if (response.status === 401) {
      sessionStorage.removeItem("authToken");
      window.location.replace("auth/login.html");
      return;
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load messages.");
    if (requestId !== messageRequestId) return;

    conversation.messages = result.messages;
    const latestMessage = conversation.messages.at(-1);
    conversation.preview = latestMessage
      ? `${latestMessage.userId === currentUser.id ? "You" : latestMessage.sender}: ${latestMessage.text}`
      : "No messages yet";
    conversation.time = latestMessage ? formatMessageTime(latestMessage.createdAt) : "";
    renderConversations();
    renderMessages();
  } catch (error) {
    if (requestId !== messageRequestId) return;
    console.error("Loading messages failed:", error);
    showChatNotice(error.message || "Could not load messages. Please try again.", "chat-notice error");
  }
}

function selectConversation(id) {
  activeConversationId = id;
  const conversation = getActiveConversation();
  conversation.unread = 0;
  renderConversations();
  chatAvatar.textContent = conversation.initials;
  chatAvatar.style.backgroundColor = conversation.color;
  chatAvatar.style.color = conversation.textColor;
  chatTitle.textContent = conversation.name;
  chatSubtitle.textContent = conversation.members;
  app.classList.add("show-conversation");
  loadMessages(conversation);
}

conversationList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-conversation-id]");
  if (button) selectConversation(button.dataset.conversationId);
});

conversationSearch.addEventListener("input", renderConversations);

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 110)}px`;
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    messageForm.requestSubmit();
  }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  const conversation = getActiveConversation();
  const submitButton = messageForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionStorage.getItem("authToken")}`
      },
      body: JSON.stringify({ conversationId: conversation.id, message: text })
    });

    if (response.status === 401) {
      sessionStorage.removeItem("authToken");
      window.location.replace("auth/login.html");
      return;
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to send message.");

    conversation.messages.push(result.message);
    conversation.preview = `You: ${result.message.text}`;
    conversation.time = formatMessageTime(result.message.createdAt);
    messageInput.value = "";
    messageInput.style.height = "auto";
    renderConversations();
    renderMessages();
    messageInput.focus({ preventScroll: true });
  } catch (error) {
    console.error("Sending message failed:", error);
    showChatNotice(error.message || "Could not send message. Please try again.", "chat-notice error", false);
  } finally {
    submitButton.disabled = false;
  }
});

backButton.addEventListener("click", () => {
  app.classList.remove("show-conversation");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    conversationSearch.focus();
  }
});

verifySession().then((isAuthenticated) => {
  if (isAuthenticated) {
    renderConversations();
    loadMessages(getActiveConversation());
  }
});
