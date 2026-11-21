# Mobile Repair Shop

An offline-first **Mobile Repair Shop Manager** built with **Kotlin** and **Jetpack Compose (Material 3)**. Designed for daily repair counter workflows with job cards, a 12-point device intake checklist, Khata (credit/dues) ledger, PDF receipts, WhatsApp customer updates, Google Sheets/Drive backup, and built-in GitHub release update checking.

---

## Key Features

- **Clean Fresh Start:** New installations start completely clean with zero preloaded demo jobs or sample inventory.
- **Job Cards & Repair Pipeline:** Track repairs end-to-end across `Diagnostic`, `Waiting for Parts`, `In Progress`, `Ready for Pickup`, `Delivered`, and `Cancelled` stages with timestamped status logs and delivery handover records (self or alternate recipient).
- **12-Point Device Intake Checklist:** Inspect and record hardware condition (`Working`, `Defective`, `Untested`) for touchscreen, display glass, cameras, mic, speaker, charging port, buttons, Wi-Fi/BT, biometrics, housing, and SIM/network.
- **Dashboard KPIs & Fast Search:** View active jobs, ready-for-pickup count, pending dues, and completed jobs at a glance. Search instantly by job number, customer name, phone number, device brand/model, or IMEI/serial.
- **Customer Khata Book:** Customer-wise credit/due ledger with total billed, paid, pending balance, one-tap repeat-customer auto-fill on new jobs, partial/full Khata payment collection, and WhatsApp payment reminders.
- **PDF Receipts, Printing & WhatsApp Dispatch:** Generate A4/thermal-friendly PDF job receipts, share via Android Share Sheet, print via Android Print Service, and send formatted updates or PDF receipts directly to WhatsApp or WhatsApp Business.
- **Google Sheets & Drive Backup (User-Owned):** Sync job cards and shop profile to a `MobileRepairShop_DB` spreadsheet in the user's own Google Drive and schedule nightly backups via WorkManager—with zero hardcoded API keys or embedded secrets.
- **App & Signature Info Inspector:** Built-in **Show Info** screen inside Sync Manager showing live installed APK signing certificates (`SHA-1`, `SHA-256`, `MD5`), certificate metadata, and build details with one-tap copy.
- **Dark, Light & System Themes:** Tuned Material 3 Dark and Light themes selectable in Settings and persisted via DataStore.
- **Repair & Backup Notifications:** Android 13+ runtime `POST_NOTIFICATIONS` support with dedicated notification channels for job updates, nightly Drive backups, and app update alerts.
- **GitHub App Update Checker:** Check `releases/latest` on GitHub right from **Settings -> App Updates (GitHub)** (e.g., `sdm0023/mobile-shop-repair-manager`), view release notes, and open the latest APK release page.
- **Multilingual UI:** Localized in **English**, **Hindi (`hi`)**, and **Gujarati (`gu`)**.

---

## Tech Stack & Architecture

- **Language & Build:** Kotlin `2.2.10`, Android Gradle Plugin `9.1.1`, KSP `2.3.5`, minSdk `24`, targetSdk `36`
- **UI:** Jetpack Compose, Material Design 3 (`ShopTheme`), Edge-to-Edge WindowInsets, adaptive `720.dp` max-width layouts for phones and tablets/POS displays
- **Architecture:** MVVM (`ShopViewModel`) + Unified Repository (`ShopRepository`) + Room DAOs + `StateFlow` (manual dependency wiring, no Hilt/Koin)
- **Persistence:** Room `2.7.0` (`AppDatabase` v6 with non-destructive migrations `1 -> 6`) & Jetpack DataStore Preferences `1.1.7`
- **Networking & Serialization:** Retrofit `2.12.0`, OkHttp `4.10.0`, Moshi `1.15.2` (`moshi-kotlin-codegen`)
- **Background & Auth:** WorkManager `2.12.0`, Google Play Services Auth `21.3.0` (user OAuth for Drive/Sheets)
- **Testing:** JUnit 4, Robolectric `4.16.1`, Kotlinx Coroutines Test

