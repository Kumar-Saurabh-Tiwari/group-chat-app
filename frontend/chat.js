const conversations = [
  {
    id: "weekend",
    name: "Weekend plans",
    initials: "W",
    color: "#f4d2b7",
    textColor: "#79513d",
    members: "4 members · 2 online",
    preview: "Maya: That little patio looks perfect",
    time: "2:42 PM",
    unread: 2,
    online: true,
    messages: [
      { sender: "Maya", initials: "M", color: "#e9c4d2", textColor: "#754c5d", text: "Made it to Friday! What’s everyone thinking for this weekend?", time: "2:14 PM" },
      { sender: "Jordan", initials: "J", color: "#c5d9ec", textColor: "#425f7b", text: "How about trying that new place downtown? I’ve heard the patio is lovely.", time: "2:16 PM" },
      { sender: "You", initials: "A", outgoing: true, text: "I’m in! Saturday evening works for me ✨", time: "2:21 PM" },
      { sender: "Sam", initials: "S", color: "#d8d0f0", textColor: "#5b507d", text: "Saturday is perfect. I’ll check if they take reservations.", time: "2:28 PM" },
      { sender: "Maya", initials: "M", color: "#e9c4d2", textColor: "#754c5d", text: "That little patio looks perfect. 7-ish?", time: "2:42 PM" }
    ]
  },
  {
    id: "design",
    name: "Design team",
    initials: "D",
    color: "#d8d1fa",
    textColor: "#574b91",
    members: "6 members · 1 online",
    preview: "Alex: Just shared the latest mockups",
    time: "1:18 PM",
    unread: 1,
    messages: [
      { sender: "Alex", initials: "A", color: "#c5d9ec", textColor: "#425f7b", text: "Just shared the latest mockups. The new flow feels much simpler now.", time: "1:05 PM" },
      { sender: "You", initials: "A", outgoing: true, text: "Love the direction! The spacing feels much more relaxed.", time: "1:12 PM" },
      { sender: "Priya", initials: "P", color: "#f0d7b6", textColor: "#7a5a32", text: "Agreed. I’ll take a closer look before our review.", time: "1:18 PM" }
    ]
  },
  {
    id: "family",
    name: "The Sunday crew",
    initials: "S",
    color: "#c7e7d7",
    textColor: "#366a52",
    members: "5 members",
    preview: "You: Save me a slice!",
    time: "11:36 AM",
    unread: 0,
    messages: [
      { sender: "Dad", initials: "D", color: "#e6cebd", textColor: "#74543e", text: "Sunday lunch at ours this week. I’m trying a new recipe!", time: "11:24 AM" },
      { sender: "Lena", initials: "L", color: "#f0d2df", textColor: "#764d61", text: "Count me in. Should I bring anything?", time: "11:31 AM" },
      { sender: "You", initials: "A", outgoing: true, text: "Save me a slice! I’ll bring dessert 🍰", time: "11:36 AM" }
    ]
  },
  {
    id: "hikes",
    name: "Saturday hikers",
    initials: "H",
    color: "#d6e5c4",
    textColor: "#536c3d",
    members: "8 members",
    preview: "Chris: Trail looks clear this weekend",
    time: "Yesterday",
    unread: 0,
    messages: [
      { sender: "Chris", initials: "C", color: "#d6e5c4", textColor: "#536c3d", text: "Trail looks clear this weekend, and the weather should be great.", time: "Yesterday" },
      { sender: "You", initials: "A", outgoing: true, text: "Already looking forward to it!", time: "Yesterday" }
    ]
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
    profileAvatar.textContent = result.user.name.slice(0, 1).toUpperCase();
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
  row.className = `message-row${message.outgoing ? " outgoing" : ""}`;

  const content = document.createElement("div");
  content.className = "message-content";
  if (!message.outgoing) {
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
  time.textContent = message.time;
  if (message.outgoing) {
    const readMark = document.createElement("span");
    readMark.className = "read-mark";
    readMark.setAttribute("aria-label", "Sent");
    readMark.textContent = "✓✓";
    time.append(readMark);
  }
  content.append(bubble, time);

  if (message.outgoing) {
    row.append(content);
  } else {
    row.append(makeAvatar(message.initials, message.color, message.textColor, "message-sender-avatar"), content);
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

  const divider = document.createElement("div");
  divider.className = "day-divider";
  divider.textContent = "TODAY";
  messageList.append(divider, ...conversation.messages.map(createMessage));
  messageArea.style.scrollBehavior = "auto";
  messageArea.scrollTop = messageArea.scrollHeight;
  messageArea.style.scrollBehavior = "";
}

function selectConversation(id) {
  activeConversationId = id;
  const conversation = getActiveConversation();
  conversation.unread = 0;
  renderConversations();
  renderMessages();
  app.classList.add("show-conversation");
  messageInput.focus({ preventScroll: true });
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

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  const conversation = getActiveConversation();
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date());
  const message = { sender: "You", initials: "A", outgoing: true, text, time };
  conversation.messages.push(message);
  conversation.preview = `You: ${text}`;
  conversation.time = time;
  messageInput.value = "";
  messageInput.style.height = "auto";
  renderConversations();
  renderMessages();
  messageInput.focus({ preventScroll: true });
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
    renderMessages();
  }
});
