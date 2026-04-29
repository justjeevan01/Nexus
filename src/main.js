import './style.css';
import { auth, googleProvider, db, storage } from './firebase';
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, where, doc, getDoc, setDoc, getDocs, limit, deleteDoc, updateDoc, arrayUnion, arrayRemove, writeBatch, increment } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// --- STATE ---
let currentUser = null;
let activeChatId = null;
let isDarkTheme = true;
let chats = [];
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let callUnsubscribe = null;
let screenStream = null;
let activeMessages = [];
let isMuted = false;
let isVideoOff = false;
let currentCallUserId = null;
let replyingToMessage = null;
let currentSidebarTab = 'chats'; // 'chats' or 'requests'
let userStatuses = {}; // Map of uid -> { isOnline: boolean, name: string, etc }
let typingTimeout = null;
let lastProcessedTimes = {};
let lastRenderedChatId = null;
let lastRenderedMessageCount = 0;
let messageListener = null;

// --- GLOBAL UTILITIES ---
window.handleTabClick = (tab) => {
  currentSidebarTab = tab;
  const cTab = document.getElementById('chats-tab');
  const rTab = document.getElementById('requests-tab');
  if (!cTab || !rTab) return;
  
  if (tab === 'chats') {
    cTab.classList.add('active');
    rTab.classList.remove('active');
  } else {
    rTab.classList.add('active');
    cTab.classList.remove('active');
  }
  renderChatList();
  
  if (window.innerWidth <= 900 && activeChatId) {
    activeChatScreen.classList.remove('active', 'hidden'); 
    welcomeScreen.classList.remove('hidden'); 
    activeChatScreen.classList.add('hidden'); 
    document.querySelector('.chat-window').classList.remove('active');
    activeChatId = null;
  }
};

let startX = 0;
let currentEl = null;
let isSwiping = false;

const handleStart = (clientX, target, e) => {
  const msg = target.closest('.message');
  if (msg) { 
    startX = clientX; 
    currentEl = msg; 
    isSwiping = true; 
    currentEl.style.transition = 'none';
    document.body.style.userSelect = 'none';
    // Removed touchstart preventDefault to allow vertical scrolling on mobile
  }
};

const handleMove = (clientX, e) => {
  if (!isSwiping || !currentEl) return;
  const diff = clientX - startX;
  if (Math.abs(diff) > 10 && e.cancelable) e.preventDefault();
  if (diff > 0 && diff < 80) {
    currentEl.style.transform = `translateX(${diff}px)`;
    const indicator = currentEl.querySelector('.swipe-indicator');
    if (indicator) {
      const progress = Math.min(diff / 60, 1);
      indicator.style.opacity = progress;
      indicator.style.transform = `translateY(-50%) scale(${0.5 + progress * 0.7})`;
    }
  }
};

const handleEnd = (clientX) => {
  if (!isSwiping || !currentEl) return;
  const diff = clientX - startX;
  currentEl.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  currentEl.style.transform = '';
  const indicator = currentEl.querySelector('.swipe-indicator');
  if (indicator) { 
    indicator.style.opacity = '0'; 
    indicator.style.transform = 'translateY(-50%) scale(0.5)'; 
  }
  if (diff > 60) {
    if (navigator.vibrate) navigator.vibrate(10);
    const id = currentEl.id.replace('msg-', '');
    window.setReply(id, currentEl.dataset.sender, currentEl.dataset.text);
  }
  isSwiping = false; currentEl = null; document.body.style.userSelect = '';
};

const servers = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ],
  iceCandidatePoolSize: 10,
};

// --- DOM ELEMENTS ---
const appEl = document.getElementById('app');
const authScreen = document.getElementById('auth-screen');
const loginBtn = document.getElementById('login-btn');
const chatListEl = document.getElementById('chat-list');
const welcomeScreen = document.getElementById('welcome-screen');
const activeChatScreen = document.getElementById('active-chat');
const activeChatInfo = document.getElementById('active-chat-info');
const messagesContainer = document.getElementById('messages-container');
const messagesScrollWrapper = document.getElementById('messages-scroll-wrapper');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const attachBtn = document.getElementById('attach-btn');
const chatImageUpload = document.getElementById('chat-image-upload');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const themeToggleBtn = document.getElementById('theme-toggle');
const settingsThemeToggleBtn = document.getElementById('settings-theme-toggle');
const chatSearch = document.getElementById('chat-search');
const infoToggle = document.getElementById('info-toggle');
const infoPanel = document.getElementById('info-panel');
const closeInfo = document.getElementById('close-info');
const contactDetails = document.getElementById('contact-details');
const backBtn = document.getElementById('back-btn');
const msgSearchToggle = document.getElementById('msg-search-toggle');
const msgSearchBar = document.getElementById('msg-search-bar');
const msgSearchInput = document.getElementById('msg-search-input');
const closeMsgSearch = document.getElementById('close-msg-search');
const chatsTab = document.getElementById('chats-tab');
const requestsTab = document.getElementById('requests-tab');
const requestCountBadge = document.getElementById('request-count');
const requestBanner = document.getElementById('request-banner');
const requestUserName = document.getElementById('request-user-name');
const acceptRequestBtn = document.getElementById('accept-request-btn');
const declineRequestBtn = document.getElementById('decline-request-btn');
const chatFooter = document.querySelector('.chat-footer');
const profileBtn = document.querySelector('.user-profile');
const profileModal = document.getElementById('profile-modal');
const closeProfile = document.getElementById('close-profile');
const saveProfileBtn = document.getElementById('save-profile');
const myNameInput = document.getElementById('my-name');
const myUsernameInput = document.getElementById('my-username');
const myStatusInput = document.getElementById('my-status');
const usernameHint = document.getElementById('username-hint');
const editAvatarBtn = document.getElementById('edit-avatar-btn');
const avatarInput = document.getElementById('avatar-input');
const myProfileImg = document.getElementById('my-profile-img');
const settingsModal = document.getElementById('settings-modal');
const closeSettings = document.getElementById('close-settings');
const helpModal = document.getElementById('help-modal');
const closeHelp = document.getElementById('close-help');
const newChatBtn = document.getElementById('new-chat-btn');
const newChatModal = document.getElementById('new-chat-modal');
const closeNewChat = document.getElementById('close-new-chat');
const userListEl = document.getElementById('user-list');
const userSearchInput = document.getElementById('user-search');
const menuBtn = document.getElementById('menu-btn');
const mainMenu = document.getElementById('main-menu');
const logoutBtn = document.getElementById('logout-btn');
const menuProfileBtn = document.getElementById('menu-profile');
const menuSettingsBtn = document.getElementById('menu-settings');
const menuHelpBtn = document.getElementById('menu-help');
const callOverlay = document.getElementById('call-overlay');
const callName = document.getElementById('call-name');
const callAvatar = document.getElementById('call-avatar');
const callStatus = document.getElementById('call-status');
const endCallBtn = document.getElementById('end-call');
const acceptCallBtn = document.getElementById('accept-call');
const phoneBtn = document.getElementById('phone-btn');
const videoBtn = document.getElementById('video-btn');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const videoContainer = document.getElementById('video-container');
const ringingInfo = document.getElementById('ringing-info');
const toggleMicBtn = document.getElementById('toggle-mic');
const toggleVideoBtn = document.getElementById('toggle-video');
const shareScreenBtn = document.getElementById('share-screen-btn');
const createGroupModal = document.getElementById('create-group-modal');
const addMembersModal = document.getElementById('add-members-modal');
const closeAddMembers = document.getElementById('close-add-members');
const addMembersListEl = document.getElementById('add-members-list');
const addMembersSearchInput = document.getElementById('add-members-search');
const confirmAddMembersBtn = document.getElementById('confirm-add-members-btn');
const openAddMembersBtn = document.getElementById('open-add-members-btn');
const openCreateGroupBtn = document.getElementById('open-create-group-btn');
const groupUserList = document.getElementById('group-user-list');
const confirmCreateGroupBtn = document.getElementById('confirm-create-group-btn');
const groupNameInput = document.getElementById('group-name-input');
const closeCreateGroup = document.getElementById('close-create-group');

