Halloween Gartic - Final

Fixes included:
- Removed special em-dash characters from text and comments.
- Timer ticks include phase name so client updates only for correct phase.
- Drawing UI is visible during drawing phase, but only the assigned drawer can draw.
- Canvas coordinates fixed to align with cursor.
- Reveal is animated sequentially per entry.
- Server waits 8 seconds after reveal before moving to next round or ending the game.
- Client handles game end and shows final screen without reverting.

How to replace old project:
1) Download and unpack this folder.
2) Backup your old project folder.
3) Replace server.js, package.json, and the public/ folder with the files from this package.
4) Run: npm install && npm start
5) Open http://localhost:3000

If you want, I can push this to a GitHub repo for you or create a Render deployment.
