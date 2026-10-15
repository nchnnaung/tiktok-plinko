const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');

const TIKTOK_USERNAME = 'mgmatty_onfire'; // Your TikTok username
const PORT = process.env.PORT || 3000;
const AVATAR_DIR = path.join(__dirname, 'public', 'avatars');

if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

const downloadQueue = new Map();
const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use('/avatars', express.static(AVATAR_DIR));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

async function getCachedAvatar(userId, remoteUrl) {
  if (!remoteUrl) return null;
  const fileName = `${userId}.jpg`;
  const filePath = path.join(AVATAR_DIR, fileName);
  const relativeUrl = `/avatars/${fileName}`;

  if (fs.existsSync(filePath)) return relativeUrl;
  if (downloadQueue.has(userId)) return downloadQueue.get(userId);

  const fetchPromise = (async () => {
    try {
      const res = await fetch(remoteUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!res.ok) throw new Error('Download failed');
      const buffer = await res.arrayBuffer();
      await fs.promises.writeFile(filePath, Buffer.from(buffer));
      return relativeUrl;
    } catch (err) {
      return null;
    } finally {
      downloadQueue.delete(userId);
    }
  })();

  downloadQueue.set(userId, fetchPromise);
  return fetchPromise;
}

const tiktokLive = new WebcastPushConnection(TIKTOK_USERNAME);

tiktokLive.connect().then((state) => {
  console.log(`[TikTok] Connected to Room ID: ${state.roomId}`);
}).catch((err) => {
  console.log('[TikTok] Waiting for live stream...');
});

tiktokLive.on('gift', async (data) => {
  if (data.giftType === 1 && !data.repeatEnd) return;

  const localAvatar = await getCachedAvatar(data.userId, data.profilePictureUrl);

  broadcast({
    type: 'GIFT',
    username: data.nickname || data.uniqueId,
    avatar: localAvatar,
    giftName: data.giftName || 'Gift',
    diamondCount: data.diamondCount * (data.repeatCount || 1)
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