// --- AUTH LOGIC ---

console.log("Auth System Initialized...");

onAuthStateChanged(auth, async (user) => {
  try {
    if (user) {
      console.log("User detected:", user.uid);
      const userDocRef = doc(db, "users", user.uid);
      let userDoc = await getDoc(userDocRef);
      const userData = userDoc.exists() ? userDoc.data() : null;

      currentUser = {
        uid: user.uid, name: userData?.name || user.displayName, username: userData?.username || '',
        email: user.email, avatar: userData?.avatar || user.photoURL, status: userData?.status || 'Available', theme: userData?.theme || 'dark',
        followers: userData?.followers || [], following: userData?.following || []
      };

      if (!userDoc.exists()) await setDoc(userDocRef, currentUser);

      onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          currentUser.followers = data.followers || [];
          currentUser.following = data.following || [];
        }
      });

      await updateUserStatus(true);
      listenToUserStatuses();
      requestNotificationPermission();
      isDarkTheme = currentUser.theme === 'dark'; applyTheme(); showApp(); loadChats(); updateProfileUI(); ensureGlobalChannel(); listenForCalls();
      if (!currentUser.username) {
        setTimeout(() => { profileModal.classList.remove('hidden'); usernameHint.innerText = "Set a unique username."; }, 1000);
      }
    } else {
      console.log("No user session found.");
      showAuth();
    }
  } catch (error) {
    console.error("Critical Auth Error:", error);
    alert("Database connection failed. Please check your internet or Firebase rules.");
  }
});

window.addEventListener('beforeunload', () => {
  if (currentUser) updateUserStatus(false);
});

async function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
}

function showNotification(title, body, icon) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon });
  }
}

async function requestMediaPermissions() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach(t => t.stop());
    console.log("Media permissions pre-authorized.");
  } catch (e) {
    console.warn("Media permissions not granted yet:", e);
  }
}

async function handleLogin() {
  try {
    console.log("Starting Login Popup...");
    loginBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> <span>Connecting...</span>';
    lucide.createIcons();
    await signInWithPopup(auth, googleProvider);
    console.log("Login Successful!");
  } catch (error) {
    console.error("Login Error:", error.code, error.message);
    alert("Login failed: " + error.message);
    loginBtn.innerHTML = '<span>Sign in with Google</span>';
    lucide.createIcons();
  }
}

async function updateUserStatus(isOnline) {
  if (!currentUser) return;
  await updateDoc(doc(db, "users", currentUser.uid), { isOnline });
}

function listenToUserStatuses() {
  const q = query(collection(db, "users"));
  onSnapshot(q, (snapshot) => {
    snapshot.docs.forEach(d => {
      userStatuses[d.id] = d.data();
    });
    renderChatList(chatSearch.value);
    if (activeChatId) {
      const chat = chats.find(c => c.id === activeChatId);
      if (chat) updateHeaderStatus(chat);
    }
  });
}

function updateHeaderStatus(chat) {
  const statusEl = document.getElementById('header-status');
  const typingBubble = document.getElementById('in-chat-typing');
  const typingText = document.getElementById('in-chat-typing-text');
  if (!statusEl || !typingBubble) return;
  
  if (chat.type === 'private') {
    const otherUid = chat.participants.find(uid => uid !== currentUser.uid);
    const status = userStatuses[otherUid];
    const isTyping = chat.typing?.[otherUid];
    
    if (isTyping) {
      statusEl.innerText = "typing...";
      typingBubble.classList.remove('hidden');
      typingText.innerText = `${chat.participantNames?.find((n, i) => chat.participants[i] === otherUid) || 'Someone'} is typing...`;
      messagesScrollWrapper.scrollTop = messagesScrollWrapper.scrollHeight;
    } else {
      typingBubble.classList.add('hidden');
      statusEl.innerText = status?.isOnline ? "Online" : "Offline";
    }
  } else {
    // Group Status
    statusEl.innerText = "Tap for group info";
    
    // Group Typing
    const typingUids = Object.keys(chat.typing || {}).filter(uid => uid !== currentUser.uid && chat.typing[uid]);
    if (typingUids.length > 0) {
      typingBubble.classList.remove('hidden');
      const names = typingUids.map(uid => {
        const idx = chat.participants.indexOf(uid);
        return idx !== -1 ? chat.participantNames[idx] : 'Someone';
      }).join(', ');
      typingText.innerText = `${names} ${typingUids.length > 1 ? 'are' : 'is'} typing...`;
      messagesScrollWrapper.scrollTop = messagesScrollWrapper.scrollHeight;
    } else {
      typingBubble.classList.add('hidden');
    }
  }
}

function showApp() { 
  console.log("Switching to App Screen");
  authScreen.classList.add('hidden'); 
  appEl.classList.remove('hidden'); 
}

function showAuth() { 
  authScreen.classList.remove('hidden'); 
  appEl.classList.add('hidden'); 
}

// --- CORE LOGIC ---
async function ensureGlobalChannel() {
  try {
    const globalChatId = "global-square";
    const chatRef = doc(db, "chats", globalChatId);
    const chatSnap = await getDoc(chatRef);
    if (!chatSnap.exists()) {
      await setDoc(chatRef, {
        name: "Public Square", avatar: "/images/group.png", description: "The official Nexus global channel.",
        lastMessage: "Welcome to Nexus!", lastMessageTime: serverTimestamp(), type: 'public', participants: []
      });
    }
  } catch (e) {}
}

function loadChats() {
  const q = query(collection(db, "chats"), orderBy("lastMessageTime", "desc"));
  onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const chat = change.doc.data();
      const chatId = change.doc.id;
      
      // ONLY notify if I am a participant (or it's public)
      const isParticipant = chat.participants?.includes(currentUser.uid) || chat.type === 'public';
      if (!isParticipant) return;

      if (change.type === 'modified') {
        if (chat.lastMessageTime && chat.lastMessageSenderId && chat.lastMessageSenderId !== currentUser.uid) {
          const lastTime = chat.lastMessageTime.toMillis();
          if (!lastProcessedTimes[chatId] || lastTime > lastProcessedTimes[chatId]) {
            lastProcessedTimes[chatId] = lastTime;
            if (activeChatId !== chatId || document.visibilityState === 'hidden') {
              const chatName = chat.type === 'private' ? getPrivateChatName({ id: chatId, ...chat }) : chat.name;
              const chatAvatar = chat.type === 'private' ? getPrivateChatAvatar({ id: chatId, ...chat }) : (chat.avatar || '/images/group.png');
              showNotification(chatName, chat.lastMessage, chatAvatar);
            }
          }
        }
      } else if (change.type === 'added') {
        if (chat.lastMessageTime) lastProcessedTimes[chatId] = chat.lastMessageTime.toMillis();
      }
    });

    chats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(chat => chat.type === 'public' || (chat.participants && chat.participants.includes(currentUser.uid)));
    renderChatList(chatSearch.value); 
    if (activeChatId) renderMessages(activeMessages, msgSearchInput.value);
  });
}

