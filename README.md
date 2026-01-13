# PingMe: Real-Time Decentralized Group Chat

PingMe is a Node.js-based real-time group chat application featuring:
- End-to-end encrypted messaging with GUN.js decentralized storage
- Real-time communication via Socket.io
- Emoji support (Emoji-Picker-jquery-Emoji-Plugin)
- Light/dark theme toggle
- User authentication (with optional anonymous mode)
- Responsive, mobile-friendly UI

## Features
- **Decentralized Storage:** Messages are persisted using GUN.js, ensuring chat history is available even if the server restarts.
- **Real-Time Messaging:** Socket.io delivers instant message updates to all connected users.
- **Emoji Support:** Easily insert emojis into your messages.
- **Theming:** Toggle between light and dark mode for comfortable viewing.
- **User Presence:** See when users join, leave, or are typing.
- **Anonymous Mode:** Join the chat without registering an account.
- **Security:** Messages are encrypted with a group key before being stored in GUN.js.

## Getting Started

### Prerequisites
- Node.js v22 or higher
- npm (comes with Node.js)

### Installation
1. **Clone the repository:**
   ```sh
   git clone https://www.github.com/pjedra96/PingMe.git
   cd PingMe
   ```
2. **Install dependencies:**
   ```sh
   npm install
   ```
3. **Start the servers:**
   ```sh
   npm start
   ```
   - The main chat server runs on [http://localhost:8080](http://localhost:8080)
   - The GUN relay server runs on [http://localhost:8765/gun](http://localhost:8765/gun)

4. **Open your browser:**
   - Visit [http://localhost:8080](http://localhost:8080) to access the chat app.

## Usage
- **Login/Register:** Enter a username and password, or check "Join as anonymous" to chat without an account.
- **Send Messages:** Type your message and press Enter or click Send. Use Shift+Enter for a new line.
- **Emojis:** Click the smiley icon to pick and insert emojis.
- **Theme:** Click the sun/moon icon to toggle between light and dark mode.
- **Group Key:** (Advanced) Change the group key for a private chat room (default: `mesh-demo-key`).

## Project Structure
- `/public/js/` — Client-side JavaScript (chat logic, authentication, theming)
- `/public/css/` — Stylesheets
- `/views/` — EJS templates for the UI
- `index.js` — Main server (Express, Socket.io, GUN.js relay)

## Technical Details
- **Express** serves the static files and main chat page.
- **Socket.io** handles real-time events (messages, typing, presence).
- **GUN.js** provides decentralized, persistent message storage and encryption (SEA).
- **EJS** is used for server-side rendering of the main page.
- **Bootstrap** and custom CSS for responsive design.

## Security Notes
- All messages are encrypted with a group key before being stored in GUN.js. Make sure to use a strong, unique group key for private chats.
- User authentication is basic and for demonstration purposes. For production, use a robust authentication system.

## License
MIT

---

For questions or contributions, please open an issue or pull request on GitHub.