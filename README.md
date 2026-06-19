# RAIT-ACM-KLEOS_TEAM-VOID
🛡️ Sentinel — Continuous Personal Safety Across Transit Jurisdictions

### 👥 Team Name: RAIT-ACM-KLEOS_TEAM-VOID

Sentinel is an active, context-aware personal safety companion designed to protect commuters during the unmonitored transition phases of urban travel. Rather than relying on reactive buttons or fragmented transport-operator metrics, Sentinel uses a decentralized Multi-Signal Confidence Engine (Sensor Fusion) to maintain a continuous safety state directly on the user's smartphone.

---

## 🚨 The Problem: The "Transition Gap"

Urban safety infrastructure in modern cities is built around individual transport modes:
* **Railway Police** monitor station platforms.
* **Municipal CCTV Networks** cover designated main roads.
* **Private Cab Platforms** track their own trips through their own apps.

Each system operates as a **closed, siloed jurisdiction**. A woman moving through the city at night passes through multiple monitored systems that do not communicate with each other. 

The highest-risk moments are **not inside** a monitored train or a tracked cab. They are the **unmonitored transition phases**:
1. The auto-rickshaw stand outside the station exit.
2. The poorly-lit stretch between a cab drop point and a building entrance.
3. The shared ride negotiated informally between two formal networks.

The moment she exits one monitored system, she drops completely off the safety map. Sentinel is built to bridge these gaps, protecting the **commuter**, not the vehicle.

---

## 💡 The Solution: Continuous background Security

Sentinel does not require hardware cooperation or data sharing from railway, municipal, or cab operators. It runs as an independent background agent leveraging native consumer smartphone sensors.

### 🌟 Key Product Features:
1. **Multi-Signal Sensor Fusion**: Combines physical impact, voice cues, post-impact movement, and night context to determine a unified danger score.
2. **7-Second Silent Popup check**: Fires at a $50\% - 60\%$ threat level. If the user is incapacitated and unable to respond, the countdown closes silently, **freezing the threat level at its elevated state** instead of decaying to 0%.
3. **100% Manual Override**: Pressing the panic button instantly overrides the threat level to 100% and halts decay.
4. **Guardian AI Narrative Generator**: Employs Google Gemini 1.5 Flash and OpenStreetMap Nominatim APIs to convert raw coordinates and active signals into clear, readable alert narratives (under 160 characters) for dispatchers and contacts.
5. **Stealth Mode (Shadow Calculator)**: Disguises the safety application interface as a fully functional notepad and calculator to protect users from active surveillance by stalkers.

---

## 🧠 The Tech Stack

### 📱 Frontend (Mobile Client)
* **Framework**: React Native (TypeScript) with Expo CLI
* **Sensor Integrations**: 
  * `expo-sensors` (3-axis Accelerometer - sampled at 10Hz)
  * `expo-location` (High-accuracy GPS / Speed tracker)
  * `expo-av` (Continuous 4-second audio recording stream)
* **Haptics**: `expo-haptics` and `Vibration` API

### 🖥️ Backend (Cloud Server)
* **Language**: Python 3.10+
* **Framework**: FastAPI (Uvicorn ASGI runner)
* **Database**: SQLite with SQLAlchemy ORM
* **APIs**:
  * **Google Gemini 1.5 Flash API** (Generates incident narratives)
  * **OpenStreetMap Nominatim API** (Reverse geocodes coordinates to landmarks)

---

## 🏗️ Product Architecture

```
[ CLIENT LAYER: React Native / Expo ]
   │
   ├── Sensors Telemetry (Accelerometer, GPS, Microphone)
   │
   ▼
[ CONFIDENCE EVALUATION STATE ]
   │
   ├── Gated Threshold Checks (>= 50% Safety Popup, >= 70% Automatic SOS)
   │
   ▼ (HTTPS JSON Payload)
[ CLOUD PROCESSING LAYER: FastAPI Server ]
   │
   ├── Database Incident Logging (SQLite)
   ├── Reverse Geocoding (OSM Nominatim API)
   ├── Narrative Generation (Gemini 1.5 Flash API)
   │
   ▼
[ DISPATCH & MONITORING LAYER ]
   ├── Real-time Admin Dispatcher Dashboard
   └── SMS Alerts to Emergency Contacts
```

---

## ⚙️ The Multi-Signal Scoring Logic

Alarms are not binary. We use a fuzzy logic weighted system to prevent false alarms while maintaining absolute safety:

* 🔊 **Danger Keywords Heard (Vocal NLP)**: `+40%`
* 📳 **Sudden Drop/Impact (Accelerometer >5.0G / 6.5G)**: `+30%`
* 🏃‍♂️ **Running/Shaking Post-Impact (>= 3 spikes >1.8G in 1.5s)**: `+20%`
* 🌃 **Night Context (10 PM - 5 AM)**: `+10%`
* ⚠️ **Emergency Alert Gate**: strictly `Score >= 70%`

*Telemetries automatically decay and expire after 15 seconds. If a threat is ignored on the 7-second popup, decay is frozen.*

---

## 🔧 Installation & Setup

### 1. Prerequisites
Ensure you have Node.js, Python 3.10+, and Expo CLI installed on your machine.

### 2. Backend Installation
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Set your Google Gemini API key:
   ```bash
   export GEMINI_API_KEY="your_api_key_here"  # On Windows: set GEMINI_API_KEY="your_api_key_here"
   ```
5. Run the server:
   ```bash
   python main.py
   ```
   *The backend will boot on `http://127.0.0.1:8000`.*

### 3. Mobile Client Installation
1. Navigate to the mobile app directory:
   ```bash
   cd mobile-app
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```
3. Update the backend connection URL in `app/utils/api.ts` to map your local IP address.
4. Launch the Expo bundler:
   ```bash
   npx expo start
   ```
5. Open the app on an Android/iOS emulator or scan the QR code using the Expo Go app on your physical smartphone.

---

## 🔬 How to Demonstrate the Prototype

During your presentation, execute this walk-through script to demonstrate all features live:

### 1. The "Drop and Run" Scenario (Automatic Trigger)
1. **Trigger Impact**: With the app armed, slap the back of your phone firmly against your palm. You will feel a haptic pulse, and `impact (+30)` will appear on the dashboard active signals list.
2. **Trigger Running**: **Immediately (within 1.5 seconds)**, shake the phone vigorously 3 to 4 times. The app registers these spikes and adds the `running (+20)` signal.
3. **Safety Popup**: The total score hits **50%** (or **60%** if night mode is active). The full-screen **"Are you OK?"** safety popup will trigger with a 7-second countdown.
4. **Silent Freeze**: Let the countdown timer hit 0. The popup will close silently, but the threat score **remains frozen at 50/60%** and does not decay.
5. **Reset**: Tap **"I AM SAFE"** on the dashboard to clear the score and signals back to 0%.

### 2. The Manual Panic SOS Trigger
1. **Trigger Alert**: Press and hold the **SOS** button on the home dashboard.
2. **Verify Override**: The screen will pulse red, bypass the confirmation popup, immediately force the threat score to **100%**, and append the `manual` signal to the list.
3. **Check Dispatcher**: Check the terminal logs or the backend administration dashboard to verify that the **Guardian AI narrative** has parsed the location and compiled the alert text:
   > *"🚨 URGENT: Potential emergency detected. [User] stopped moving near [Road]. User pressed physical panic button."*
4. **Admin Resolution**: Resolve the alert on the admin backend. The client application will poll this update and automatically disarm the SOS alert on the screen in 5 seconds.