function renderChatList(filter = '') {
  try {
    const filtered = chats.filter(chat => {
    const isPending = chat.status === 'pending';
    const isInitiator = chat.initiator === currentUser.uid;
    const chatName = chat.type === 'private' ? getPrivateChatName(chat) : chat.name;
    const matchesFilter = chatName?.toLowerCase().includes(filter.toLowerCase());
    
    if (currentSidebarTab === 'chats') {
      return (!isPending || isInitiator) && matchesFilter;
    } else {
      return (isPending && !isInitiator) && matchesFilter;
    }
  });

  const pendingCount = chats.filter(c => c.status === 'pending' && c.initiator !== currentUser.uid).length;
  if (pendingCount > 0) {
    requestCountBadge.innerText = pendingCount;
    requestCountBadge.classList.remove('hidden');
  } else {
    requestCountBadge.classList.add('hidden');
  }

  if (filtered.length === 0) {
    chatListEl.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; color: var(--text-muted);">
        <i data-lucide="${currentSidebarTab === 'requests' ? 'user-plus' : 'message-square'}" style="width: 48px; height: 48px; margin-bottom: 16px; opacity: 0.3;"></i>
        <p>${currentSidebarTab === 'requests' ? 'No pending requests' : 'No chats yet'}</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  const html = filtered.map(chat => {
    const isActive = chat.id === activeChatId;
    const chatName = chat.type === 'private' ? getPrivateChatName(chat) : chat.name;
    const chatAvatar = chat.type === 'private' ? getPrivateChatAvatar(chat) : (chat.avatar || '/images/group.png');
    
    let onlineStatusHtml = '';
    if (chat.type === 'private') {
      const otherUid = chat.participants.find(uid => uid !== currentUser.uid);
      if (userStatuses[otherUid]?.isOnline) {
        onlineStatusHtml = '<div class="online-dot"></div>';
      }
    }

    return `
      <div class="chat-item ${isActive ? 'active' : ''}" data-id="${chat.id}">
        <div style="position: relative;">
          <img src="${chatAvatar}" alt="${chatName}" class="avatar">
          ${onlineStatusHtml}
        </div>
        <div class="chat-item-content">
          <div class="chat-item-header">
            <h3>${chatName}</h3>
            <span class="chat-time">${chat.lastMessageTime ? new Date(chat.lastMessageTime.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <p class="chat-preview">${chat.lastMessage || 'Start a conversation'}</p>
            ${chat.unreadCounts?.[currentUser.uid] > 0 ? `<span class="unread-badge">${chat.unreadCounts[currentUser.uid]}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  chatListEl.innerHTML = html;
  document.querySelectorAll('.chat-item').forEach(item => {
    item.onclick = () => switchChat(item.dataset.id);
  });

  } catch (err) {
    console.error("Critical error in renderChatList:", err);
  }
}

function getPrivateChatName(chat) { 
  if (!chat || !chat.participants) return "Direct Chat";
  const index = chat.participants.findIndex(uid => uid !== currentUser.uid);
  return (index !== -1 && chat.participantNames) ? chat.participantNames[index] : "Direct Chat";
}
function getPrivateChatAvatar(chat) { 
  if (!chat || !chat.participants) return "/images/user1.png";
  const index = chat.participants.findIndex(uid => uid !== currentUser.uid);
  return (index !== -1 && chat.participantAvatars) ? chat.participantAvatars[index] : "/images/user1.png";
}

function switchChat(id) {
  console.log("Switching to chat:", id);
  activeChatId = id; 
  const chat = chats.find(c => c.id === id);
  if (!chat) return;

  const chatName = chat.type === 'private' ? getPrivateChatName(chat) : chat.name;
  const chatAvatar = chat.type === 'private' ? getPrivateChatAvatar(chat) : (chat.avatar || '/images/group.png');
  
  welcomeScreen.classList.add('hidden'); 
  activeChatScreen.classList.remove('hidden', 'active'); 
  activeChatScreen.classList.add('active'); 
  document.querySelector('.chat-window').classList.add('active');
  
  activeChatInfo.innerHTML = `
    <img src="${chatAvatar}" alt="${chatName}" class="avatar" id="active-chat-avatar">
    <div class="chat-info-text">
      <h3>${chatName}</h3>
      <span id="header-status" class="header-status">Offline</span>
    </div>`;
  
  activeChatInfo.style.cursor = chat.type === 'group' ? 'pointer' : 'default';
  activeChatInfo.onclick = chat.type === 'group' ? () => {
    // Always find latest chat data before opening info
    const latestChat = chats.find(c => c.id === id);
    openGroupInfo(latestChat);
  } : null;
  
  lucide.createIcons();
  msgSearchBar.classList.add('hidden'); msgSearchInput.value = ''; refreshMessages();
  updateHeaderStatus(chat);
  
  if (chat.status === 'pending' && chat.initiator !== currentUser.uid) {
    requestBanner.classList.remove('hidden');
    requestUserName.innerText = chatName;
    chatFooter.classList.add('hidden');
  } else {
    requestBanner.classList.add('hidden');
    chatFooter.classList.remove('hidden');
    markMessagesAsRead(id); resetUnreadCount(id);
  }
}

async function acceptChat() {
  if (!activeChatId) return;
  const id = activeChatId;
  try {
    // Immediately update UI for better UX
    requestBanner.classList.add('hidden');
    chatFooter.classList.remove('hidden');
    
    await updateDoc(doc(db, "chats", id), { status: 'active' });
    markMessagesAsRead(id); resetUnreadCount(id);
  } catch (error) {
    console.error("Error accepting chat:", error);
    alert("Failed to accept request. Please try again.");
    requestBanner.classList.remove('hidden');
    chatFooter.classList.add('hidden');
  }
}

async function declineChat() {
  if (!activeChatId) return;
  const id = activeChatId;
  
  // Instantly update UI
  activeChatId = null;
  activeChatScreen.classList.add('hidden');
  welcomeScreen.classList.remove('hidden');
  
  try {
    await deleteDoc(doc(db, "chats", id));
  } catch (error) {
    console.error("Error declining chat:", error);
    alert("Failed to completely delete request, but it has been hidden.");
  }
}

// Expose to window for fail-safe inline HTML execution
window.acceptChat = acceptChat;
window.declineChat = declineChat;
window.startPrivateChat = startPrivateChat;

async function markMessagesAsRead(chatId) {
  if (!chatId || !currentUser) return;
  const q = query(collection(db, "chats", chatId, "messages"), where("senderId", "!=", currentUser.uid));
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  let count = 0;
  snap.forEach(d => {
    const data = d.data();
    if (!data.readBy?.includes(currentUser.uid)) {
      batch.update(d.ref, { readBy: arrayUnion(currentUser.uid) });
      count++;
    }
  });
  if (count > 0) await batch.commit();
}

async function resetUnreadCount(chatId) {
  if (!chatId || !currentUser) return;
  await updateDoc(doc(db, "chats", chatId), { [`unreadCounts.${currentUser.uid}`]: 0 });
}

function refreshMessages() {
  if (!activeChatId) return; if (messageListener) messageListener();
  const msgQuery = query(collection(db, "chats", activeChatId, "messages"), orderBy("timestamp", "asc"));
  messageListener = onSnapshot(msgQuery, (snapshot) => { 
    activeMessages = snapshot.docs.map(doc => doc.data()); 
    const currentChat = chats.find(c => c.id === activeChatId);
    renderMessages(activeMessages, msgSearchInput.value); 
    
    // Real-time mark as read
    const unread = snapshot.docs.filter(d => d.data().senderId !== currentUser.uid && !d.data().readBy?.includes(currentUser.uid));
    if (unread.length > 0) {
      const batch = writeBatch(db);
      unread.forEach(d => batch.update(d.ref, { readBy: arrayUnion(currentUser.uid) }));
      batch.commit();
      resetUnreadCount(activeChatId);
    }
  });
}

function formatChatDate(date) {
  const now = new Date();
  const d = new Date(date);
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderMessages(messages, filter = '') {
  const filtered = messages.filter(m => (m.text || '').toLowerCase().includes(filter.toLowerCase()));
  const currentChat = chats.find(c => c.id === activeChatId);
  
  // Skip re-render if nothing significant changed (except read status)
  const messageStateKey = `${activeChatId}-${filtered.length}-${filter}`;
  const isSameState = lastRenderedChatId === messageStateKey;
  
  if (isSameState) {
    updateReadReceipts(filtered, currentChat);
    return;
  }

  let lastDate = null;
  const html = filtered.map(msg => {
    let dateDivider = '';
    if (msg.timestamp) {
      const currentDateStr = msg.timestamp.toDate().toDateString();
      if (currentDateStr !== lastDate) {
        lastDate = currentDateStr;
        dateDivider = `<div class="date-divider"><span>${formatChatDate(msg.timestamp.toDate())}</span></div>`;
      }
    }

    const isSelf = msg.senderId === currentUser.uid;
    const isRead = currentChat?.participants?.filter(p => p !== msg.senderId).every(p => msg.readBy?.includes(p));
    
    // Dynamically get the latest name from chat participants so profile updates reflect immediately
    let displaySenderName = msg.senderName;
    if (currentChat && currentChat.participants && currentChat.participantNames) {
      const idx = currentChat.participants.indexOf(msg.senderId);
      if (idx !== -1 && currentChat.participantNames[idx]) {
        displaySenderName = currentChat.participantNames[idx];
      }
    }

    let replySenderName = msg.replyTo?.senderName || '';
    if (msg.replyTo && currentChat && currentChat.participants && currentChat.participantNames) {
      const rIdx = currentChat.participants.indexOf(msg.replyTo.senderId);
      if (rIdx !== -1 && currentChat.participantNames[rIdx]) {
        replySenderName = currentChat.participantNames[rIdx];
      }
    }
    
    return dateDivider + `
      <div class="message ${isSelf ? 'self' : 'other'}" id="msg-${msg.id}" data-sender="${displaySenderName.replace(/'/g, "\\'")}" data-text="${(msg.text || 'Photo').replace(/'/g, "\\'")}">
        <div class="swipe-indicator"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg></div>
        ${!isSelf ? `<span style="font-size: 0.7rem; color: var(--accent); display: block; margin-bottom: 4px;">${displaySenderName}</span>` : ''}
        ${msg.replyTo ? `
          <div class="quoted-message" onclick="document.getElementById('msg-${msg.replyTo.id}')?.scrollIntoView({behavior:'smooth'})">
            <strong>${replySenderName}</strong>
            ${msg.replyTo.text || 'Photo'}
          </div>
        ` : ''}
        ${msg.imageUrl ? `<img src="${msg.imageUrl}" class="message-image" alt="Shared image" onclick="window.open('${msg.imageUrl}', '_blank')">` : ''}
        ${msg.text ? `<p>${msg.text}</p>` : ''}
        <div class="message-time">
          ${msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Just now'}
          ${isSelf ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${isRead ? '#34B7F1' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="status-icon ${isRead ? 'read' : 'delivered'}"><polyline points="20 6 9 17 4 12"></polyline><polyline points="14 6 7 13 4 10"></polyline></svg>` : ''}
        </div>
        <div class="message-reply-btn" onclick="window.setReply('${msg.id}', '${msg.senderName.replace(/'/g, "\\'")}', '${(msg.text || 'Photo').replace(/'/g, "\\'")}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>
        </div>
      </div>
    `;
  }).join(''); 

  messagesContainer.innerHTML = html;
  lastRenderedChatId = messageStateKey;
  
  if (window.twemoji) twemoji.parse(messagesContainer);
  messagesScrollWrapper.scrollTop = messagesScrollWrapper.scrollHeight;
}

function updateReadReceipts(messages, chat) {
  messages.forEach(msg => {
    if (msg.senderId === currentUser.uid) {
      const el = document.getElementById(`msg-${msg.id}`);
      if (el) {
        const icon = el.querySelector('.status-icon');
        if (icon) {
          const isRead = chat?.participants?.filter(p => p !== msg.senderId).every(p => msg.readBy?.includes(p));
          icon.style.stroke = isRead ? '#34B7F1' : 'currentColor';
          icon.classList.toggle('read', isRead);
        }
      }
    }
  });
}

window.setReply = function(id, name, text) {
  replyingToMessage = { id, senderName: name, text };
  document.getElementById('reply-preview-name').innerText = name;
  document.getElementById('reply-preview-text').innerText = text;
  document.getElementById('reply-preview').classList.remove('hidden');
  messageInput.focus();
};

function cancelReply() {
  replyingToMessage = null;
  document.getElementById('reply-preview').classList.add('hidden');
}

async function sendMessage() {
  const text = messageInput.value.trim(); if (!text && !replyingToMessage) return;
  if (!text || !activeChatId) return;
  const chatRef = doc(db, "chats", activeChatId); const msgRef = doc(collection(chatRef, "messages"));
  const msgId = msgRef.id;
  messageInput.value = '';
  
  const msgData = { id: msgId, text, senderId: currentUser.uid, senderName: currentUser.name, timestamp: serverTimestamp(), readBy: [currentUser.uid] };
  if (replyingToMessage) { msgData.replyTo = replyingToMessage; cancelReply(); }
  
  await setDoc(msgRef, msgData);

  const chat = chats.find(c => c.id === activeChatId);
  const updates = { lastMessage: text, lastMessageTime: serverTimestamp(), lastMessageSenderId: currentUser.uid };
  chat.participants.forEach(p => { if (p !== currentUser.uid) updates[`unreadCounts.${p}`] = increment(1); });
  await updateDoc(chatRef, updates);
}

let pendingImageFile = null;

function showImagePreview(file) {
  pendingImageFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('preview-img').src = e.target.result;
    document.getElementById('image-preview-modal').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

document.getElementById('cancel-preview-btn-modal')?.addEventListener('click', () => {
  document.getElementById('image-preview-modal').classList.add('hidden');
  pendingImageFile = null;
});

document.getElementById('confirm-send-img-btn')?.addEventListener('click', () => {
  if (pendingImageFile) {
    uploadChatImage(pendingImageFile);
    document.getElementById('image-preview-modal').classList.add('hidden');
    pendingImageFile = null;
  }
});

async function uploadChatImage(file) {
  if (!file || !activeChatId) return;
  const chatRef = doc(db, "chats", activeChatId); 
  const msgRef = doc(collection(chatRef, "messages"));
  const msgId = msgRef.id;
  try {
    const ext = file.name.split('.').pop();
    const storageRef = ref(storage, `chat_images/${activeChatId}/${Date.now()}.${ext}`);
    await uploadBytes(storageRef, file);
    const imageUrl = await getDownloadURL(storageRef);
    const msgData = { id: msgId, text: '', imageUrl, senderId: currentUser.uid, senderName: currentUser.name, timestamp: serverTimestamp(), readBy: [currentUser.uid] };
    await setDoc(msgRef, msgData);
    await setDoc(chatRef, { lastMessage: '📷 Image', lastMessageTime: serverTimestamp(), lastMessageSenderId: currentUser.uid }, { merge: true });
  } catch (error) {
    console.error("Image upload failed", error);
    alert("Failed to send image.");
  }
}

async function showUserList(filter = '') {
  userListEl.innerHTML = '<div style="padding: 20px; text-align: center;"><i data-lucide="loader" class="animate-spin"></i></div>'; lucide.createIcons();
  const snapshot = await getDocs(collection(db, "users"));
  const users = snapshot.docs.map(doc => doc.data()).filter(u => u.uid !== currentUser.uid && (u.name?.toLowerCase().includes(filter.toLowerCase()) || (u.username && u.username.toLowerCase().includes(filter.toLowerCase()))));
  
  userListEl.innerHTML = users.length === 0 ? '<p style="padding: 20px; text-align: center; color: var(--text-muted);">No users found.</p>' : users.map(user => `
    <div class="user-item">
      <div class="user-item-info" data-uid="${user.uid}" data-name="${user.name}" data-avatar="${user.avatar}" data-username="${user.username}" style="display: flex; align-items: center; flex: 1;">
        <img src="${user.avatar}" alt="${user.name}">
        <div><h4>${user.name}</h4><p>@${user.username || 'unknown'}</p></div>
      </div>
      <button class="follow-btn" onclick="startPrivateChat('${user.uid}', '${user.name.replace(/'/g, "\\'")}', '${user.avatar}', '${user.username}')">Message</button>
    </div>
  `).join('');

  // Populate Group User List (All Users)
  groupUserList.innerHTML = users.length === 0 ? '<p style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No users available.</p>' : users.map(user => `
    <div class="user-item" style="padding: 8px 16px;">
      <div style="display: flex; align-items: center; flex: 1;">
        <img src="${user.avatar}" alt="${user.name}" style="width: 32px; height: 32px;">
        <div style="margin-left: 12px;"><h4>${user.name}</h4><p style="font-size: 0.7rem;">@${user.username || 'unknown'}</p></div>
      </div>
      <input type="checkbox" class="group-member-cb" value="${user.uid}" data-name="${user.name}" data-username="${user.username}" data-avatar="${user.avatar}" style="width: 18px; height: 18px; cursor: pointer;">
    </div>
  `).join('');
}

async function createGroupChat() {
  const name = groupNameInput.value.trim();
  if (!name) { alert("Please enter a group name."); return; }
  const selectedCbs = Array.from(document.querySelectorAll('.group-member-cb:checked'));
  if (selectedCbs.length === 0) { alert("Please select at least one other member."); return; }
  
  confirmCreateGroupBtn.disabled = true; confirmCreateGroupBtn.innerHTML = "Creating...";
  try {
    const participants = [currentUser.uid, ...selectedCbs.map(cb => cb.value)];
    const participantNames = [currentUser.name, ...selectedCbs.map(cb => cb.dataset.name)];
    const participantUsernames = [currentUser.username, ...selectedCbs.map(cb => cb.dataset.username)];
    const participantAvatars = [currentUser.avatar, ...selectedCbs.map(cb => cb.dataset.avatar)];
    
    const docRef = await addDoc(collection(db, "chats"), {
      type: 'group',
      name: name,
      avatar: '/images/group.png',
      participants,
      participantNames,
      participantUsernames,
      participantAvatars,
      createdBy: currentUser.uid,
      lastMessage: "Group created",
      lastMessageTime: serverTimestamp()
    });
    
    createGroupModal.classList.add('hidden');
    newChatModal.classList.add('hidden');
    switchChat(docRef.id);
  } catch(e) {
    console.error(e);
    alert("Failed to create group.");
  } finally {
    confirmCreateGroupBtn.disabled = false; confirmCreateGroupBtn.innerHTML = "Create Group";
  }
}

async function startPrivateChat(uid, name, avatar, username) {
  if (!uid || uid === currentUser.uid) return;
  let chat = chats.find(c => c.type === 'private' && c.participants.includes(uid));
  if (chat) { switchChat(chat.id); newChatModal.classList.add('hidden'); return; }
  
  const participants = [currentUser.uid, uid];
  const participantNames = [currentUser.name, name];
  const participantUsernames = [currentUser.username, username];
  const participantAvatars = [currentUser.avatar, avatar];

  const docRef = await addDoc(collection(db, "chats"), {
    type: 'private',
    participants,
    participantNames,
    participantUsernames,
    participantAvatars,
    status: 'pending',
    initiator: currentUser.uid,
    lastMessage: "New Chat Request",
    lastMessageTime: serverTimestamp(),
    unreadCounts: { [uid]: 1, [currentUser.uid]: 0 }
  });
  
  newChatModal.classList.add('hidden');
  switchChat(docRef.id);
}

// --- REAL WebRTC CALLING LOGIC ---

async function startCall(type) {
  if (!activeChatId) return;
  const chat = chats.find(c => c.id === activeChatId);
  if (chat.type === 'public' || chat.type === 'group') { alert("Calls are only supported in 1-on-1 private chats."); return; }
  const otherUid = chat.participants.find(uid => uid !== currentUser.uid);
  currentCallUserId = otherUid;

  callName.innerText = getPrivateChatName(chat);
  callAvatar.src = getPrivateChatAvatar(chat);
  callStatus.innerText = "Initializing P2P...";
  acceptCallBtn.classList.add('hidden');
  callOverlay.classList.remove('hidden');

  peerConnection = new RTCPeerConnection(servers);
  remoteStream = new MediaStream();

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection && ['disconnected', 'failed', 'closed'].includes(peerConnection.connectionState)) {
      endCall();
    }
  };

  localStream = await navigator.mediaDevices.getUserMedia({ video: type === 'Video', audio: true });
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  localVideo.srcObject = localStream;
  if (type === 'Video') localVideo.classList.remove('hidden');
  videoContainer.style.display = 'block';

  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    remoteVideo.srcObject = remoteStream;
    remoteVideo.play().catch(e => console.error("Playback failed", e));
    ringingInfo.style.opacity = '0';
    setTimeout(() => ringingInfo.classList.add('hidden'), 400);
  };

  const callDoc = doc(collection(db, "calls"), otherUid);
  const offerCandidates = collection(callDoc, "offerCandidates");
  const answerCandidates = collection(callDoc, "answerCandidates");

  peerConnection.onicecandidate = (event) => {
    event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
  };

  try {
    const offerDescription = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offerDescription);

    const offer = {
      sdp: offerDescription.sdp, type: offerDescription.type, from: currentUser.uid, 
      fromName: currentUser.name, fromAvatar: currentUser.avatar, callType: type, timestamp: serverTimestamp()
    };

    await setDoc(callDoc, { offer });
    console.log("Call offer sent successfully to:", otherUid);
  } catch (e) {
    console.error("Failed to start call signaling:", e);
    alert("Could not start call. Please check your camera/mic permissions.");
    endCall();
  }

  onSnapshot(callDoc, (snapshot) => {
    if (!snapshot.exists()) {
      endCall();
      return;
    }
    const data = snapshot.data();
    if (peerConnection && !peerConnection.currentRemoteDescription && data?.answer) {
      peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
        .then(() => {
          onSnapshot(answerCandidates, (candSnapshot) => {
            candSnapshot.docChanges().forEach((change) => {
              if (change.type === 'added') peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            });
          });
        })
        .catch(console.error);
    }
  });
}

function listenForCalls() {
  const callRef = doc(db, "calls", currentUser.uid);
  onSnapshot(callRef, async (snapshot) => {
    const data = snapshot.data();
    if (data?.offer && !peerConnection) {
      showIncomingCall(data.offer);
    } else if (!snapshot.exists()) {
      endCall();
    }
  });
}

function showIncomingCall(data) {
  callName.innerText = data.fromName;
  callAvatar.src = data.fromAvatar;
  callStatus.innerText = `Incoming ${data.callType} Call...`;
  acceptCallBtn.classList.remove('hidden');
  callOverlay.classList.remove('hidden');
  acceptCallBtn.onclick = () => acceptCall(data.from, data.callType);
}

async function acceptCall(callerUid, callType) {
  acceptCallBtn.classList.add('hidden');
  callStatus.innerText = "Connecting...";
  currentCallUserId = callerUid;
  peerConnection = new RTCPeerConnection(servers);
  remoteStream = new MediaStream();

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection && ['disconnected', 'failed', 'closed'].includes(peerConnection.connectionState)) {
      endCall();
    }
  };

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: callType === 'Video', audio: true });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    localVideo.srcObject = localStream;
    if (callType === 'Video') localVideo.classList.remove('hidden');
    videoContainer.style.display = 'block';

    peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
      remoteVideo.srcObject = remoteStream;
      remoteVideo.play().catch(e => console.error("Playback failed", e));
      ringingInfo.style.opacity = '0';
      setTimeout(() => ringingInfo.classList.add('hidden'), 400);
    };

    const callDoc = doc(db, "calls", currentUser.uid);
    const offerCandidates = collection(callDoc, "offerCandidates");
    const answerCandidates = collection(callDoc, "answerCandidates");

    peerConnection.onicecandidate = (event) => {
      event.candidate && addDoc(answerCandidates, event.candidate.toJSON());
    };

    const callData = (await getDoc(callDoc)).data();
    if (!callData?.offer) { endCall(); return; }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
    const answerDescription = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answerDescription);

    await updateDoc(callDoc, { answer: { type: answerDescription.type, sdp: answerDescription.sdp } });

    onSnapshot(offerCandidates, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(e => {});
        }
      });
    });
  } catch (e) {
    console.error("Call acceptance failed:", e);
    alert("Could not access camera/microphone.");
    endCall();
  }
}

function toggleMic() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks()[0].enabled = !isMuted;
  toggleMicBtn.classList.toggle('muted', isMuted);
  const icon = toggleMicBtn.querySelector('i');
  icon.setAttribute('data-lucide', isMuted ? 'mic-off' : 'mic');
  lucide.createIcons();
}

function toggleVideo() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) {
    alert("This is an audio-only call.");
    return;
  }
  isVideoOff = !isVideoOff;
  videoTrack.enabled = !isVideoOff;
  toggleVideoBtn.classList.toggle('muted', isVideoOff);
  const icon = toggleVideoBtn.querySelector('i');
  icon.setAttribute('data-lucide', isVideoOff ? 'video-off' : 'video');
  lucide.createIcons();
  localVideo.style.opacity = isVideoOff ? '0' : '1';
}

async function endCall() {
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  
  callOverlay.classList.add('hidden');
  videoContainer.style.display = 'none';
  acceptCallBtn.classList.add('hidden');
  ringingInfo.style.opacity = '1';
  ringingInfo.classList.remove('hidden');
  localVideo.classList.add('hidden');
  deleteDoc(doc(db, "calls", currentUser.uid)).catch(()=>{});
  if (currentCallUserId) {
    deleteDoc(doc(db, "calls", currentCallUserId)).catch(()=>{});
    currentCallUserId = null;
  }
  isMuted = false; isVideoOff = false;
  toggleMicBtn.classList.remove('muted'); toggleVideoBtn.classList.remove('muted');
  toggleMicBtn.querySelector('i').setAttribute('data-lucide', 'mic');
  toggleVideoBtn.querySelector('i').setAttribute('data-lucide', 'video');
  lucide.createIcons();
}

async function toggleScreenShare() {
  // Check if screen sharing is supported (not available on most mobile browsers)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    alert('Screen sharing is not supported on this device. This feature is only available on desktop browsers.');
    return;
  }

  // Additional mobile detection
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
  if (isMobile) {
    alert('Screen sharing is not supported on mobile devices. Please use a desktop browser for this feature.');
    return;
  }

  if (!peerConnection) return;
  const videoSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
  if (!videoSender) return;

  if (screenStream) {
    // Stop sharing
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) videoSender.replaceTrack(videoTrack);
    shareScreenBtn.classList.remove('muted');
    shareScreenBtn.querySelector('i').setAttribute('data-lucide', 'monitor-up');
  } else {
    // Start sharing
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      videoSender.replaceTrack(screenTrack);

      screenTrack.onended = () => {
        // Automatically revert to camera if user stops sharing via browser banner
        screenStream = null;
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) videoSender.replaceTrack(videoTrack);
        shareScreenBtn.classList.remove('muted');
        shareScreenBtn.querySelector('i').setAttribute('data-lucide', 'monitor-up');
        lucide.createIcons();
      };

      shareScreenBtn.classList.add('muted');
      shareScreenBtn.querySelector('i').setAttribute('data-lucide', 'monitor-off');
    } catch (e) {
      console.error("Screen share failed", e);
      alert('Failed to start screen sharing. Please make sure you have granted the necessary permissions.');
    }
  }
  lucide.createIcons();
}

function isAdmin(chat) {
  if (!chat || !currentUser) return false;
  const adminUid = chat.createdBy || chat.participants?.[0];
  return adminUid === currentUser.uid;
}

async function openGroupInfo(chat) {
  const modal = document.getElementById('group-info-modal');
  const img = document.getElementById('group-info-img');
  const name = document.getElementById('group-info-name');
  const memberList = document.getElementById('group-info-member-list');
  const memberLabel = document.getElementById('member-count-label');
  const editBtn = document.getElementById('edit-group-img-btn');

  const adminUid = chat.createdBy || chat.participants?.[0];
  const isUserAdmin = isAdmin(chat);

  // Auto-fix for older groups: if createdBy is missing, set it to the first participant
  if (!chat.createdBy && chat.participants?.length > 0) {
    updateDoc(doc(db, "chats", chat.id), { createdBy: chat.participants[0] }).catch(()=>{});
  }

  img.src = chat.avatar || '/images/group.png';
  name.innerHTML = chat.name + (isUserAdmin ? ' <button id="edit-group-name-btn" class="icon-btn" style="display:inline; padding:2px;"><i data-lucide="edit-2" style="width:14px;"></i></button>' : '');
  memberLabel.innerText = `Members (${chat.participants.length})`;
  
  if (isUserAdmin) {
    editBtn.classList.remove('hidden');
    openAddMembersBtn.classList.remove('hidden');
  } else {
    editBtn.classList.add('hidden');
    openAddMembersBtn.classList.add('hidden');
  }

  memberList.innerHTML = chat.participants.map((uid, idx) => `
    <div class="user-item" style="padding: 10px 16px; border-bottom: 1px solid var(--border);">
      <div style="display: flex; align-items: center; flex: 1;">
        <img src="${chat.participantAvatars[idx]}" style="width: 32px; height: 32px; border-radius: 50%;">
        <div style="margin-left: 12px;">
          <h4 style="font-size: 0.9rem;">${chat.participantNames[idx]} ${uid === adminUid ? '<span style="color:var(--accent); font-size:0.6rem; border:1px solid var(--accent); padding:1px 4px; border-radius:4px; margin-left:5px;">ADMIN</span>' : ''}</h4>
          <p style="font-size: 0.7rem; color: var(--text-muted);">@${chat.participantUsernames[idx]}</p>
        </div>
      </div>
    </div>
  `).join('');

  const leaveBtn = document.getElementById('leave-group-btn');
  if (leaveBtn) {
    leaveBtn.innerText = isUserAdmin ? "Dismantle Group" : "Leave Group";
    leaveBtn.style.background = isUserAdmin ? "hsl(0, 80%, 40%)" : "hsl(0, 70%, 50%)";
  }

  lucide.createIcons();
  modal.classList.remove('hidden');

  // --- ADDED: ENSURE ALL MODAL BUTTONS ARE FUNCTIONAL EVERY TIME IT OPENS ---
  
  // Close Button
  const closeBtn = document.getElementById('close-group-info');
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.preventDefault();
      modal.classList.add('hidden');
    };
  }

  // Add Members Button & its internal listeners
  if (openAddMembersBtn) {
    openAddMembersBtn.onclick = (e) => {
      e.preventDefault();
      addMembersModal.classList.remove('hidden');
      addMembersSearchInput.value = '';
      showAddMembersList();
      
      // Ensure Add Modal buttons work
      closeAddMembers.onclick = () => addMembersModal.classList.add('hidden');
      addMembersSearchInput.oninput = (ev) => showAddMembersList(ev.target.value);
      confirmAddMembersBtn.onclick = () => addMembersToGroup();
    };
  }

  // Dismantle / Leave Button
  if (leaveBtn) {
    leaveBtn.onclick = (e) => {
      e.preventDefault();
      leaveGroup();
    };
  }

  // Rename Button (Existing)
  const editNameBtn = document.getElementById('edit-group-name-btn');
  if (editNameBtn) {
    editNameBtn.onclick = async (e) => {
      e.preventDefault();
      const newName = prompt("Enter new group name:", chat.name);
      if (newName && newName !== chat.name) {
        await updateDoc(doc(db, "chats", chat.id), { name: newName });
        openGroupInfo({ ...chat, name: newName }); 
      }
    };
  }

  // DP Edit click directly here for absolute reliability
  editBtn.onclick = (e) => {
    e.preventDefault();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (ev) => {
      const file = ev.target.files[0];
      if (!file || !activeChatId) return;
      const ext = file.name.split('.').pop();
      const storageRef = ref(storage, `group_avatars/${activeChatId}.${ext}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, "chats", activeChatId), { avatar: url });
      img.src = url;
      const headerAvatar = document.getElementById('active-chat-avatar');
      if (headerAvatar) headerAvatar.src = url;
    };
    input.click();
  };
}

