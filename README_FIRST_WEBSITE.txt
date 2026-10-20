HOT POTATO TYCOON ONLINE — BEGINNER PUBLISHING GUIDE

WHAT THIS PACKAGE DOES
- Hosts the Hot Potato Tycoon game page and its Node.js WebSocket server together.
- Supports online room codes and synchronized multiplayer through the server.
- Can be deployed as a free hobby/test web service on Render.

IMPORTANT ABOUT "FREE"
- Render provides a free service URL ending in onrender.com, subject to free-plan limits.
- Free services can sleep after inactivity, so the first visit/connection after sleeping may take about a minute.
- A custom domain name (for example, yourname.com) usually costs money each year.
- Google Domains no longer operates as a separate domain registrar. Domains formerly registered there are managed through Squarespace after the migration. If you already own a domain, you may be able to connect it to the hosted service; domain registration itself is not generally free.

PART A — TEST ON YOUR COMPUTER
1. Install Node.js 18 or newer from https://nodejs.org/.
2. Extract this ZIP to a folder.
3. Open a terminal/Command Prompt in that extracted folder.
4. Run: npm install
5. Run: npm start
6. Open http://localhost:8080 in your browser.
7. Create a room. To test with two players on the same computer, open a second browser window or an Incognito window and join with the room code.
8. Keep the terminal running while you play.

PART B — PUBLISH FREE ON RENDER
You will need a GitHub account to store the project and a Render account to deploy it. You can do this without buying a domain.

1. Create a new repository on GitHub. For a first test, a public repository is simplest. Do not upload passwords, API keys, or private information.
2. Upload all files from this folder (the files themselves, not the ZIP file) into the repository's top/root folder:
   - hot_potato_tycoon_online.html
   - server.js
   - package.json
   - render.yaml
   - README_FIRST_WEBSITE.txt
3. Open https://render.com/ and sign in.
4. In Render, choose New > Blueprint (if available), connect your GitHub repository, and follow the prompts to apply render.yaml.
   If Blueprint is not offered, choose New > Web Service, connect the repository, set Build Command to `npm install`, Start Command to `npm start`, and select the Free instance plan.
5. Wait for deployment to finish. Open the public onrender.com URL Render gives you.
6. Create a room, then open the same public URL in another browser/device and join using the room code.
7. The server's room data is in memory. Rooms disappear if the server restarts or sleeps; this is normal for this starter project.

PART C — IF YOU ALREADY OWN A CUSTOM DOMAIN
You do not need a custom domain to publish the game. First get the Render URL working. Then, if you already own a domain, add it in Render's Custom Domains settings and follow the exact DNS records Render shows. For a domain formerly managed by Google Domains, check its current management dashboard at Squarespace. DNS changes can take time to update. Do not change DNS records until you know which service currently manages your domain.

BASIC DEBUGGING
- Browser errors: open the game, press F12, and select Console. Copy red error text.
- Server errors: look at the terminal locally or Render's Logs page.
- If the service sleeps, wait for it to start before deciding it is broken.
- If multiplayer fails, confirm both players are using the same public URL and room code.

LIMITATIONS
This is a first multiplayer version, not a fully production-hardened game. It has no account system or persistent player data. Test it with friends before sharing widely.
