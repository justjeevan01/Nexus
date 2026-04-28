import './style.css';
import { auth, googleProvider, db, storage } from './firebase';
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, where, doc, getDoc, setDoc, getDocs, limit, deleteDoc, updateDoc } from "firebase/firestore";
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
let activeMessages = [];
let isMuted = false;
let isVideoOff = false;

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
        email: user.email, avatar: userData?.avatar || user.photoURL, status: userData?.status || 'Available', theme: userData?.theme || 'dark'
      };

      if (!userDoc.exists()) await setDoc(userDocRef, currentUser);

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

function getPrivateChatName(chat) { return chat.participantNames?.find(name => name !== currentUser.name) || "Direct Chat"; }
function getPrivateChatAvatar(chat) { return chat.participantAvatars?.find(avatar => avatar !== currentUser.avatar) || "/images/user1.png"; }

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
    <div class="message ${msg.senderId === currentUser.uid ? 'self' : 'other'}">
      ${msg.senderId !== currentUser.uid ? `<span style="font-size: 0.7rem; color: var(--accent); display: block; margin-bottom: 4px;">${msg.senderName}</span>` : ''}
      ${msg.imageUrl ? `<img src="${msg.imageUrl}" class="message-image" alt="Shared image" onclick="window.open('${msg.imageUrl}', '_blank')">` : ''}
      ${msg.text ? `<p>${msg.text}</p>` : ''}
      <div class="message-time">${msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '...'}${msg.senderId === currentUser.uid ? `<i data-lucide="check-check" class="status-icon read"></i>` : ''}</div>
    </div>
  `).join(''); lucide.createIcons(); messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function sendMessage() {
  const text = messageInput.value.trim(); if (!text || !activeChatId) return;
  const chatRef = doc(db, "chats", activeChatId); const msgRef = collection(chatRef, "messages"); messageInput.value = '';
  await addDoc(msgRef, { text, senderId: currentUser.uid, senderName: currentUser.name, timestamp: serverTimestamp() });
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
  userListEl.innerHTML = users.length === 0 ? '<p style="padding: 20px; text-align: center; color: var(--text-muted);">No users found.</p>' : users.map(user => `<div class="user-item" data-uid="${user.uid}" data-name="${user.name}" data-avatar="${user.avatar}" data-username="${user.username}"><img src="${user.avatar}" alt="${user.name}"><div><h4>${user.name}</h4><p>@${user.username || 'unknown'} • ${user.status || 'Available'}</p></div></div>`).join('');
  document.querySelectorAll('.user-item').forEach(item => item.addEventListener('click', () => startPrivateChat(item.dataset.uid, item.dataset.name, item.dataset.avatar, item.dataset.username)));
}

async function startPrivateChat(otherUid, otherName, otherAvatar, otherUsername) {
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
  if (chat.type === 'public') { alert("Public calls not supported."); return; }
  const otherUid = chat.participants.find(uid => uid !== currentUser.uid);

  callName.innerText = getPrivateChatName(chat);
  callAvatar.src = getPrivateChatAvatar(chat);
  callStatus.innerText = "Initializing P2P...";
  acceptCallBtn.classList.add('hidden');
  callOverlay.classList.remove('hidden');

  peerConnection = new RTCPeerConnection(servers);
  remoteStream = new MediaStream();

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
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data?.answer) {
      peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
  });

  onSnapshot(answerCandidates, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
    });
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
  peerConnection = new RTCPeerConnection(servers);
  remoteStream = new MediaStream();
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
  callOverlay.classList.add('hidden');
  videoContainer.style.display = 'none';
  acceptCallBtn.classList.add('hidden');
  ringingInfo.style.opacity = '1';
  ringingInfo.classList.remove('hidden');
  localVideo.classList.add('hidden');
  deleteDoc(doc(db, "calls", currentUser.uid)).catch(()=>{});
  chats.forEach(chat => { if(chat.type === 'private') deleteDoc(doc(db, "calls", chat.id)).catch(()=>{}); });
  isMuted = false; isVideoOff = false;
  toggleMicBtn.classList.remove('muted'); toggleVideoBtn.classList.remove('muted');
  toggleMicBtn.querySelector('i').setAttribute('data-lucide', 'mic');
  toggleVideoBtn.querySelector('i').setAttribute('data-lucide', 'video');
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
    await setDoc(doc(db, "users", currentUser.uid), currentUser, { merge: true });
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
  endCallBtn.addEventListener('click', endCall);
  toggleMicBtn.addEventListener('click', toggleMic);
  toggleVideoBtn.addEventListener('click', toggleVideo);
  msgSearchToggle.addEventListener('click', () => { msgSearchBar.classList.toggle('hidden'); if (!msgSearchBar.classList.contains('hidden')) msgSearchInput.focus(); else { msgSearchInput.value = ''; renderMessages(activeMessages); } });
  closeMsgSearch.addEventListener('click', () => { msgSearchBar.classList.add('hidden'); msgSearchInput.value = ''; renderMessages(activeMessages); });
  msgSearchInput.addEventListener('input', (e) => renderMessages(activeMessages, e.target.value));
}

function updateProfileUI() { if (!currentUser) return; document.querySelector('.user-profile img').src = currentUser.avatar; document.getElementById('my-profile-img').src = currentUser.avatar; myNameInput.value = currentUser.name; myUsernameInput.value = currentUser.username || ''; myStatusInput.value = currentUser.status; }
function init() { setupEventListeners(); }
init();
