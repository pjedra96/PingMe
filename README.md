# PingMe: Real-Time Decentralized Group Chat

PingMe is a Node.js-based real-time group chat application featuring:
- End-to-end encrypted messaging with GUN.js decentralized storage
- Chat rooms: a General room, public rooms listed in a lobby, and password-protected private rooms
- Real-time communication via Socket.io
- Emoji support (Emoji-Picker-jquery-Emoji-Plugin)
- Light/dark theme toggle
- User authentication (with optional anonymous mode)
- Responsive, mobile-friendly UI

## Features
- **Chat Rooms:** A General room open to everyone, public rooms anyone can find in the lobby, and private rooms where only people who enter the same room name and password can see each other's messages, typing and presence.
- **Optional History:** Each room either keeps its history or is live-only (messages go only to whoever is in the room and are never stored). General always keeps history. Joining a room loads its newest 100 messages.
- **Moderation:** Moderators can remove any message they can see (for everyone, including from history) and ban its sender - a registered account until unbanned, plus the sender's IP address for 24 hours. Bans can be lifted from the lobby.
- **Verified Names:** Registered names are reserved for their account. Messages from registered users are signed and shown with a ✓, guests are marked "(guest)", and a registered name used without its account's signature is flagged "⚠ unverified".
- **Reconnects:** After a lost connection or server restart, the app logs back in, rejoins the room and fetches missed messages automatically.
- **Decentralized Storage:** Messages are persisted using GUN.js, ensuring chat history is available even if the server restarts.
- **Real-Time Messaging:** Socket.io delivers instant message updates to everyone in the room.
- **Emoji Support:** Easily insert emojis into your messages.
- **Theming:** Toggle between light and dark mode for comfortable viewing.
- **User Presence:** See when users join, leave, or are typing.
- **Anonymous Mode:** Join the chat as a guest without registering an account (registered names and names already online can't be used).
- **Security:** Messages are encrypted in the browser with a key derived from the room name and password. The server and relay only ever see ciphertext.

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
   - To use different ports, set the `PORT` and `GUN_PORT` environment variables
   - Behind a reverse proxy (nginx, Caddy...), set `TRUST_PROXY=1` so rate limiting uses each visitor's real IP. Don't set it otherwise - the header it reads could be faked.
   - Registered names, bans and removed messages are stored in the `data/` folder (set `DATA_DIR` to use another folder). Back it up - if `names.json` is lost, names can be claimed again.
   - To make registered users moderators, list their names in `MODERATORS` (comma-separated, e.g. `MODERATORS=peter,alice`). `BAN_HOURS` sets how long IP bans last (default 24).
     ```powershell
     $env:MODERATORS = 'peter'; npm start
     ```

4. **Open your browser:**
   - Visit [http://localhost:8080](http://localhost:8080) to access the chat app.

## Usage
- **Login/Register:** Enter a username and password, or check "Join as anonymous" to chat without an account.
- **Lobby:** After logging in, pick a room from the list (General, plus every public room with people in it), or create one. Public rooms stay listed for 2 minutes after the last person leaves. Creating a room with the same name and settings as an existing one joins it, including its history. Use **⬅ Lobby** in the top bar to switch rooms.
- **Private rooms:** Create one with a name, a password and a history setting, then share all three with the people you want to chat with. Private rooms are never listed. A different password or history setting leads to a different (empty) room, not an error.
- **Send Messages:** Type your message and press Enter or click Send. Use Shift+Enter for a new line.
- **Emojis:** Click the smiley icon to pick and insert emojis.
- **Theme:** Click the sun/moon icon to toggle between light and dark mode.

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
- Removed messages stay in GUN's tamper-proof storage (it can't delete), but the server never sends them out again.
- IP bans affect everyone sharing that IP address (a household, an office, or everyone on the same machine when testing locally). Moderators are never affected.
- Messages (including the sender's name and time) are encrypted in the browser with a key derived from the room name and password using PBKDF2. Use a strong room password for private chats - a room without a password can be joined by anyone who knows or guesses its name.
- Messages are stored in GUN.js content-addressed storage, so the relay rejects any attempt to edit or delete them.
- The GUN relay accepts new data from anyone, so it is rate-limited per IP address (600 messages and 512 KB per minute, max 64 KB per message - see the `RELAY_*` settings in `index.js`). Junk data can't be read or shown in rooms.
- A registered name is tied to its account's public key the first time it logs in (first come, first served). Registered users prove ownership by signing a server challenge, and sign every message, so signatures are checked in each browser - the server can't fake a ✓.
- Guest names aren't reserved: any guest can use a name that isn't registered or currently online.
- Room history is ordered by when the relay stored each message. Someone could fill a room's storage with junk (within the rate limits), which can't be read but can push real messages out of the newest 100.
- User authentication is basic and for demonstration purposes. For production, use a robust authentication system.

## License
[PolyForm Noncommercial 1.0.0](LICENSE) — free to use, modify and share for noncommercial purposes, as long as the copyright notice is kept. For commercial use, please get in touch for a separate license.

---

For questions or contributions, please open an issue or pull request on GitHub.