async function leaveGroup() {
  if (!activeChatId || !confirm("Are you sure you want to leave this group?")) return;
  const chat = chats.find(c => c.id === activeChatId);
  const isUserAdmin = isAdmin(chat);

  if (isUserAdmin) {
    if (!confirm("You are the ADMIN. Leaving will DISMANTLE (delete) the group for everyone. Continue?")) return;
    await deleteDoc(doc(db, "chats", activeChatId));
    document.getElementById('group-info-modal').classList.add('hidden');
    activeChatScreen.classList.add('hidden');
    welcomeScreen.classList.remove('hidden');
    activeChatId = null;
    return;
  }

  const idx = chat.participants.indexOf(currentUser.uid);
  if (idx !== -1) {
    const participants = [...chat.participants];
    const names = [...chat.participantNames];
    const usernames = [...chat.participantUsernames];
    const avatars = [...chat.participantAvatars];

    participants.splice(idx, 1);
    names.splice(idx, 1);
    usernames.splice(idx, 1);
    avatars.splice(idx, 1);

    await updateDoc(doc(db, "chats", activeChatId), {
      participants,
      participantNames: names,
      participantUsernames: usernames,
      participantAvatars: avatars
    });

    const msgRef = collection(doc(db, "chats", activeChatId), "messages");
    await addDoc(msgRef, {
      text: `${currentUser.name} left the group`,
      senderId: 'system',
      senderName: 'System',
      timestamp: serverTimestamp()
    });

    document.getElementById('group-info-modal').classList.add('hidden');
    activeChatScreen.classList.add('hidden');
    welcomeScreen.classList.remove('hidden');
    activeChatId = null;
  }
}