---

## Project Structure

```text
├── app/src/main/java/com/example/   # Android (Kotlin + Jetpack Compose)
│   ├── MainActivity.kt
│   ├── data/
│   │   ├── dao/          # Room DAOs (JobCardDao, InventoryDao, ShopProfileDao)
│   │   ├── database/     # AppDatabase (v1->v6 migrations) & TypeConverters
│   │   ├── entity/       # Room entities (JobCardEntity, InventoryPartEntity, ShopProfileEntity)
│   │   ├── model/        # Domain models (RepairStage, IntakeChecklist, CustomerKhataSummary)
│   │   ├── preferences/  # DataStore AppPreferences (Theme, Notifications, GitHub Repo)
│   │   ├── remote/       # GoogleSheetsApi, GoogleSheetsSyncManager, NightlyBackupWorker,
│   │   │                 # GitHubUpdateApi, AppUpdateChecker, VersionCheckService
│   │   └── repository/   # Unified ShopRepository
│   ├── ui/
│   │   ├── ShopViewModel.kt
│   │   ├── components/   # Reusable M3 components (AppCard, AppButton, AppTextField, Badges)
│   │   ├── screens/      # Dashboard, NewJob, JobDetail, KhataBook, ReceiptPreview, Settings, Sync, ShowInfo
│   │   └── theme/        # Material 3 Dark/Light ColorScheme & ShopSemanticColors
│   └── util/             # NotificationHelper, ReceiptPdfGenerator & AppSignatureInspector
├── web-app/                         # Web App POS (React + Vite + TypeScript)
│   ├── start-pos.bat                # One-click Windows local server launcher (http://localhost:3000)
│   ├── start-pos.command            # macOS / Linux local server launcher
│   ├── LOCAL_SETUP.md               # Detailed local POS & Google Sheets setup guide
│   ├── package.json
│   └── src/
├── .github/workflows/android-apk.yml # Signed Release/Debug APK GitHub Actions workflow
└── version.json                     # Remote versionCode manifest for in-app update checks
```

---

## Download & Install Android APK

