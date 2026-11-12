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
const attachmentInput = document.querySelector("#attachment-input");
const attachmentButton = document.querySelector("#attachment-button");
const attachmentList = document.querySelector("#attachment-list");
const attachmentNote = document.querySelector("#attachment-note");
const mediaDialog = document.querySelector("#media-dialog");
const mediaDialogName = document.querySelector("#media-dialog-name");
const mediaDialogContent = document.querySelector("#media-dialog-content");
const mediaDialogClose = document.querySelector("#media-dialog-close");
const backButton = document.querySelector("#back-button");
const authStatus = document.querySelector("#auth-status");
const profileAvatar = document.querySelector("#profile-avatar");
const personalChatForm = document.querySelector("#personal-chat-form");
const personalChatEmail = document.querySelector("#personal-chat-email");
const personalChatResults = document.querySelector("#personal-chat-results");
const personalChatStatus = document.querySelector("#personal-chat-status");
const createGroupForm = document.querySelector("#create-group-form");
const groupNameInput = document.querySelector("#group-name");
const joinGroupForm = document.querySelector("#join-group-form");
const groupInviteCodeInput = document.querySelector("#group-invite-code");
const groupChatStatus = document.querySelector("#group-chat-status");

let activeConversationId = conversations[0].id;
let currentUser = null;
let realtimeSocket = null;
let userSearchTimer = null;
let userSearchController = null;
let userSearchRequestId = 0;
const selectedAttachments = [];
let attachmentPreviewUrls = [];
let mediaDialogOpener = null;
const maxAttachmentCount = 5;
const maxAttachmentBytes = 25 * 1024 * 1024;
const allowedAttachmentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain"
]);
const personalConversations = [];
const groupConversations = [];
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

function formatFileSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentType(file) {
  if (file.type.startsWith("image/")) return "Image";
  if (file.type.startsWith("video/")) return "Video";
  if (file.type.startsWith("audio/")) return "Audio";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "PDF";
  return "File";
}

function showAttachmentNote(message, isError = false) {
  attachmentNote.textContent = message;
  attachmentNote.hidden = !message;
  attachmentNote.classList.toggle("error", isError);
}

function renderAttachments() {
  attachmentPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  attachmentPreviewUrls = [];
  attachmentList.replaceChildren();
  attachmentList.hidden = selectedAttachments.length === 0;
  messageInput.placeholder = selectedAttachments.length > 0
    ? "Add a message (optional)"
    : "Write a message...";

  selectedAttachments.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "attachment-item";

    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
      const previewUrl = URL.createObjectURL(file);
      attachmentPreviewUrls.push(previewUrl);
      const previewButton = document.createElement("button");
      previewButton.className = "attachment-media-preview";
      previewButton.type = "button";
      previewButton.dataset.mediaUrl = previewUrl;
      previewButton.dataset.mediaType = file.type;
      previewButton.dataset.mediaName = file.name;
      previewButton.setAttribute("aria-label", `Preview ${getAttachmentType(file)} ${file.name}`);

      if (file.type.startsWith("image/")) {
        const preview = document.createElement("img");
        preview.className = "attachment-preview";
        preview.alt = "";
        preview.src = previewUrl;
        previewButton.append(preview);
      } else {
        previewButton.classList.add("message-video-trigger");
        const preview = document.createElement("video");
        preview.className = "attachment-preview";
        preview.src = previewUrl;
        preview.muted = true;
        preview.playsInline = true;
        preview.preload = "metadata";
        const playLabel = document.createElement("span");
        playLabel.className = "message-video-play";
        playLabel.setAttribute("aria-hidden", "true");
        playLabel.textContent = "▶";
        previewButton.append(preview, playLabel);
      }
      item.append(previewButton);
    } else {
      const type = document.createElement("span");
      type.className = "attachment-type";
      type.textContent = getAttachmentType(file);
      item.append(type);
    }

    const details = document.createElement("span");
    details.className = "attachment-details";
    const name = document.createElement("span");
    name.className = "attachment-name";
    name.textContent = file.name;
    const size = document.createElement("span");
    size.className = "attachment-size";
    size.textContent = `${getAttachmentType(file)} · ${formatFileSize(file.size)}`;
    details.append(name, size);

    const remove = document.createElement("button");
    remove.className = "attachment-remove";
    remove.type = "button";
    remove.dataset.attachmentIndex = String(index);
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.textContent = "×";
    item.append(details, remove);
    attachmentList.append(item);
  });

  showAttachmentNote(
    selectedAttachments.length > 0
      ? `Up to ${maxAttachmentCount} files · ${formatFileSize(maxAttachmentBytes)} each. You can send files without a message.`
      : ""
  );
}