async function showAddMembersList(filter = '') {
  if (!activeChatId) return;
  const chat = chats.find(c => c.id === activeChatId);
  if (!chat) return;

  const snapshot = await getDocs(collection(db, "users"));
  const users = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }))
    .filter(u => {
      const isMe = u.uid === currentUser.uid;
      const alreadyIn = chat.participants && chat.participants.includes(u.uid);
      return !isMe && !alreadyIn;
    });

  const filtered = users.filter(u => {
    const term = filter.toLowerCase();
    return u.name.toLowerCase().includes(term) || (u.username && u.username.toLowerCase().includes(term));
  });

  addMembersListEl.innerHTML = filtered.map(u => `
    <div class="user-item">
      <input type="checkbox" value="${u.uid}" data-name="${u.name}" data-username="${u.username || ''}" data-avatar="${u.avatar || '/images/user1.png'}" style="margin-right: 15px; width: 22px; height: 22px; cursor:pointer;">
      <img src="${u.avatar || '/images/user1.png'}" alt="${u.name}" class="avatar" style="width:40px; height:40px; border-radius:50%;">
      <div class="user-item-info">
        <h4 style="font-size:0.95rem;">${u.name}</h4>
        <p style="font-size:0.75rem; color:var(--text-muted);">@${u.username || 'user'}</p>
      </div>
    </div>
  `).join('');

  if (filtered.length === 0) {
    addMembersListEl.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">No more users to add.</div>';
  }
}

