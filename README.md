# KIRO - Autonomous Personal AI Assistant ⚡

Kiro is an ultra-modern, 24/7 personal AI assistant application engineered to streamline your daily workflow, automate tasks, write code, and generate AI art for free.

---

## 📁 Project Architecture (Inside Documents/AI Assistant)

```
Documents/
└── AI Assistant/
    ├── kiro-web/                   <-- Standalone Web & PWA App (Ready to use immediately)
    │   ├── index.html              <-- Ultra-Premium Responsive UI (Glassmorphic Dark Theme)
    │   └── manifest.json           <-- Mobile PWA Manifest (Add to Android Home Screen)
    │
    └── kiro-mobile/                <-- React Native & Expo Mobile App (For Standalone .APK)
        ├── App.js                  <-- Native Android UI & Logic
        ├── app.json                <-- Expo Android configuration (package: com.kiro.aiassistant)
        ├── eas.json                <-- Configured for 1-click standalone .apk builds
        └── package.json            <-- App dependencies
```

---

## 🚀 1. How to Test & Use Kiro Right Now (Web / PWA)

1. Open `Documents\AI Assistant\kiro-web\index.html` directly in Google Chrome or Edge.
2. **On Mobile**: Open in Chrome on your Android phone and tap **"Install App"** or **"Add to Home Screen"** to run it fullscreen like a native app.
3. Features:
   - **Chat & Automation**: Powered by Google Gemini.
   - **Image Generator**: Type `/image <prompt>` or click the 🎨 button for instant, free renders powered by Pollinations AI.
   - **Workflow Tracker**: Add tasks, manage priorities, and clear completed workflows.
   - **Voice Support**: Tap 🎙️ to speak directly to Kiro.

---

## 📱 2. How to Generate Your Standalone Android `.apk` File

We have already configured `eas.json` with `"buildType": "apk"`. Follow these 2 simple steps:

1. Open PowerShell or Terminal in `C:\Users\Asus Tuf A15\Documents\AI Assistant\kiro-mobile`:
   ```powershell
   cd "C:\Users\Asus Tuf A15\Documents\AI Assistant\kiro-mobile"
   npm install
   ```

2. Run EAS Build (Free Cloud Build - no Android Studio required!):
   ```powershell
   npx eas-cli build -p android --profile preview
   ```
   - Expo's cloud will compile your code and give you a direct download link for the `.apk` file!
   - You can download and install that `.apk` directly onto any Android phone.

---

## 🔑 AI Engine & 100% Free Tier Details
- **Text & Reasoning**: Google Gemini Flash Free Tier (Get a free key from [Google AI Studio](https://aistudio.google.com/)).
- **Image Generation**: Pollinations AI (Unlimited, no API key required, 100% free).
- **Persistence**: All chats, tasks, and generated images are saved locally.
