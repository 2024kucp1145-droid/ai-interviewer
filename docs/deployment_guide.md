# Production Deployment Guide: AI Interviewer SaaS

Aapke business plan ke **Chapter 8 (Deployment Step-by-Step)** ke hisaab se do tareeqe hain:

---

## 🌐 Option 1: Instant Public Live URL (Active Right Now)

Aapka local server abhi internet par securely exposed hai:

* **Public Live URL:** [https://shiny-rooms-watch.loca.lt](https://shiny-rooms-watch.loca.lt)
* **Tunnel Password / IP:** `47.15.101.255`
* *(Pehli baar open karne par loca.lt Tunnel Password mangega, wahan simply `47.15.101.255` paste karke "Click to Submit" press karein).*

### Iska Fayda:
* Instant HTTPS milta hai, jisse browser ka Microphone aur Speech Recognition feature world-wide kisi bhi phone ya laptop par smoothly kaam karta hai.
* Kisi bhi recruiter ya candidate ko real-time test link bhej sakte ho.

---

## ☁️ Option 2: Permanent 24/7 Free Cloud Hosting (Render / Railway)

Agar aap chahte ho ki laptop band hone ke baad bhi SaaS 24/7 chalta rahe:

### Method: Free Render.com Web Service
1. Apne project folder (`C:\Users\User\.gemini\antigravity\scratch\ai-interviewer`) ko GitHub par push karein (Private repo).
2. [Render.com](https://render.com) par free account banayein.
3. Click karein **"New +"** -> **"Web Service"** -> apna GitHub repo select karein.
4. Render automatic detect kar lega:
   * **Build Command:** `npm install`
   * **Start Command:** `node backend/src/server.js`
5. **Environment Variables** add karein:
   * `NODE_ENV`: `production`
   * `PORT`: `3001`
   * `JWT_SECRET`: (Koi bhi random secret string)
   * `ENCRYPTION_MASTER_KEY`: `e83a9f1b4c7d0e2f5a6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f`
6. Click **"Deploy Web Service"**.
7. 2 minute mein aapko ek permanent free URL mil jayega: `https://your-app.onrender.com`.