async function addMembersToGroup() {
  if (!activeChatId) return;
  const selectedCbs = Array.from(addMembersListEl.querySelectorAll('input[type="checkbox"]:checked'));
  if (selectedCbs.length === 0) return;

  confirmAddMembersBtn.disabled = true;
  confirmAddMembersBtn.innerText = "Adding...";

  const newUids = selectedCbs.map(cb => cb.value);
  const newNames = selectedCbs.map(cb => cb.dataset.name);
  const newUsernames = selectedCbs.map(cb => cb.dataset.username);
  const newAvatars = selectedCbs.map(cb => cb.dataset.avatar);

  const chat = chats.find(c => c.id === activeChatId);
  const updatedParticipants = [...chat.participants, ...newUids];
  const updatedNames = [...chat.participantNames, ...newNames];
  const updatedUsernames = [...chat.participantUsernames, ...newUsernames];
  const updatedAvatars = [...chat.participantAvatars, ...newAvatars];

  await updateDoc(doc(db, "chats", activeChatId), {
    participants: updatedParticipants,
    participantNames: updatedNames,
    participantUsernames: updatedUsernames,
    participantAvatars: updatedAvatars
  });

  const msgRef = collection(doc(db, "chats", activeChatId), "messages");
  await addDoc(msgRef, {
    text: `Admin added ${newNames.join(', ')}`,
    senderId: 'system',
    senderName: 'System',
    timestamp: serverTimestamp()
  });

  addMembersModal.classList.add('hidden');
  confirmAddMembersBtn.disabled = false;
  confirmAddMembersBtn.innerText = "Add Selected";
  
  const latestChat = chats.find(c => c.id === activeChatId);
  openGroupInfo(latestChat);
}

