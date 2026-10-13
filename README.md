# 🍽️ JIM - Magis Cafe Food Committee Monitoring System

A purpose-built, high-speed, mobile-friendly web system designed for the **Food Committee** at **Magis Cafe (JIM)** to effortlessly record, track, and analyze date-wise mess discipline violations:
1. 🖐️ **Eat in Hand**
2. 🗑️ **Wasted Food**
3. ⚠️ **Both (Hand + Waste)**

---

## 🚀 Quick Start (1-Click Run)

### Method 1: Windows Double-Click (Easiest)
Simply double-click **`start_magis_cafe.bat`** in this folder.
- The server will boot up and automatically open your default browser to `http://127.0.0.1:5000`.

### Method 2: Command Line
Open PowerShell or Command Prompt in this folder and run:
```bash
python run.py
```

---

## 📱 Using on Smartphone in the Mess (Campus Wi-Fi / Hotspot)

Food committee members can stand or sit at the counter and log incidents directly from their mobile phones!
1. Ensure your phone is connected to the same Wi-Fi or laptop hotspot.
2. In the app on your computer, click **"Use on Phone"** in the top navigation bar.
3. Scan the **QR Code** with your phone's camera, or type:
   ```
   http://172.16.109.73:5000
   ```
   *(Or your computer's current local network IP shown in the console/modal)*.

---

## 🌟 Key Features

### 1. ⚡ Quick Logger (Counter Workhorse)
- **Auto-Meal Detection**: Automatically selects the active meal based on time of day (Breakfast, Lunch, Snacks, Dinner), or toggle any meal with 1 tap.
- **Date Selector**: Switch between Today, Yesterday, or any calendar date for backlog entry.
- **Instant Search**: Type just the last digits of a Roll No (e.g. `101`, `255`) or student name (`Nivone`, `Joy`) — filters instantly in < 10ms. Press `/` anywhere to focus search.
- **1-Click Logging**: Fast action buttons on each student row:
  - 🖐️ **Hand**: Logs "Eat in Hand"
  - 🗑️ **Waste**: Logs "Wasted Food"
  - ⚠️ **Both**: Logs both violations
  - 💬 **+ Note**: Add severity (`Minor`, `Normal`, `Heavy`) or quick tags (`Rice wasted`, `Half meal dumped`, `Rotis in hand`, etc.).
- **Live Activity Feed**: Shows real-time recent entries with an **Undo / Delete** button in case of accidental clicks.
- **Multi-Select Bulk Mode**: Check multiple students at the tray drop counter and log them together in one click!

### 2. 📋 Date-Wise Records & Official Reports
- Filter records by **Date Range** (Today, Yesterday, Last 7 Days, This Month, or Custom Date Picker).
- Filter by **Meal Session**, **Violation Type**, or **Batch**.
- **Download to Excel (.xlsx)**: Generates a professionally styled spreadsheet ready to share.
- **Print / PDF Report**: Clean official layout with JIM Magis Cafe header, summary metrics, and signature blocks for the Warden/Dean.

### 3. 📊 Analytics & Repeat Offender Leaderboard
- Tracks all-time and daily statistics for Eat in Hand vs Food Waste.
- **Repeat Offenders Table**: Identifies students with the highest number of infractions so the Food Committee / Warden can conduct friendly counseling or issue reminders.
- **Visual Charts**: 14-day trend analysis and meal-wise distribution.

### 4. 📥 Uploading II MBA (and Future Batches)
The system comes **pre-loaded with all 110 I MBA students** from `I_MBA_Students Data -110.xlsx`.

When you receive the **II MBA** list:
1. Click **"Students & Upload"** in the navigation bar.
2. Click **"Upload II MBA / Batch Excel"**.
3. Set the Batch Name to `II MBA`.
4. Drag & drop or select the Excel file (`.xlsx` or `.xls`).
5. Click **"Preview File"** to confirm the detected students.
6. Click **"Import Students"** — they will be added immediately into the database without losing any past records!

---

## 📂 Project Structure

```
magis_cafe/
│
├── app.py                      # Flask backend API & Excel/Print routes
├── database.py                 # SQLite database schema, connections & initial seed
├── importer.py                 # Smart Excel parser & importer with auto column mapping
├── run.py                      # Server launcher with auto-browser opening
├── start_magis_cafe.bat        # Windows 1-click launcher
├── magis_cafe.db               # SQLite database (stores all students & logs permanently)
├── I_MBA_Students Data -110.xlsx # Original 110 student data file
│
├── static/
│   ├── css/
│   │   └── style.css           # Modern styling, responsive touch targets
│   └── js/
│       └── app.js              # Fast UI logic, instant search, charts, modals
│
└── templates/
    ├── index.html              # Main single-page web app
    └── print_report.html       # Official print / PDF report template
```

---

## 🛡️ Data Safety & Offline Ready
- All logs and student records are stored locally in `magis_cafe.db` SQLite database.
- Completely self-contained; no external internet required for database storage or logging.