function getMessagePreview(message) {
  const text = message.text || "";
  const media = (message.attachments || []).map(({ name }) => name).join(", ");
  return text && media ? `${text} · ${media}` : text || media || "Attachment";
}

function addMessage(conversation, message) {
  const ids = messageIds.get(conversation.id);
  if (ids.has(message.id)) return false;

  ids.add(message.id);
  conversation.messages.push(message);
  const preview = getMessagePreview(message);
  conversation.preview = `${message.userId === currentUser.id ? "You" : message.sender}: ${preview}`;
  conversation.time = formatMessageTime(message.createdAt);
  conversation.latestMessageAt = message.createdAt;
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

  if (conversation.isGroup) {
    joinGroupConversation(conversation);
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

function joinGroupConversation(conversation) {
  if (!realtimeSocket || !realtimeSocket.connected) return;
  if (conversation.id === activeConversationId) chatSubtitle.textContent = "Joining group...";
  realtimeSocket.emit("conversation:join", { conversationId: conversation.id }, (result) => {
    if (!result || !result.ok) {
      if (conversation.id === activeConversationId) chatSubtitle.textContent = "Unable to join this group";
      console.error(`Could not join group "${conversation.name}":`, result && result.error);
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
    chatSubtitle.textContent = conversation.isGroup
      ? `${onlineCount} online · ${conversation.memberCount} members`
      : `${onlineCount} here now`;
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

  realtimeSocket.on("connect", () => {
    joinActiveConversation();
    groupConversations
      .filter((conversation) => conversation.id !== activeConversationId)
      .forEach(joinGroupConversation);
  });
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

    if (conversation.id !== activeConversationId) conversation.unread += 1;
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
  return [...conversations, ...personalConversations, ...groupConversations];
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

function getOrCreateGroupConversation(group) {
  const id = group.conversationId || `group:${group.id}`;
  let conversation = conversationsById.get(id);
  if (conversation) {
    conversation.memberCount = group.memberCount;
    conversation.inviteCode = group.inviteCode;
    conversation.latestMessageAt = group.lastMessageAt || conversation.latestMessageAt;
    if (group.lastMessage && conversation.messages.length === 0) {
      conversation.preview = group.lastMessage;
      conversation.time = formatMessageTime(group.lastMessageAt);
    }
    return conversation;
  }

  conversation = {
    id,
    groupId: String(group.id),
    name: group.name,
    initials: group.name.slice(0, 1).toUpperCase(),
    color: "#d8d1fa",
    textColor: "#574b91",
    preview: group.lastMessage || "No messages yet",
    time: group.lastMessageAt ? formatMessageTime(group.lastMessageAt) : "",
    latestMessageAt: group.lastMessageAt || "",
    unread: 0,
    memberCount: group.memberCount,
    inviteCode: group.inviteCode,
    isGroup: true,
    messages: []
  };
  groupConversations.push(conversation);
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
  const filtered = allConversations
    .filter((conversation) =>
      conversation.name.toLowerCase().includes(query) ||
      (conversation.email && conversation.email.toLowerCase().includes(query))
    )
    .sort((first, second) => {
      const firstLatest = first.messages.reduce(
        (latest, message) => Math.max(latest, new Date(message.createdAt).getTime() || 0),
        new Date(first.latestMessageAt || 0).getTime() || 0
      );
      const secondLatest = second.messages.reduce(
        (latest, message) => Math.max(latest, new Date(message.createdAt).getTime() || 0),
        new Date(second.latestMessageAt || 0).getTime() || 0
      );
      return secondLatest - firstLatest;
    });
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

  if (message.text) {
    const bubble = document.createElement("p");
    bubble.className = "message-bubble";
    bubble.textContent = message.text;
    content.append(bubble);
  }

  (message.attachments || []).forEach((attachment) => {
    if (attachment.contentType.startsWith("image/")) {
      const previewButton = document.createElement("button");
      previewButton.className = "message-media-trigger";
      previewButton.type = "button";
      previewButton.dataset.mediaUrl = attachment.url;
      previewButton.dataset.mediaType = attachment.contentType;
      previewButton.dataset.mediaName = attachment.name;
      previewButton.setAttribute("aria-label", `Preview image ${attachment.name}`);
      const image = document.createElement("img");
      image.className = "message-media-image";
      image.src = attachment.url;
      image.alt = attachment.name;
      image.loading = "lazy";
      previewButton.append(image);
      content.append(previewButton);
      return;
    }

    if (attachment.contentType.startsWith("video/")) {
      const previewButton = document.createElement("button");
      previewButton.className = "message-media-trigger message-video-trigger";
      previewButton.type = "button";
      previewButton.dataset.mediaUrl = attachment.url;
      previewButton.dataset.mediaType = attachment.contentType;
      previewButton.dataset.mediaName = attachment.name;
      previewButton.setAttribute("aria-label", `Play video ${attachment.name}`);
      const video = document.createElement("video");
      video.className = "message-media-image";
      video.src = attachment.url;
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      const playLabel = document.createElement("span");
      playLabel.className = "message-video-play";
      playLabel.setAttribute("aria-hidden", "true");
      playLabel.textContent = "▶";
      previewButton.append(video, playLabel);
      content.append(previewButton);
      return;
    }

    if (attachment.contentType.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.className = "message-media-player";
      audio.src = attachment.url;
      audio.controls = true;
      audio.preload = "metadata";
      audio.setAttribute("aria-label", attachment.name);
      content.append(audio);
      return;
    }

    const fileLink = document.createElement("a");
    fileLink.className = "message-file-link";
    fileLink.href = attachment.url;
    fileLink.target = "_blank";
    fileLink.rel = "noopener noreferrer";
    fileLink.textContent = `${attachment.name} · ${formatFileSize(attachment.size)}`;
    content.append(fileLink);
  });

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
  content.append(time);

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
    : conversation.isGroup
      ? `${conversation.memberCount} members`
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
        conversation.preview = `${latestMessage.userId === currentUser.id ? "You" : latestMessage.sender}: ${getMessagePreview(latestMessage)}`;
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
        conversation.preview = `${latestMessage.userId === currentUser.id ? "You" : latestMessage.sender}: ${getMessagePreview(latestMessage)}`;
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
      conversation.preview = `${latestMessage.userId === currentUser.id ? "You" : latestMessage.sender}: ${getMessagePreview(latestMessage)}`;
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

async function loadGroups() {
  try {
    const response = await fetch("/api/groups", {
      headers: { Authorization: `Bearer ${sessionStorage.getItem("authToken")}` }
    });
    if (response.status === 401) {
      sessionStorage.removeItem("authToken");
      window.location.replace("auth/login.html");
      return;
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load groups.");
    result.groups.forEach((group) => getOrCreateGroupConversation(group));
    renderConversations();
  } catch (error) {
    console.error("Loading groups failed:", error);
    groupChatStatus.textContent = error.message || "Could not load groups.";
  }
}

async function loadGroupMessages(conversation) {
  try {
    const response = await fetch(`/api/groups/${encodeURIComponent(conversation.groupId)}/messages`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem("authToken")}` }
    });
    if (response.status === 401) {
      sessionStorage.removeItem("authToken");
      window.location.replace("auth/login.html");
      return;
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load group messages.");
    result.messages.forEach((message) => addMessage(conversation, message));
    conversation.messages.sort((first, second) =>
      new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
    );
    const latestMessage = conversation.messages.at(-1);
    if (latestMessage) {
      conversation.preview = `${latestMessage.sender}: ${getMessagePreview(latestMessage)}`;
      conversation.time = formatMessageTime(latestMessage.createdAt);
      conversation.latestMessageAt = latestMessage.createdAt;
    }

    renderConversations();
    if (conversation.id === activeConversationId) renderMessages();
  } catch (error) {
    console.error("Loading group messages failed:", error);
    if (conversation.id === activeConversationId) {
      showChatNotice(error.message || "Could not load group messages. Please try again.", "chat-notice error");
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
    } else if (!previousConversation.isGroup) {
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
    : conversation.isGroup
      ? `${conversation.memberCount} members`
      : "Checking who's here...";
  app.classList.add("show-conversation");
  renderMessages();
  joinActiveConversation();
  if (conversation.isPersonal) loadPersonalMessages(conversation);
  if (conversation.isGroup) loadGroupMessages(conversation);
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

createGroupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = createGroupForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  groupChatStatus.textContent = "Creating group...";

  try {
    const response = await fetch("/api/groups", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionStorage.getItem("authToken")}`
      },
      body: JSON.stringify({ name: groupNameInput.value.trim() })
    });
    if (response.status === 401) {
      sessionStorage.removeItem("authToken");
      window.location.replace("auth/login.html");
      return;
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to create group.");
    const conversation = getOrCreateGroupConversation(result.group);
    createGroupForm.reset();
    groupChatStatus.textContent = `Group created. Share invite code: ${result.group.inviteCode}`;
    selectConversation(conversation.id);
  } catch (error) {
    groupChatStatus.textContent = error.message || "Could not create group.";
    console.error("Creating group failed:", error);
  } finally {
    submitButton.disabled = false;
  }
});

joinGroupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = joinGroupForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  groupChatStatus.textContent = "Joining group...";

  try {
    const response = await fetch("/api/groups/join", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionStorage.getItem("authToken")}`
      },
      body: JSON.stringify({ inviteCode: groupInviteCodeInput.value.trim() })
    });
    if (response.status === 401) {
      sessionStorage.removeItem("authToken");
      window.location.replace("auth/login.html");
      return;
    }

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to join group.");
    const conversation = getOrCreateGroupConversation(result.group);
    joinGroupForm.reset();
    groupChatStatus.textContent = `Joined ${result.group.name}.`;
    selectConversation(conversation.id);
  } catch (error) {
    groupChatStatus.textContent = error.message || "Could not join group.";
    console.error("Joining group failed:", error);
  } finally {
    submitButton.disabled = false;
  }
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

attachmentButton.addEventListener("click", () => attachmentInput.click());

attachmentInput.addEventListener("change", () => {
  const incomingFiles = Array.from(attachmentInput.files);
  let note = "";
  incomingFiles.forEach((file) => {
    if (!allowedAttachmentTypes.has(file.type)) {
      note = `${file.name} is not a supported file type.`;
      return;
    }
    if (file.size < 1 || file.size > maxAttachmentBytes) {
      note = `${file.name} must be 25 MB or smaller.`;
      return;
    }
    if (selectedAttachments.length >= maxAttachmentCount) {
      note = `You can attach up to ${maxAttachmentCount} files to a message.`;
      return;
    }
    selectedAttachments.push(file);
  });
  attachmentInput.value = "";
  renderAttachments();
  if (note) showAttachmentNote(note, true);
});

attachmentList.addEventListener("click", (event) => {
  const previewButton = event.target.closest("[data-media-url]");
  if (previewButton) {
    openMediaPreview(previewButton);
    return;
  }
  const removeButton = event.target.closest("[data-attachment-index]");
  if (!removeButton) return;
  selectedAttachments.splice(Number(removeButton.dataset.attachmentIndex), 1);
  renderAttachments();
});

async function uploadAttachment(file) {
  const formResponse = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionStorage.getItem("authToken")}`
    },
    body: JSON.stringify({ contentType: file.type })
  });
  if (formResponse.status === 401) {
    sessionStorage.removeItem("authToken");
    window.location.replace("auth/login.html");
    throw new Error("Your session has expired. Please sign in again.");
  }

  const form = await formResponse.json();
  if (!formResponse.ok) throw new Error(form.error || "Unable to prepare the file upload.");

  const formData = new FormData();
  Object.entries(form.fields).forEach(([name, value]) => formData.append(name, value));
  formData.append("file", file);
  let uploadResponse;
  try {
    uploadResponse = await fetch(form.url, { method: "POST", body: formData });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Could not reach S3 for ${file.name}. Check the bucket CORS rule allows POST from ${window.location.origin}, or check your network connection.`
      );
    }
    throw error;
  }
  if (!uploadResponse.ok) {
    throw new Error(`S3 rejected ${file.name} (HTTP ${uploadResponse.status}). Check the bucket CORS configuration.`);
  }

  return {
    key: form.key,
    name: file.name,
    contentType: file.type,
    size: file.size
  };
}

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text && selectedAttachments.length === 0) {
    showAttachmentNote("Write a message or attach at least one file.", true);
    return;
  }

  const conversation = getActiveConversation();
  const submitButton = messageForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    let attachments = [];
    if (selectedAttachments.length > 0) {
      showAttachmentNote(`Uploading ${selectedAttachments.length} ${selectedAttachments.length === 1 ? "file" : "files"}...`);
      attachments = await Promise.all(selectedAttachments.map(uploadAttachment));
    }

    const endpoint = conversation.isPersonal
      ? "/api/personal-messages"
      : conversation.isGroup
        ? `/api/groups/${encodeURIComponent(conversation.groupId)}/messages`
        : "/api/messages";
    const payload = { message: text, attachments };
    if (conversation.isPersonal) payload.recipientId = conversation.recipientId;
    else if (!conversation.isGroup) payload.conversationId = conversation.id;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionStorage.getItem("authToken")}`
      },
      body: JSON.stringify(payload)
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
    selectedAttachments.splice(0, selectedAttachments.length);
    renderAttachments();
    renderConversations();
    renderMessages();
    messageInput.focus({ preventScroll: true });
  } catch (error) {
    console.error("Sending message failed:", error);
    showAttachmentNote(error.message || "Could not send message. Please try again.", true);
    showChatNotice(error.message || "Could not send message. Please try again.", "chat-notice error", false);
  } finally {
    submitButton.disabled = false;
  }
});
backButton.addEventListener("click", () => {
  app.classList.remove("show-conversation");
});

