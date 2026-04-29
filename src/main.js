import './style.css';
import { auth, googleProvider, db, storage } from './firebase';
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, where, doc, getDoc, setDoc, getDocs, limit, deleteDoc, updateDoc, arrayUnion, arrayRemove, writeBatch } from "firebase/firestore";
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
const closeCreateGroup = document.getElementById('close-create-group');
const openCreateGroupBtn = document.getElementById('open-create-group-btn');
const groupUserList = document.getElementById('group-user-list');
const confirmCreateGroupBtn = document.getElementById('confirm-create-group-btn');
const groupNameInput = document.getElementById('group-name-input');

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
        name: "Public Square", avatar: "/images/bot.png", description: "The official Nexus global channel.",
        lastMessage: "Welcome to Nexus!", lastMessageTime: serverTimestamp(), type: 'public', participants: []
      });
    }
  } catch (e) {}
}

function loadChats() {
  const q = query(collection(db, "chats"), orderBy("lastMessageTime", "desc"));
  onSnapshot(q, (snapshot) => {
    chats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(chat => chat.type === 'public' || (chat.participants && chat.participants.includes(currentUser.uid)));
    renderChatList(chatSearch.value); if (activeChatId) refreshMessages();
  });
}

function renderChatList(filter = '') {
  const filteredChats = chats.filter(chat => {
    const chatName = chat.type === 'private' ? getPrivateChatName(chat) : chat.name;
    const matchesName = chatName?.toLowerCase().includes(filter.toLowerCase());
    const otherParticipantUsername = chat.type === 'private' ? (chat.participantUsernames?.find(u => u !== currentUser.username) || '') : '';
    return matchesName || otherParticipantUsername.toLowerCase().includes(filter.toLowerCase());
  });
  chatListEl.innerHTML = filteredChats.map(chat => {
    const isActive = chat.id === activeChatId;
    const chatName = chat.type === 'private' ? getPrivateChatName(chat) : chat.name;
    const chatAvatar = chat.type === 'private' ? getPrivateChatAvatar(chat) : (chat.avatar || '/images/bot.png');
    return `
      <div class="chat-item ${isActive ? 'active' : ''}" data-id="${chat.id}">
        <img src="${chatAvatar}" alt="${chatName}" class="avatar">
        <div class="chat-item-content">
          <div class="chat-item-header"><h3>${chatName}</h3><span class="chat-time">${chat.lastMessageTime ? new Date(chat.lastMessageTime.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</span></div>
          <p class="chat-preview">${chat.lastMessage || 'Start a conversation'}</p>
        </div>
      </div>
    `;
  }).join('');
  document.querySelectorAll('.chat-item').forEach(item => item.addEventListener('click', () => switchChat(item.dataset.id)));
}

function getPrivateChatName(chat) { 
  const index = chat.participants.findIndex(uid => uid !== currentUser.uid);
  return index !== -1 && chat.participantNames ? chat.participantNames[index] : "Direct Chat";
}
function getPrivateChatAvatar(chat) { 
  const index = chat.participants.findIndex(uid => uid !== currentUser.uid);
  return index !== -1 && chat.participantAvatars ? chat.participantAvatars[index] : "/images/user1.png";
}

let messageListener = null;
function switchChat(id) {
  activeChatId = id; const chat = chats.find(c => c.id === id);
  const chatName = chat.type === 'private' ? getPrivateChatName(chat) : chat.name;
  const chatAvatar = chat.type === 'private' ? getPrivateChatAvatar(chat) : (chat.avatar || '/images/bot.png');
  welcomeScreen.classList.add('hidden'); activeChatScreen.classList.remove('hidden', 'active'); activeChatScreen.classList.add('active'); 
  document.querySelector('.chat-window').classList.add('active');
  activeChatInfo.innerHTML = `<img src="${chatAvatar}" alt="${chatName}" class="avatar"><div class="chat-info-text"><h3>${chatName}</h3><span>${chat.type === 'public' ? 'Global Channel' : 'Direct Message'}</span></div>`;
  msgSearchBar.classList.add('hidden'); msgSearchInput.value = ''; refreshMessages(); updateInfoPanel(chat);
}

function refreshMessages() {
  if (!activeChatId) return; if (messageListener) messageListener();
  const msgQuery = query(collection(db, "chats", activeChatId, "messages"), orderBy("timestamp", "asc"));
  messageListener = onSnapshot(msgQuery, (snapshot) => { activeMessages = snapshot.docs.map(doc => doc.data()); renderMessages(activeMessages, msgSearchInput.value); });
}