> **No manual APK upload needed:** Whenever code is pushed to `main` (or a `v*` tag is created), [GitHub Actions](https://github.com/sdm0023/mobile-shop-repair-manager/actions) automatically builds the Android `.apk` and publishes it under **Releases -> Latest** within ~2–3 minutes.

### APK Download Links
- **Latest APK Download:** [Download Latest APK from GitHub Releases](https://github.com/sdm0023/mobile-shop-repair-manager/releases/latest)
- **All Releases & Changelogs:** [View All Releases](https://github.com/sdm0023/mobile-shop-repair-manager/releases)
- **Build Status (if Latest Release is still building):** [Check GitHub Actions APK Builder](https://github.com/sdm0023/mobile-shop-repair-manager/actions)

### How to Install on Your Android Phone
1. On your Android phone, open **[Latest GitHub Release](https://github.com/sdm0023/mobile-shop-repair-manager/releases/latest)** in Chrome or any browser.
2. Scroll to **Assets** and tap the `.apk` file (e.g., `MobileRepairShop-v1.1.apk` or `MobileRepairShop-v1.1-debug.apk`) to download it.
3. Open the downloaded `.apk` file from your browser downloads or **Files** app.
4. If Android asks *"For your security, your phone isn't allowed to install unknown apps from this source"*:
   - Tap **Settings** -> turn ON **Allow from this source** -> press Back -> tap **Install**.
5. Launch **Mobile Repair Shop** and allow notifications when prompted.
6. **Automatic Updates:** Whenever internet is active on app launch, `VersionCheckService` checks [`version.json`](version.json) on GitHub against `BuildConfig.VERSION_CODE`. If a newer version is available, an **Update Available** banner and prompt appear with **Update Now** and **Later** options.

> **Important Upgrade Note:** Updating over an existing installation preserves all local Room job cards & Khata records only when the new APK uses the same package name (`com.aistudio.mobilerepair.kzptqr`) and same signing keystore (`SHA-1`). Always keep a Google Sheets/Drive backup before switching between Debug and Release APKs.

---

## Web App Version (Desktop / Browser POS)

Alongside the Android app, this repository includes the companion **Web App POS** inside [`web-app/`](web-app/) with matching job cards, Khata ledger, PDF receipt generation (`jsPDF`), WhatsApp dispatch, and 2-way `MobileRepairShop_DB` Google Sheets sync. It can be used in **two ways**:

### 1. Online via Live Web Link (Netlify)
Open directly in any desktop or mobile browser with zero installation:
- **Live URL:** [https://sdmmobailrepairshop.netlify.app/](https://sdmmobailrepairshop.netlify.app/)

### 2. Offline / Local Shop PC via `.bat` Launcher (`web-app/start-pos.bat`)

#### Download Web App Files to Your PC
Choose any of these options to download the latest Web App POS onto a Windows, macOS, or Linux PC:
- **Option A — Direct Web App ZIP (Fastest, Web App Only):** [Download Web App POS ZIP](https://github.com/sdm0023/mobile-shop-repair-manager/raw/main/public/assets/aistudio/mobile-repair-shop-pos.zip) -> Extract the ZIP folder -> Run `start-pos.bat` directly.
- **Option B — Full Repository ZIP (No Git Required):** [Download Full Repo ZIP](https://github.com/sdm0023/mobile-shop-repair-manager/archive/refs/heads/main.zip) -> Extract the ZIP -> Open the `web-app/` folder.
- **Option C — Git Sparse Checkout (Download only `web-app/` via Terminal/PowerShell):**
  ```bash
  git clone --filter=blob:none --sparse https://github.com/sdm0023/mobile-shop-repair-manager.git
  cd mobile-shop-repair-manager
  git sparse-checkout set web-app
  ```

#### Run Locally on Shop PC (`http://localhost:3000`)
1. Open the extracted `web-app/` folder on your PC.
2. Double-click **`start-pos.bat`** on Windows (or run `./start-pos.command` on macOS/Linux).
3. On the first run, `start-pos.bat` automatically checks for **Node.js LTS** (installing it via `winget` or the official `.msi` if missing), runs `npm install --legacy-peer-deps`, builds the production bundle (`npm run build`), starts `npm run preview` on `http://localhost:3000`, and opens your browser.
4. On subsequent runs, it launches immediately. Keep the terminal window open/minimized while using the POS.
5. *(Optional Google Sheets Sync)* Add `http://localhost:3000` (and `https://sdmmobailrepairshop.netlify.app`) to **Authorized JavaScript origins** in your Google Cloud OAuth 2.0 Web Client ID, then connect from **Settings** inside the web app. See [`web-app/LOCAL_SETUP.md`](web-app/LOCAL_SETUP.md) for full details.

---

## Building & Testing Locally (Android)

```bash
# Build Debug APK
gradle :app:assembleDebug

# Run unit & Robolectric tests
gradle :app:testDebugUnitTest
```

### Publishing New Releases for the In-App Update Checker
1. Bump `versionCode` and `versionName` in `app/build.gradle.kts` (for example, `versionCode = 2`, `versionName = "1.1"`) and update [`version.json`](version.json) to match.
2. *(Recommended for production)* Add your permanent signing secrets (`RELEASE_KEYSTORE_BASE64`, `STORE_PASSWORD`, `KEY_PASSWORD`) — or `DEBUG_KEYSTORE_BASE64` for consistent debug signing — under GitHub Repo **Settings -> Secrets and variables -> Actions** (never commit `.jks` or `.keystore` files).
3. Push to `main` (or push tag `v1.1` / run **Actions -> Build & Release Android APK** manually) — GitHub Actions builds the `.apk` and attaches it to **Releases -> Latest** automatically.
4. On user phones, the app automatically checks [`version.json`](version.json) on startup (or manually via **Settings -> App Updates (GitHub)** for `sdm0023/mobile-shop-repair-manager`) and displays the **Update Available** banner/prompt.

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
