const conversations = [
  {
    id: "weekend",
    name: "Weekend plans",
    initials: "W",
    color: "#f4d2b7",
    textColor: "#79513d",
    preview: "No messages yet",
    time: "",
    unread: 0,
    onlineCount: 0,
    presenceKnown: false,
    messages: []
  },
  {
    id: "design",
    name: "Design team",
    initials: "D",
    color: "#d8d1fa",
    textColor: "#574b91",
    preview: "No messages yet",
    time: "",
    unread: 0,
    onlineCount: 0,
    presenceKnown: false,
    messages: []
  },
  {
    id: "family",
    name: "The Sunday crew",
    initials: "S",
    color: "#c7e7d7",
    textColor: "#366a52",
    preview: "No messages yet",
    time: "",
    unread: 0,
    onlineCount: 0,
    presenceKnown: false,
    messages: []
  },
  {
    id: "hikes",
    name: "Saturday hikers",
    initials: "H",
    color: "#d6e5c4",
    textColor: "#536c3d",
    preview: "No messages yet",
    time: "",
    unread: 0,
    onlineCount: 0,
    presenceKnown: false,
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
const personalChatForm = document.querySelector("#personal-chat-form");
const personalChatEmail = document.querySelector("#personal-chat-email");
const personalChatResults = document.querySelector("#personal-chat-results");
const personalChatStatus = document.querySelector("#personal-chat-status");

let activeConversationId = conversations[0].id;
let currentUser = null;
let realtimeSocket = null;
let userSearchTimer = null;
let userSearchController = null;
let userSearchRequestId = 0;
const personalConversations = [];
const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
const messageIds = new Map(conversations.map((conversation) => [conversation.id, new Set()]));

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

function addMessage(conversation, message) {
  const ids = messageIds.get(conversation.id);
  if (ids.has(message.id)) return false;

  ids.add(message.id);
  conversation.messages.push(message);
  conversation.preview = `${message.userId === currentUser.id ? "You" : message.sender}: ${message.text}`;
  conversation.time = formatMessageTime(message.createdAt);
  return true;
}

function joinActiveConversation() {
  if (!realtimeSocket || !realtimeSocket.connected) return;
  const conversation = getActiveConversation();
  if (conversation.isPersonal) {
    chatSubtitle.textContent = "Connecting to personal chat...";
    realtimeSocket.emit("join_room", {
      recipientId: conversation.recipientId,
      roomId: conversation.id
    }, (result) => {
      if (activeConversationId !== conversation.id) {
        if (result && result.ok) {
          realtimeSocket.emit("leave_room", {
            recipientId: conversation.recipientId,
            roomId: conversation.id
          });
        }
        return;
      }
      if (!result || !result.ok) {
        chatSubtitle.textContent = "Personal chat unavailable";
        console.error("Could not join personal chat:", result && result.error);
        return;
      }
      chatSubtitle.textContent = `Personal chat · ${conversation.email}`;
    });
    return;
  }

  conversation.presenceKnown = false;
  chatSubtitle.textContent = "Checking who's here...";
  realtimeSocket.emit("conversation:join", { conversationId: activeConversationId }, (result) => {
    if (!result || !result.ok) {
      console.error("Could not join chat conversation:", result && result.error);
      chatSubtitle.textContent = "Live presence unavailable";
      return;
    }
    updateConversationPresence(result.conversationId, result.onlineCount);
  });
}

function updateConversationPresence(conversationId, onlineCount) {
  const conversation = conversationsById.get(conversationId);
  if (!conversation || !Number.isInteger(onlineCount) || onlineCount < 0) return;

  conversation.onlineCount = onlineCount;
  conversation.presenceKnown = true;
  if (conversation.id === activeConversationId) {
    chatSubtitle.textContent = `${onlineCount} here now`;
  }
}

function connectRealtime() {
  if (typeof window.io !== "function") {
    console.error("Socket.IO client failed to load; real-time messages are unavailable.");
    chatSubtitle.textContent = "Live presence unavailable";
    return;
  }

  realtimeSocket = window.io({
    autoConnect: false,
    auth: { token: sessionStorage.getItem("authToken") }
  });

  realtimeSocket.on("connect", joinActiveConversation);
  realtimeSocket.on("conversation:presence", ({ conversationId, onlineCount } = {}) => {
    updateConversationPresence(conversationId, onlineCount);
  });
  realtimeSocket.on("disconnect", () => {
    const conversation = getActiveConversation();
    conversation.presenceKnown = false;
    chatSubtitle.textContent = "Reconnecting...";
  });
  realtimeSocket.on("message:new", (message) => {
    const conversation = conversationsById.get(message.conversationId);
    if (!conversation || !addMessage(conversation, message)) return;

    renderConversations();
    if (conversation.id === activeConversationId) renderMessages();
  });
  realtimeSocket.on("new_message", (message) => {
    let conversation = conversationsById.get(message.conversationId);
    if (!conversation && message.userId !== currentUser.id && message.sender) {
      conversation = getOrCreatePersonalConversation(message.conversationId, {
        id: message.userId,
        name: message.sender,
        email: message.senderEmail || ""
      });
    }
    if (!conversation || !conversation.isPersonal || !addMessage(conversation, message)) return;

    if (conversation.id !== activeConversationId) conversation.unread += 1;
    renderConversations();
    if (conversation.id === activeConversationId) renderMessages();
  });
  realtimeSocket.on("connect_error", (error) => {
    if (error.data && error.data.code === "AUTHENTICATION_ERROR") {
      sessionStorage.removeItem("authToken");
      window.location.replace("auth/login.html");
      return;
    }
    chatSubtitle.textContent = "Live presence unavailable";
    console.error("Socket.IO connection failed:", error.message);
  });
  realtimeSocket.connect();
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
  return conversationsById.get(activeConversationId);
}

function getAllConversations() {
  return [...conversations, ...personalConversations];
}

function getOrCreatePersonalConversation(id, user) {
  let conversation = conversationsById.get(id);
  if (conversation) {
    if (!conversation.email && user.email) conversation.email = user.email;
    return conversation;
  }

  conversation = {
    id,
    name: user.name,
    email: user.email,
    recipientId: user.id,
    initials: user.name.slice(0, 1).toUpperCase(),
    color: "#d8d1fa",
    textColor: "#574b91",
    preview: "Personal chat",
    time: "",
    unread: 0,
    isPersonal: true,
    messages: []
  };
  personalConversations.push(conversation);
  conversationsById.set(id, conversation);
  messageIds.set(id, new Set());
  return conversation;
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
  const allConversations = getAllConversations();
  const filtered = allConversations.filter((conversation) =>
    conversation.name.toLowerCase().includes(query) ||
    (conversation.email && conversation.email.toLowerCase().includes(query))
  );
  conversationList.replaceChildren();
  inboxCount.textContent = `${allConversations.length} conversations`;

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

function renderPersonalChatResults(users) {
  personalChatResults.replaceChildren();
  personalChatResults.hidden = users.length === 0;
  users.forEach((user) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "personal-chat-result";
    option.role = "option";
    option.dataset.email = user.email;

    const name = document.createElement("span");
    name.className = "personal-chat-result-name";
    name.textContent = user.name;
    const email = document.createElement("span");
    email.className = "personal-chat-result-email";
    email.textContent = user.email;
    option.append(name, email);
    personalChatResults.append(option);
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
  chatSubtitle.textContent = conversation.isPersonal
    ? `Personal chat · ${conversation.email}`
    : conversation.presenceKnown
      ? `${conversation.onlineCount} here now`
      : "Checking who's here...";
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

async function loadMessages() {
  showChatNotice("Loading messages...");
  try {
    const response = await fetch("/api/messages", {
      headers: { Authorization: `Bearer ${sessionStorage.getItem("authToken")}` }
    });
    if (response.status === 401) {
      sessionStorage.removeItem("authToken");
      window.location.replace("auth/login.html");
      return;
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load messages.");

    const receivedWhileLoading = conversations.map((conversation) => ({
      conversation,
      messages: conversation.messages
    }));
    conversations.forEach((conversation) => {
      conversation.messages = [];
      messageIds.get(conversation.id).clear();
      conversation.preview = "No messages yet";
      conversation.time = "";
    });

    result.messages.forEach((message) => {
      const conversation = conversationsById.get(message.conversationId);
      if (conversation) addMessage(conversation, message);
    });
    receivedWhileLoading.forEach(({ conversation, messages }) => {
      messages.forEach((message) => addMessage(conversation, message));
    });

    conversations.forEach((conversation) => {
      conversation.messages.sort((first, second) =>
        new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
      );
      const latestMessage = conversation.messages.at(-1);
      if (latestMessage) {
        conversation.preview = `${latestMessage.userId === currentUser.id ? "You" : latestMessage.sender}: ${latestMessage.text}`;
        conversation.time = formatMessageTime(latestMessage.createdAt);
      }
    });
    renderConversations();
    renderMessages();
  } catch (error) {
    console.error("Loading messages failed:", error);
    showChatNotice(error.message || "Could not load messages. Please try again.", "chat-notice error");
  }
}

async function loadPersonalConversations() {
  try {
    const response = await fetch("/api/personal-conversations", {
      headers: { Authorization: `Bearer ${sessionStorage.getItem("authToken")}` }
    });
    if (response.status === 401) {
      sessionStorage.removeItem("authToken");
      window.location.replace("auth/login.html");
      return;
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load personal conversations.");

    result.conversations.forEach(({ id, user, messages }) => {
      const conversation = getOrCreatePersonalConversation(id, user);
      messages.forEach((message) => addMessage(conversation, message));
      conversation.messages.sort((first, second) =>
        new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
      );
      const latestMessage = conversation.messages.at(-1);
      if (latestMessage) {
        conversation.preview = `${latestMessage.userId === currentUser.id ? "You" : latestMessage.sender}: ${latestMessage.text}`;
        conversation.time = formatMessageTime(latestMessage.createdAt);
      }
    });

    renderConversations();
    if (getActiveConversation().isPersonal) renderMessages();
  } catch (error) {
    console.error("Loading personal conversations failed:", error);
    personalChatStatus.textContent = error.message || "Could not load personal conversations.";
  }
}

async function loadPersonalMessages(conversation) {
  try {
    const response = await fetch(
      `/api/personal-messages?recipientId=${encodeURIComponent(conversation.recipientId)}`,
      { headers: { Authorization: `Bearer ${sessionStorage.getItem("authToken")}` } }
    );
    if (response.status === 401) {
      sessionStorage.removeItem("authToken");
      window.location.replace("auth/login.html");
      return;
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load personal messages.");
    result.messages.forEach((message) => addMessage(conversation, message));
    conversation.messages.sort((first, second) =>
      new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
    );
    const latestMessage = conversation.messages.at(-1);
    if (latestMessage) {
      conversation.preview = `${latestMessage.userId === currentUser.id ? "You" : latestMessage.sender}: ${latestMessage.text}`;
      conversation.time = formatMessageTime(latestMessage.createdAt);
    }

    renderConversations();
    if (conversation.id === activeConversationId) renderMessages();
  } catch (error) {
    console.error("Loading personal messages failed:", error);
    if (conversation.id === activeConversationId) {
      showChatNotice(error.message || "Could not load personal messages. Please try again.", "chat-notice error");
    }
  }
}

function selectConversation(id) {
  const previousConversationId = activeConversationId;
  const previousConversation = getActiveConversation();
  if (realtimeSocket && realtimeSocket.connected && previousConversationId !== id) {
    if (previousConversation.isPersonal) {
      realtimeSocket.emit("leave_room", {
        recipientId: previousConversation.recipientId,
        roomId: previousConversation.id
      });
    } else {
      realtimeSocket.emit("conversation:leave", { conversationId: previousConversationId });
    }
  }

  activeConversationId = id;
  const conversation = getActiveConversation();
  conversation.unread = 0;
  conversation.presenceKnown = false;
  renderConversations();
  chatAvatar.textContent = conversation.initials;
  chatAvatar.style.backgroundColor = conversation.color;
  chatAvatar.style.color = conversation.textColor;
  chatTitle.textContent = conversation.name;
  chatSubtitle.textContent = conversation.isPersonal
    ? `Personal chat · ${conversation.email}`
    : "Checking who's here...";
  app.classList.add("show-conversation");
  renderMessages();
  joinActiveConversation();
  if (conversation.isPersonal) loadPersonalMessages(conversation);
}

conversationList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-conversation-id]");
  if (button) selectConversation(button.dataset.conversationId);
});

conversationSearch.addEventListener("input", renderConversations);

personalChatEmail.addEventListener("input", () => {
  clearTimeout(userSearchTimer);
  if (userSearchController) userSearchController.abort();

  const query = personalChatEmail.value.trim();
  personalChatResults.replaceChildren();
  personalChatResults.hidden = true;
  personalChatStatus.textContent = "";
  if (query.length < 2) return;

  const requestId = ++userSearchRequestId;
  userSearchTimer = setTimeout(async () => {
    userSearchController = new AbortController();
    personalChatStatus.textContent = "Searching...";
    try {
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem("authToken")}` },
        signal: userSearchController.signal
      });
      if (response.status === 401) {
        sessionStorage.removeItem("authToken");
        window.location.replace("auth/login.html");
        return;
      }

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to search for users.");
      if (requestId !== userSearchRequestId) return;

      if (result.users.length === 0) {
        personalChatStatus.textContent = "No matching users.";
        return;
      }
      renderPersonalChatResults(result.users);
      personalChatStatus.textContent = "";
    } catch (error) {
      if (error.name === "AbortError") return;
      if (requestId === userSearchRequestId) {
        personalChatStatus.textContent = error.message || "Could not search for users.";
        console.error("Searching chat users failed:", error);
      }
    }
  }, 250);
});

async function startPersonalChat(email) {
  const submitButton = personalChatForm.querySelector('button[type="submit"]');
  if (userSearchController) userSearchController.abort();
  clearTimeout(userSearchTimer);
  personalChatResults.replaceChildren();
  personalChatResults.hidden = true;
  submitButton.disabled = true;
  personalChatStatus.textContent = "Looking up account...";

  try {
    const response = await fetch(`/api/users/lookup?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem("authToken")}` }
    });
    const result = await response.json();
    if (response.status === 401) {
      sessionStorage.removeItem("authToken");
      window.location.replace("auth/login.html");
      return;
    }
    if (!response.ok) throw new Error(result.error || "Unable to find that user.");

    const conversation = getOrCreatePersonalConversation(result.roomId, result.user);

    personalChatStatus.textContent = "";
    personalChatForm.reset();
    selectConversation(conversation.id);
  } catch (error) {
    personalChatStatus.textContent = error.message || "Could not start personal chat.";
    console.error("Starting personal chat failed:", error);
  } finally {
    submitButton.disabled = false;
  }
}

personalChatResults.addEventListener("click", (event) => {
  const option = event.target.closest("[data-email]");
  if (!option) return;
  personalChatEmail.value = option.dataset.email;
  startPersonalChat(option.dataset.email);
});

personalChatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  startPersonalChat(personalChatEmail.value.trim());
});

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

  if (conversation.isPersonal) {
    try {
      const response = await fetch("/api/personal-messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionStorage.getItem("authToken")}`
        },
        body: JSON.stringify({ recipientId: conversation.recipientId, message: text })
      });

      if (response.status === 401) {
        sessionStorage.removeItem("authToken");
        window.location.replace("auth/login.html");
        return;
      }

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to send personal message.");

      addMessage(conversation, result.message);
      messageInput.value = "";
      messageInput.style.height = "auto";
      renderConversations();
      renderMessages();
      messageInput.focus({ preventScroll: true });
    } catch (error) {
      console.error("Sending personal message failed:", error);
      showChatNotice(error.message || "Could not send message. Please try again.", "chat-notice error", false);
    } finally {
      submitButton.disabled = false;
    }
    return;
  }

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

    addMessage(conversation, result.message);
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
    connectRealtime();
    loadMessages();
    loadPersonalConversations();
  }
});