function renderMessages(messages, filter = '') {
  const filtered = messages.filter(m => (m.text || '').toLowerCase().includes(filter.toLowerCase()));
  messagesContainer.innerHTML = filtered.map(msg => `
    <div class="message ${msg.senderId === currentUser.uid ? 'self' : 'other'}" id="msg-${msg.id}" data-sender="${msg.senderName.replace(/'/g, "\\'")}" data-text="${(msg.text || 'Photo').replace(/'/g, "\\'")}">
      <div class="swipe-indicator"><i data-lucide="reply" style="width:16px;height:16px;"></i></div>
      ${msg.senderId !== currentUser.uid ? `<span style="font-size: 0.7rem; color: var(--accent); display: block; margin-bottom: 4px;">${msg.senderName}</span>` : ''}
      ${msg.replyTo ? `
        <div class="quoted-message" onclick="document.getElementById('msg-${msg.replyTo.id}')?.scrollIntoView({behavior:'smooth'})">
          <strong>${msg.replyTo.senderName}</strong>
          ${msg.replyTo.text || 'Photo'}
        </div>
      ` : ''}
      ${msg.imageUrl ? `<img src="${msg.imageUrl}" class="message-image" alt="Shared image" onclick="window.open('${msg.imageUrl}', '_blank')">` : ''}
      ${msg.text ? `<p>${msg.text}</p>` : ''}
      <div class="message-time">${msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '...'}${msg.senderId === currentUser.uid ? `<i data-lucide="check-check" class="status-icon read"></i>` : ''}</div>
      <div class="message-reply-btn" onclick="window.setReply('${msg.id}', '${msg.senderName.replace(/'/g, "\\'")}', '${(msg.text || 'Photo').replace(/'/g, "\\'")}')">
        <i data-lucide="reply" style="width:14px;height:14px;"></i>
      </div>
    </div>
  `).join(''); 
  lucide.createIcons(); 
  if (window.twemoji) twemoji.parse(messagesContainer);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
  const text = messageInput.value.trim(); if (!text && !replyingToMessage) return; // allow sending just a reply without text? No, require text.
  if (!text || !activeChatId) return;
  const chatRef = doc(db, "chats", activeChatId); const msgRef = collection(chatRef, "messages"); messageInput.value = '';
  
  const msgData = { text, senderId: currentUser.uid, senderName: currentUser.name, timestamp: serverTimestamp() };
  if (replyingToMessage) {
    msgData.replyTo = replyingToMessage;
    cancelReply();
  }
  
  await addDoc(msgRef, msgData);
  await setDoc(chatRef, { lastMessage: text, lastMessageTime: serverTimestamp() }, { merge: true });
}

async function uploadChatImage(file) {
  if (!file || !activeChatId) return;
  const chatRef = doc(db, "chats", activeChatId); 
  const msgRef = collection(chatRef, "messages");
  try {
    const ext = file.name.split('.').pop();
    const storageRef = ref(storage, `chat_images/${activeChatId}/${Date.now()}.${ext}`);
    await uploadBytes(storageRef, file);
    const imageUrl = await getDownloadURL(storageRef);
    await addDoc(msgRef, { text: '', imageUrl, senderId: currentUser.uid, senderName: currentUser.name, timestamp: serverTimestamp() });
    await setDoc(chatRef, { lastMessage: '📷 Image', lastMessageTime: serverTimestamp() }, { merge: true });
  } catch (error) {
    console.error("Image upload failed", error);
    alert("Failed to send image.");
  }
}

