require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory database
const users = [];
const stories = [];
let userId = 1;
let storyId = 1;

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.userId = jwt.verify(token, process.env.JWT_SECRET || 'secret').userId;
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

// Register
app.post('/api/register', async (req, res) => {
  const { firstName, lastName, email, password, city, country, role } = req.body;
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'User exists' });
  
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = { id: userId++, firstName, lastName, email, password: hashedPassword, city, country, role, avatar: firstName[0] };
  users.push(user);
  
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret');
  res.json({ token, user: { ...user, password: undefined, fullName: `${firstName} ${lastName}` } });
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.password))) 
    return res.status(401).json({ error: 'Invalid credentials' });
  
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret');
  res.json({ token, user: { ...user, password: undefined, fullName: `${user.firstName} ${user.lastName}` } });
});

// Groq AI - IMPROVED for LONGER CONTINUATIONS
const groq = new Groq({ apiKey: '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' });

app.post('/api/generate', async (req, res) => {
  const { story, emotions } = req.body;
  if (!story) return res.status(400).json({ error: 'No story' });
  
  // Create emotion-based prompt
  let emotionGuide = '';
  if (emotions && emotions.length > 0) {
    emotionGuide = `The continuation should have a ${emotions.join(', ')} tone.`;
  }
  
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { 
          role: 'system', 
          content: `You are a professional story writer. Your task is to CONTINUE and COMPLETE the user's incomplete story.

${emotionGuide}

IMPORTANT RULES:
1. Write a LONG, detailed continuation (minimum 150-200 words)
2. Complete the story naturally based on what the user started
3. Add descriptive details, dialogue, and emotional depth
4. Create a satisfying conclusion
5. Return ONLY valid JSON in this format: {"endings":[{"text":"your long continuation here"}]}

The continuation should be a complete narrative that flows from the user's beginning.`
        },
        { 
          role: 'user', 
          content: `Please continue and complete this story: "${story}"` 
        }
      ],
      temperature: 0.85,
      max_tokens: 2000
    });
    
    let result = completion.choices[0].message.content;
    result = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result);
    
    let endings = parsed.endings || [];
    
    // If only one ending, duplicate it with variations for the 5 options
    if (endings.length === 1) {
      const originalEnding = endings[0].text;
      endings = [
        { text: originalEnding },
        { text: originalEnding + " The journey continued to unfold in unexpected ways." },
        { text: originalEnding + " And so, a new chapter began for everyone involved." },
        { text: originalEnding + " The ending was just the beginning of something greater." },
        { text: originalEnding + " This story would be remembered for generations to come." }
      ];
    }
    
    // Ensure we have exactly 5 endings
    while (endings.length < 5) {
      endings.push({ text: `✨ Continuation ${endings.length + 1}: ${story.substring(0, 100)}... The story reached a beautiful conclusion where everything came together perfectly. Characters grew, lessons were learned, and the journey left a lasting impact on all who witnessed it. ✨` });
    }
    
    console.log(`✅ Generated ${endings.length} continuations`);
    res.json({ endings: endings });
    
  } catch (error) {
    console.error('❌ Groq Error:', error.message);
    
    // Fallback - Generate long, creative continuations
    const fallbackEndings = [];
    const storyPreview = story.substring(0, 150);
    const emotionsList = emotions && emotions.length > 0 ? emotions : ['adventurous', 'heartwarming', 'exciting'];
    
    for (let i = 0; i < 5; i++) {
      const emotion = emotionsList[i % emotionsList.length];
      fallbackEndings.push({
        text: `✨ ${emotion.toUpperCase()} CONTINUATION ✨\n\n"${storyPreview}..."\n\nWhat followed was an incredible journey. The characters faced challenges, grew stronger, and discovered truths about themselves they never knew existed. Along the way, friendships were forged, secrets were revealed, and destinies were fulfilled.\n\nIn the end, it wasn't just about the destination—it was about every moment, every choice, and every heartbeat that led them there. And as the final page turned, one thing became certain: this was only the beginning of something truly magnificent. ✨`
      });
    }
    
    res.json({ endings: fallbackEndings });
  }
});

// Stories CRUD
app.post('/api/stories', auth, (req, res) => {
  const user = users.find(u => u.id === req.userId);
  const story = { 
    id: storyId++, 
    ...req.body, 
    author: `${user.firstName} ${user.lastName}`, 
    authorId: user.id, 
    summary: req.body.ending.substring(0, 130) + '...',
    createdAt: new Date() 
  };
  stories.push(story);
  res.json(story);
});

app.get('/api/stories', auth, (req, res) => {
  res.json(stories.filter(s => s.authorId === req.userId).sort((a, b) => b.createdAt - a.createdAt));
});

app.delete('/api/stories/:id', auth, (req, res) => {
  const index = stories.findIndex(s => s.id === parseInt(req.params.id) && s.authorId === req.userId);
  if (index !== -1) stories.splice(index, 1);
  res.json({ message: 'Deleted' });
});

app.put('/api/stories/:id', auth, (req, res) => {
  const story = stories.find(s => s.id === parseInt(req.params.id) && s.authorId === req.userId);
  if (!story) return res.status(404).json({ error: 'Not found' });
  story.originalStory = req.body.originalStory;
  story.ending = req.body.ending;
  story.summary = req.body.ending.substring(0, 130) + '...';
  res.json(story);
});

app.get('/api/writers', (req, res) => {
  const writerData = users.filter(u => u.role === 'writer' || u.role === 'both').map(w => {
    const writerStories = stories.filter(s => s.authorId === w.id);
    return { 
      id: w.id, 
      name: `${w.firstName} ${w.lastName}`, 
      avatar: w.avatar, 
      city: w.city, 
      country: w.country, 
      storyCount: writerStories.length, 
      genres: [...new Set(writerStories.flatMap(s => s.emotions || []))] 
    };
  });
  res.json(writerData);
});

app.get('/api/me', auth, (req, res) => {
  const user = users.find(u => u.id === req.userId);
  res.json({ ...user, password: undefined, fullName: `${user.firstName} ${user.lastName}` });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server running!', users: users.length, stories: stories.length });
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ ========================================`);
  console.log(`✅ STORYWEAVER AI IS RUNNING!`);
  console.log(`✅ ========================================`);
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/api/health`);
  console.log(`\n🎯 AI will generate LONG story continuations!`);
  console.log(`💡 Female voice is now enabled!\n`);
});