function closeMediaPreview() {
  if (!mediaDialog.open) return;
  mediaDialog.close();
}

function openMediaPreview(trigger) {
  const isVideo = trigger.dataset.mediaType.startsWith("video/");
  const media = document.createElement(isVideo ? "video" : "img");
  media.className = "media-dialog-media";
  media.src = trigger.dataset.mediaUrl;
  media.alt = trigger.dataset.mediaName;
  if (isVideo) {
    media.controls = true;
    media.autoplay = true;
    media.playsInline = true;
    media.addEventListener("error", () => {
      const error = document.createElement("p");
      error.className = "media-dialog-error";
      error.setAttribute("role", "status");
      error.textContent = "This video could not be played. Try again later.";
      mediaDialogContent.append(error);
    }, { once: true });
  }

  mediaDialogName.textContent = trigger.dataset.mediaName;
  mediaDialogOpener = trigger;
  mediaDialogContent.replaceChildren(media);
  mediaDialog.returnValue = "";
  mediaDialog.showModal();
  if (isVideo) {
    media.play().catch((error) => {
      if (error.name !== "NotAllowedError") {
        console.error("Playing chat video preview failed:", error);
      }
    });
  }
}

messageList.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-media-url]");
  if (trigger) openMediaPreview(trigger);
});

mediaDialogClose.addEventListener("click", closeMediaPreview);
mediaDialog.addEventListener("click", (event) => {
  if (event.target === mediaDialog) {
    mediaDialog.returnValue = "backdrop";
    closeMediaPreview();
    return;
  }
  if (event.target instanceof Element && event.target.closest(".media-dialog-panel")) {
    return;
  }
  closeMediaPreview();
});
mediaDialog.addEventListener("close", () => {
  mediaDialogContent.replaceChildren();
  mediaDialogName.textContent = "";
  const focusTarget = mediaDialogOpener && mediaDialogOpener.isConnected
    ? mediaDialogOpener
    : messageInput;
  mediaDialogOpener = null;
  focusTarget.focus({ preventScroll: true });
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
    Promise.all([loadMessages(), loadPersonalConversations(), loadGroups()])
      .then(connectRealtime);
  }
});