// --- UI HELPERS ---
function applyTheme() {
  document.body.classList.toggle('light-theme', !isDarkTheme);
  const themeIcons = [themeToggleBtn, settingsThemeToggleBtn];
  themeIcons.forEach(btn => { if (btn) { const icon = btn.querySelector('i'); if (icon) icon.setAttribute('data-lucide', isDarkTheme ? 'moon' : 'sun'); } });
  lucide.createIcons();
}

async function toggleTheme() {
  isDarkTheme = !isDarkTheme; applyTheme();
  if (currentUser) await setDoc(doc(db, "users", currentUser.uid), { theme: isDarkTheme ? 'dark' : 'light' }, { merge: true });
}

async function isUsernameUnique(username, uid) {
  const q = query(collection(db, "users"), where("username", "==", username.toLowerCase()), limit(1));
  const snapshot = await getDocs(q);
  return snapshot.empty || snapshot.docs[0].id === uid;
}

async function handleAvatarUpload(file) {
  if (!file) return;
  editAvatarBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i>';
  lucide.createIcons();
  try {
    const storageRef = ref(storage, `avatars/${currentUser.uid}`);
    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);
    currentUser.avatar = downloadURL;
    myProfileImg.src = downloadURL;
    document.querySelector('.user-profile img').src = downloadURL;
    await setDoc(doc(db, "users", currentUser.uid), { avatar: downloadURL }, { merge: true });
    editAvatarBtn.innerHTML = '<i data-lucide="camera"></i>';
    lucide.createIcons();
  } catch (error) {
    alert("Upload failed.");
    editAvatarBtn.innerHTML = '<i data-lucide="camera"></i>';
    lucide.createIcons();
  }
}

