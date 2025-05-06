const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = process.env.PERSISTENT_DISK_PATH || './';

app.use(cors());
app.use(express.json());

let bots = [];
let botCount = 0;
const maxBots = 20;
const maxPrivateBots = 5;
let userInfo = { points: 0, userId: 'guest' }; // Default user

// Check if file exists
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Initialize data files
async function initializeDataFiles() {
  const botDataPath = path.join(DATA_DIR, 'bot_data.json');
  const userDataPath = path.join(DATA_DIR, 'user_data.json');

  if (!(await fileExists(botDataPath))) {
    console.log(`Creating bot_data.json at ${botDataPath}`);
    await fs.writeFile(botDataPath, JSON.stringify([], null, 2));
  }

  if (!(await fileExists(userDataPath))) {
    console.log(`Creating user_data.json at ${userDataPath}`);
    await fs.writeFile(userDataPath, JSON.stringify({ points: 0, userId: 'guest' }, null, 2));
  }
}

// Load data
async function loadData() {
  const botDataPath = path.join(DATA_DIR, 'bot_data.json');
  const userDataPath = path.join(DATA_DIR, 'user_data.json');

  try {
    await initializeDataFiles();

    try {
      const botData = await fs.readFile(botDataPath, 'utf8');
      bots = JSON.parse(botData);
      botCount = bots.length;
      console.log(`Loaded bots: Total=${botCount}, Private=${bots.filter(bot => bot.isPrivate).length}`);
    } catch (error) {
      console.error(`Error loading bot_data.json: ${error.message}`);
      bots = [];
      botCount = 0;
      await fs.writeFile(botDataPath, JSON.stringify([], null, 2));
      console.log('Initialized empty bot_data.json due to load error');
    }

    try {
      const userData = await fs.readFile(userDataPath, 'utf8');
      userInfo = JSON.parse(userData);
      userInfo.points = Number(userInfo.points) || 0;
      userInfo.userId = userInfo.userId || 'guest';
      console.log(`Loaded user data: Points=${userInfo.points}, UserId=${userInfo.userId}`);
    } catch (error) {
      console.error(`Error loading user_data.json: ${error.message}`);
      userInfo = { points: 0, userId: 'guest' };
      await fs.writeFile(userDataPath, JSON.stringify({ points: 0, userId: 'guest' }, null, 2));
      console.log('Initialized empty user_data.json due to load error');
    }
  } catch (error) {
    console.error(`Error initializing data files: ${error.message}`);
    throw error;
  }
}

async function saveBots() {
  try {
    await fs.writeFile(path.join(DATA_DIR, 'bot_data.json'), JSON.stringify(bots, null, 2));
  } catch (error) {
    throw error;
  }
}

async function saveUserData() {
  try {
    await fs.writeFile(path.join(DATA_DIR, 'user_data.json'), JSON.stringify(userInfo, null, 2));
  } catch (error) {
    throw error;
  }
}

// Initialize data and start server
loadData().then(() => {
  // API: Create a bot
  app.post('/api/bots', async (req, res) => {
    const { username, isPrivate, userId } = req.body;
    console.log(`Create bot attempt: Username=${username}, Private=${isPrivate}, UserId=${userId}, Points=${userInfo.points}, TotalBots=${botCount}, PrivateBots=${bots.filter(bot => bot.isPrivate).length}`);

    // Validation 1: Private checkbox
    if (!isPrivate) {
      return res.status(400).json({ error: 'Private bot checkbox must be checked.' });
    }

    // Validation 2: Username
    if (!username) {
      return res.status(400).json({ error: 'Please enter a username for the bot.' });
    }

    // Validation 3: Total bot limit
    if (botCount >= maxBots) {
      return res.status(400).json({ error: 'Maximum bot limit (20) reached!' });
    }

    // Validation 4: Private bot limit (per user)
    const userPrivateBotCount = bots.filter(bot => bot.isPrivate && bot.userId === userId).length;
    if (userPrivateBotCount >= maxPrivateBots) {
      return res.status(400).json({ error: 'Maximum private bot limit (5) reached for this user!' });
    }

    // Validation 5: Points
    if (userInfo.points < 250 || isNaN(userInfo.points)) {
      return res.status(400).json({ error: `Insufficient points! You need 250 points to create a private bot. Current points: ${userInfo.points || 0}` });
    }

    // Deduct points
    const originalPoints = userInfo.points;
    userInfo.points -= 250;
    try {
      await saveUserData();
      console.log(`Points saved: ${userInfo.points}`);
    } catch (error) {
      userInfo.points = originalPoints;
      console.error('Failed to save user data:', error);
      return res.status(500).json({ error: 'Error saving points. Please try again.' });
    }

    // Create bot
    const bot = {
      id: `bot_${Date.now()}`,
      username,
      status: 'Waiting for Verification',
      createdAt: new Date().toISOString(),
      verificationDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      isPrivate: true,
      userId: userId || 'guest' // Associate bot with user
    };

    bots.push(bot);
    botCount++;
    try {
      await saveBots();
      console.log(`Bot saved: ${username}, Private: true, UserId: ${bot.userId}`);
      res.json({ message: `Bot ${username} created successfully! 250 points deducted.`, bot });
    } catch (error) {
      bots.pop();
      botCount--;
      userInfo.points = originalPoints;
      await saveUserData();
      console.error('Failed to save bots:', error);
      res.status(500).json({ error: 'Error saving bot. Please try again.' });
    }
  });

  // API: Get user info
  app.get('/api/user', (req, res) => {
    res.json(userInfo);
  });

  // API: Get bots
  app.get('/api/bots', (req, res) => {
    res.json(bots);
  });

  // API: Verify bot
  app.post('/api/bots/verify/:botId', (req, res) => {
    const { botId } = req.params;
    const bot = bots.find(b => b.id === botId);
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    bot.status = 'Verified';
    saveBots().then(() => {
      res.json({ message: `Bot ${bot.username} verified.` });
    }).catch(error => {
      console.error('Failed to save bots:', error);
      res.status(500).json({ error: 'Error verifying bot.' });
    });
  });

  // Start server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend running on port ${PORT}`);
  });
}).catch(error => {
  console.error('Failed to initialize server:', error);
  process.exit(1);
});
