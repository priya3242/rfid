const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const app = express();

// Initialize Firebase
const serviceAccount = require('/home/akhil/Desktop/rfid/firebase.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://college-rfid-default-rtdb.firebaseio.com/'
});

const db = admin.database();

// Middleware setup
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session setup
app.use(session({
  secret: 'your-secret-key', // Replace with a strong secret key
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

// Simple in-memory user store (for demonstration purposes)
const users = {
  'user1': { username: 'user1', password: 'password1' },
  'user2': { username: 'user2', password: 'password2' }
};

// Middleware to check if the user is logged in
function ensureAuthenticated(req, res, next) {
  if (req.session.loggedIn) {
    return next();
  }
  res.redirect('/login');
}

// Root route to redirect to login
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Login route
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (users[username] && users[username].password === password) {
    req.session.loggedIn = true;
    req.session.username = username;
    res.redirect('/attendance');
  } else {
    res.redirect('/login');
  }
});
//newcard 
app.get('/newcards', ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'newcards.html'));
});
// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.redirect('/attendance');
    }
    res.redirect('/login');
  });
});
//for fech allusers 
// API route to fetch all users' details
app.get('/api/users', ensureAuthenticated, async (req, res) => {
  try {
    const usersRef = db.ref('users');
    const snapshot = await usersRef.once('value');
    
    if (!snapshot.exists()) {
      return res.json({ error: 'No user data found' });
    }
    
    const data = snapshot.val();
    res.json(data);
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// Route to fetch new card data from Firebase

app.get('/api/newcard', ensureAuthenticated, async (req, res) => {
  try {
    const newCardRef = db.ref('newcard_id');
    const snapshot = await newCardRef.once('value');

    if (!snapshot.exists()) {
      return res.json({ error: 'No new card data found' });
    }

    const data = snapshot.val();
    res.json(data);
  } catch (error) {
    console.error('Error fetching new card data:', error);
    res.status(500).json({ error: 'Failed to fetch new card data' });
  }
});

// Attendance route (protected)
app.get('/attendance', ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'attendance.html'));
});

// Serve the add user form (protected)
app.get('/add-user', ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'add_user.html'));
});

// Handle adding a new user (protected)
app.post('/add-user', ensureAuthenticated, async (req, res) => {
  const { uid, username, name } = req.body;

  if (!uid || !username || !name) {
    return res.send('All fields are required!');
  }

  try {
    const userRef = db.ref(`users/${uid}`);
    await userRef.set({ username, name });
    res.redirect('/attendance');
  } catch (error) {
    console.error("Error adding user:", error);
    res.send('Failed to add user. Please try again.');
  }
});

app.get('/api/attendance', ensureAuthenticated, async (req, res) => {
  try {
    console.debug("Fetching attendance data from Firebase...");
    
    const attendanceRef = db.ref('attendance');
    const usersRef = db.ref('users');

    // Fetch attendance and user data
    const [attendanceSnapshot, usersSnapshot] = await Promise.all([
      attendanceRef.once('value'),
      usersRef.once('value')
    ]);

    if (!attendanceSnapshot.exists()) {
      console.debug("No attendance data found.");
      return res.json({ error: "No attendance data found." });
    }

    const users = usersSnapshot.val();
    const attendanceData = attendanceSnapshot.val();
    const usersAttendance = [];

    for (const [date, dateInfo] of Object.entries(attendanceData)) {
      if (!date || date.trim() === "") continue; // Skip entries without a valid date

      for (const [uid, uidInfo] of Object.entries(dateInfo)) {
        for (const [timestamp, recordInfo] of Object.entries(uidInfo)) {
          if (recordInfo.login_time) { // Only process records with a login_time
            const userInfo = users[uid];
              
            if (userInfo) {
              const login_time = recordInfo.login_time;
              const exit_time = recordInfo.exit_time || '';
              const status = exit_time ? 'exited' : 'presented';

              usersAttendance.push({
                username: userInfo.username || '',
                name: userInfo.name || '',
                date,
                login_time,
                exit_time,
                status
              });
            }
          }
        }
      }
    }

    console.debug("Users' attendance data:", usersAttendance);

    // Send the data as JSON
    res.json({ usersAttendance });

  } catch (error) {
    console.error("Error fetching attendance data:", error);
    res.status(500).json({ error: error.message });
  }
});

// Route to update the current time and date (manual trigger)
app.post('/update-time', ensureAuthenticated, async (req, res) => {
  const currentDateTime = new Date();
  const formattedDate = currentDateTime.toISOString().split('T')[0]; // YYYY-MM-DD
  const formattedTime = currentDateTime.toTimeString().split(' ')[0].substring(0, 5); // HH:MM

  try {
    const timeRef = db.ref('current_time');
    await timeRef.set({
      date: formattedDate,
      time: formattedTime
    });
    res.json({ message: 'Time and date updated successfully' });
  } catch (error) {
    console.error('Error updating time and date:', error);
    res.status(500).json({ error: 'Failed to update time and date' });
  }
});

// Route to fetch the current time and date
app.get('/current-time', ensureAuthenticated, async (req, res) => {
  try {
    const timeRef = db.ref('current_time');
    const snapshot = await timeRef.once('value');
    
    if (!snapshot.exists()) {
      return res.json({ error: 'No time and date data found' });
    }
    
    const data = snapshot.val();
    res.json(data);
  } catch (error) {
    console.error('Error fetching time and date:', error);
    res.status(500).json({ error: 'Failed to fetch time and date' });
  }
});

// Schedule a task to update the time and date every minute
cron.schedule('* * * * *', async () => {
  const currentDateTime = new Date();
  const formattedDate = currentDateTime.toISOString().split('T')[0]; // YYYY-MM-DD
  const formattedTime = currentDateTime.toTimeString().split(' ')[0].substring(0, 5); // HH:MM

  try {
    const timeRef = db.ref('current_time');
    await timeRef.set({
      date: formattedDate,
      time: formattedTime
    });
    console.log('Updated time and date in Firebase:', { date: formattedDate, time: formattedTime });
  } catch (error) {
    console.error('Error updating time and date:', error);
  }
});

// Run the application
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