function setupEventListeners() {
  loginBtn.addEventListener('click', handleLogin); sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
  messageInput.addEventListener('input', () => {
    if (!activeChatId) return;
    if (!typingTimeout) {
      updateDoc(doc(db, "chats", activeChatId), { [`typing.${currentUser.uid}`]: true });
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      updateDoc(doc(db, "chats", activeChatId), { [`typing.${currentUser.uid}`]: false });
      typingTimeout = null;
    }, 2000);
  });
  attachBtn.addEventListener('click', () => chatImageUpload.click());
  chatImageUpload.addEventListener('change', (e) => {
    if (e.target.files[0]) showImagePreview(e.target.files[0]);
    e.target.value = '';
  });
  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle('hidden');
  });
  emojiPicker.addEventListener('emoji-click', event => {
    messageInput.value += event.detail.unicode;
    emojiPicker.classList.add('hidden');
    messageInput.focus();
  });
  themeToggleBtn.addEventListener('click', toggleTheme); settingsThemeToggleBtn.addEventListener('click', toggleTheme);
  chatSearch.addEventListener('input', (e) => renderChatList(e.target.value));
  backBtn.addEventListener('click', () => { 
    activeChatScreen.classList.remove('active', 'hidden'); 
    welcomeScreen.classList.remove('hidden'); 
    activeChatScreen.classList.add('hidden'); 
    document.querySelector('.chat-window').classList.remove('active');
    // On mobile, show the sidebar again
    if (window.innerWidth <= 900) {
      // The sidebar is always visible on mobile, so this should work
    }
  });
  profileBtn.addEventListener('click', () => profileModal.classList.remove('hidden'));
  closeProfile.addEventListener('click', () => profileModal.classList.add('hidden'));
  editAvatarBtn.addEventListener('click', () => avatarInput.click());
  avatarInput.addEventListener('change', (e) => handleAvatarUpload(e.target.files[0]));
  saveProfileBtn.addEventListener('click', async () => {
    const newUsername = myUsernameInput.value.trim().toLowerCase(); const newName = myNameInput.value.trim();
    if (!newUsername || newUsername.length < 3) { alert("Username min 3 chars."); return; }
    saveProfileBtn.disabled = true; const unique = await isUsernameUnique(newUsername, currentUser.uid);
    if (!unique) { alert("Username taken!"); saveProfileBtn.disabled = false; return; }
    currentUser.name = newName; currentUser.username = newUsername; currentUser.status = myStatusInput.value;
    
    // Save to users collection
    await setDoc(doc(db, "users", currentUser.uid), currentUser, { merge: true });
    
    // Sync profile changes to all chats the user is in
    try {
      const chatsQuery = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
      const chatsSnap = await getDocs(chatsQuery);
      const batch = writeBatch(db);
      chatsSnap.forEach(chatDoc => {
        const chatData = chatDoc.data();
        const pIndex = chatData.participants.indexOf(currentUser.uid);
        if (pIndex !== -1) {
          const names = chatData.participantNames || [];
          const usernames = chatData.participantUsernames || [];
          const avatars = chatData.participantAvatars || [];
          
          names[pIndex] = newName;
          usernames[pIndex] = newUsername;
          avatars[pIndex] = currentUser.avatar;

          batch.update(chatDoc.ref, { 
            participantNames: names,
            participantUsernames: usernames,
            participantAvatars: avatars
          });
        }
      });
      await batch.commit();
    } catch(e) { console.error("Failed to sync profile to chats", e); }

    updateProfileUI(); profileModal.classList.add('hidden'); saveProfileBtn.disabled = false;
  });
  newChatBtn.addEventListener('click', () => { newChatModal.classList.remove('hidden'); showUserList(); });
  closeNewChat.addEventListener('click', () => newChatModal.classList.add('hidden'));
  userSearchInput.addEventListener('input', (e) => showUserList(e.target.value));
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); mainMenu.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => { 
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
      emojiPicker.classList.add('hidden');
    }
    mainMenu.classList.add('hidden'); 
  });
  logoutBtn.addEventListener('click', async () => { if(confirm('Log out?')) { await updateUserStatus(false); signOut(auth); } });
  menuProfileBtn.addEventListener('click', () => profileModal.classList.remove('hidden'));
  menuSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
  menuHelpBtn.addEventListener('click', () => helpModal.classList.remove('hidden'));
  closeSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
  closeHelp.addEventListener('click', () => helpModal.classList.add('hidden'));
  phoneBtn?.addEventListener('click', () => startCall('Audio'));
  videoBtn?.addEventListener('click', () => startCall('Video'));
  
  openCreateGroupBtn.addEventListener('click', () => { createGroupModal.classList.remove('hidden'); groupNameInput.value = ''; });
  closeCreateGroup.addEventListener('click', () => createGroupModal.classList.add('hidden'));
  confirmCreateGroupBtn.addEventListener('click', createGroupChat);

  endCallBtn.addEventListener('click', endCall);
  toggleMicBtn.addEventListener('click', toggleMic);
  toggleVideoBtn.addEventListener('click', toggleVideo);
  shareScreenBtn.addEventListener('click', toggleScreenShare);
  document.getElementById('cancel-reply-btn')?.addEventListener('click', cancelReply);
  msgSearchToggle.addEventListener('click', () => { msgSearchBar.classList.toggle('hidden'); if (!msgSearchBar.classList.contains('hidden')) msgSearchInput.focus(); else { msgSearchInput.value = ''; renderMessages(activeMessages); } });
  closeMsgSearch.addEventListener('click', () => { msgSearchBar.classList.add('hidden'); msgSearchInput.value = ''; renderMessages(activeMessages); });
  msgSearchInput.addEventListener('input', (e) => renderMessages(activeMessages, e.target.value));
  
  acceptRequestBtn.addEventListener('click', acceptChat);
  declineRequestBtn.addEventListener('click', declineChat);
  closeAddMembers.addEventListener('click', () => addMembersModal.classList.add('hidden'));
  addMembersSearchInput.addEventListener('input', (e) => showAddMembersList(e.target.value));
  confirmAddMembersBtn.addEventListener('click', addMembersToGroup);

  // --- FINAL FAIL-SAFE: Capture clicks at the window level for these specific IDs ---
  window.addEventListener('click', (e) => {
    const chatBtn = e.target.closest('#chats-tab');
    const reqBtn = e.target.closest('#requests-tab');
    if (chatBtn) { e.preventDefault(); window.handleTabClick('chats'); }
    if (reqBtn) { e.preventDefault(); window.handleTabClick('requests'); }
  }, true); // Use capture phase

  // --- SWIPE TO REPLY LOGIC ---
  messagesContainer.addEventListener('touchstart', (e) => handleStart(e.touches[0].clientX, e.target, e), { passive: false });
  messagesContainer.addEventListener('touchmove', (e) => handleMove(e.touches[0].clientX, e), { passive: false });
  messagesContainer.addEventListener('touchend', (e) => handleEnd(e.changedTouches[0].clientX), { passive: true });
  messagesContainer.addEventListener('touchcancel', (e) => { if (isSwiping) handleEnd(startX); }, { passive: true });

  messagesContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    handleStart(e.clientX, e.target, e);
  });

  // Prevent text selection during swipe
  messagesContainer.addEventListener('selectstart', (e) => {
    if (isSwiping) e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => { if (isSwiping) { e.preventDefault(); handleMove(e.clientX, e); } });
  window.addEventListener('mouseup', (e) => { if (isSwiping) handleEnd(e.clientX); });
}

function updateProfileUI() { if (!currentUser) return; document.querySelector('.user-profile img').src = currentUser.avatar; document.getElementById('my-profile-img').src = currentUser.avatar; myNameInput.value = currentUser.name; myUsernameInput.value = currentUser.username || ''; myStatusInput.value = currentUser.status; }
function init() { setupEventListeners(); }
init();