async function showUserList(filter = '') {
  userListEl.innerHTML = '<div style="padding: 20px; text-align: center;"><i data-lucide="loader" class="animate-spin"></i></div>'; lucide.createIcons();
  const snapshot = await getDocs(collection(db, "users"));
  const users = snapshot.docs.map(doc => doc.data()).filter(u => u.uid !== currentUser.uid && (u.name?.toLowerCase().includes(filter.toLowerCase()) || (u.username && u.username.toLowerCase().includes(filter.toLowerCase()))));
  
  userListEl.innerHTML = users.length === 0 ? '<p style="padding: 20px; text-align: center; color: var(--text-muted);">No users found.</p>' : users.map(user => {
    const isFollowing = currentUser.following?.includes(user.uid);
    const isFollower = currentUser.followers?.includes(user.uid);
    let btnText = "Follow";
    let btnClass = "follow-btn";
    if (isFollowing) { btnText = "Following"; btnClass = "follow-btn following"; }
    else if (isFollower) { btnText = "Follow Back"; }

    return `
      <div class="user-item">
        <div class="user-item-info" data-uid="${user.uid}" data-name="${user.name}" data-avatar="${user.avatar}" data-username="${user.username}" style="display: flex; align-items: center; flex: 1; cursor: pointer;">
          <img src="${user.avatar}" alt="${user.name}">
          <div><h4>${user.name}</h4><p>@${user.username || 'unknown'}</p></div>
        </div>
        <button class="${btnClass}" onclick="window.toggleFollow('${user.uid}')">${btnText}</button>
      </div>
    `;
  }).join('');
  
  document.querySelectorAll('.user-item-info').forEach(item => item.addEventListener('click', () => startPrivateChat(item.dataset.uid, item.dataset.name, item.dataset.avatar, item.dataset.username)));

  // Populate Group User List (Only Mutuals)
  const mutuals = users.filter(u => currentUser.following?.includes(u.uid) && currentUser.followers?.includes(u.uid));
  groupUserList.innerHTML = mutuals.length === 0 ? '<p style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">You need mutual followers to create a group.</p>' : mutuals.map(user => `
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

window.toggleFollow = async function(targetUid) {
  if (!currentUser) return;
  const isFollowing = currentUser.following?.includes(targetUid);
  try {
    if (isFollowing) {
      await updateDoc(doc(db, "users", currentUser.uid), { following: arrayRemove(targetUid) });
      await updateDoc(doc(db, "users", targetUid), { followers: arrayRemove(currentUser.uid) });
      currentUser.following = currentUser.following.filter(id => id !== targetUid);
    } else {
      await updateDoc(doc(db, "users", currentUser.uid), { following: arrayUnion(targetUid) });
      await updateDoc(doc(db, "users", targetUid), { followers: arrayUnion(currentUser.uid) });
      if (!currentUser.following) currentUser.following = [];
      currentUser.following.push(targetUid);
    }
    showUserList(userSearchInput.value);
  } catch (error) {
    console.error("Failed to toggle follow", error);
    alert("Could not update follow status.");
  }
};

async function startPrivateChat(otherUid, otherName, otherAvatar, otherUsername) {
  const isMutual = currentUser.following?.includes(otherUid) && currentUser.followers?.includes(otherUid);
  if (!isMutual) {
    alert(`You and ${otherName} must be following each other to chat or call.`);
    return;
  }
  newChatModal.classList.add('hidden'); const chatId = [currentUser.uid, otherUid].sort().join('_'); const chatRef = doc(db, "chats", chatId); const chatSnap = await getDoc(chatRef);
  if (!chatSnap.exists()) { await setDoc(chatRef, { type: 'private', participants: [currentUser.uid, otherUid], participantNames: [currentUser.name, otherName], participantUsernames: [currentUser.username, otherUsername], participantAvatars: [currentUser.avatar, otherAvatar], lastMessage: "Start of your private conversation", lastMessageTime: serverTimestamp() }); }
  switchChat(chatId);
}

function updateInfoPanel(chat) {
  const chatName = chat.type === 'private' ? getPrivateChatName(chat) : chat.name; const chatAvatar = chat.type === 'private' ? getPrivateChatAvatar(chat) : (chat.avatar || '/images/bot.png'); const otherUsername = chat.type === 'private' ? (chat.participantUsernames?.find(u => u !== currentUser.username) || '') : '';
  contactDetails.innerHTML = `<img src="${chatAvatar}" alt="${chatName}" class="avatar" style="border-radius: 40px; border: 4px solid var(--border);"><h2>${chatName}</h2>${otherUsername ? `<p style="color: var(--accent); margin-bottom: 10px;">@${otherUsername}</p>` : ''}<p>${chat.type === 'public' ? 'Shared Channel' : 'Direct Message'}</p><div style="margin-top: 30px; text-align: left;"><h4 style="color: var(--text-muted); text-transform: uppercase; font-size: 0.75rem; margin-bottom: 10px;">About</h4><p style="color: var(--text-primary);">${chat.description || 'A nexus channel.'}</p></div>`;
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

  const offerDescription = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp, type: offerDescription.type, from: currentUser.uid, 
    fromName: currentUser.name, fromAvatar: currentUser.avatar, callType: type, timestamp: serverTimestamp()
  };

  await setDoc(callDoc, { offer });

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
  callStatus.innerText = "Connecting...";
  currentCallUserId = callerUid;
  peerConnection = new RTCPeerConnection(servers);
  remoteStream = new MediaStream();

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection && ['disconnected', 'failed', 'closed'].includes(peerConnection.connectionState)) {
      endCall();
    }
  };

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
  peerConnection.onicecandidate = (event) => { event.candidate && addDoc(answerCandidates, event.candidate.toJSON()); };
  const callData = (await getDoc(callDoc)).data();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
  const answerDescription = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answerDescription);
  await updateDoc(callDoc, { answer: { type: answerDescription.type, sdp: answerDescription.sdp } });
  onSnapshot(offerCandidates, (snapshot) => {
    snapshot.docChanges().forEach((change) => { if (change.type === 'added') peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data())); });
  });
  acceptCallBtn.classList.add('hidden');
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
    }
  }
  lucide.createIcons();
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
  attachBtn.addEventListener('click', () => chatImageUpload.click());
  chatImageUpload.addEventListener('change', (e) => {
    if (e.target.files[0]) uploadChatImage(e.target.files[0]);
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
  infoToggle.addEventListener('click', () => infoPanel.classList.toggle('hidden'));
  closeInfo.addEventListener('click', () => infoPanel.classList.add('hidden'));
  backBtn.addEventListener('click', () => { 
    activeChatScreen.classList.remove('active', 'hidden'); 
    welcomeScreen.classList.remove('hidden'); 
    activeChatScreen.classList.add('hidden'); 
    document.querySelector('.chat-window').classList.remove('active');
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
          if (chatData.participantNames) chatData.participantNames[pIndex] = newName;
          if (chatData.participantUsernames) chatData.participantUsernames[pIndex] = newUsername;
          if (chatData.participantAvatars) chatData.participantAvatars[pIndex] = currentUser.avatar;
          batch.update(chatDoc.ref, { 
            participantNames: chatData.participantNames,
            participantUsernames: chatData.participantUsernames,
            participantAvatars: chatData.participantAvatars
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
  logoutBtn.addEventListener('click', () => { if(confirm('Log out?')) signOut(auth); });
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

  // --- SWIPE TO REPLY LOGIC ---
  let startX = 0;
  let currentEl = null;
  let isSwiping = false;

  const handleStart = (clientX, target) => {
    const msg = target.closest('.message');
    if (msg) { startX = clientX; currentEl = msg; isSwiping = true; currentEl.style.transition = 'none'; }
  };

  const handleMove = (clientX) => {
    if (!isSwiping || !currentEl) return;
    const diff = clientX - startX;
    const isSelf = currentEl.classList.contains('self');
    
    // WhatsApp style: swipe right for everyone
    if (diff > 0 && diff < 80) {
      currentEl.style.transform = `translateX(${diff}px)`;
      const indicator = currentEl.querySelector('.swipe-indicator');
      if (indicator) {
        indicator.style.opacity = Math.min(diff / 50, 1);
        indicator.style.transform = `translateY(-50%) scale(${Math.min(diff / 50, 1.2)})`;
      }
    }
  };

  const handleEnd = (clientX) => {
    if (!isSwiping || !currentEl) return;
    const diff = clientX - startX;
    currentEl.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    currentEl.style.transform = '';
    
    const indicator = currentEl.querySelector('.swipe-indicator');
    if (indicator) { indicator.style.opacity = 0; indicator.style.transform = 'translateY(-50%) scale(0.5)'; }

    if (diff > 60) {
      if (navigator.vibrate) navigator.vibrate(10);
      const id = currentEl.id.replace('msg-', '');
      window.setReply(id, currentEl.dataset.sender, currentEl.dataset.text);
    }
    
    isSwiping = false; currentEl = null;
  };

  messagesContainer.addEventListener('touchstart', (e) => handleStart(e.touches[0].clientX, e.target), {passive: true});
  messagesContainer.addEventListener('touchmove', (e) => handleMove(e.touches[0].clientX), {passive: true});
  messagesContainer.addEventListener('touchend', (e) => handleEnd(e.changedTouches[0].clientX));

  messagesContainer.addEventListener('mousedown', (e) => handleStart(e.clientX, e.target));
  window.addEventListener('mousemove', (e) => handleMove(e.clientX));
  window.addEventListener('mouseup', (e) => handleEnd(e.clientX));
}

function updateProfileUI() { if (!currentUser) return; document.querySelector('.user-profile img').src = currentUser.avatar; document.getElementById('my-profile-img').src = currentUser.avatar; myNameInput.value = currentUser.name; myUsernameInput.value = currentUser.username || ''; myStatusInput.value = currentUser.status; }
function init() { setupEventListeners(); }
init();
