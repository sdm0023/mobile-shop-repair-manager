package com.example.ui

import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.net.Uri
import android.widget.Toast
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.BuildConfig
import com.example.R
import com.example.data.database.AppDatabase
import com.example.data.database.Converters
import com.example.data.entity.JobCardEntity
import com.example.data.entity.ShopProfileEntity
import com.example.data.model.ConditionStatus
import com.example.data.model.CustomerKhataSummary
import com.example.data.model.IntakeChecklist
import com.example.data.model.RepairStage
import com.example.data.model.buildCustomerKhataList
import com.example.data.preferences.AppPreferences
import com.example.data.preferences.AppThemeMode
import com.example.data.remote.AppUpdateChecker
import com.example.data.remote.AppUpdateResult
import com.example.data.remote.AuthTokenOutcome
import com.example.data.remote.BackupScheduler
import com.example.data.remote.GoogleSheetsSyncManager
import com.example.data.remote.GoogleSyncConfig
import com.example.data.repository.ShopRepository
import com.example.util.NotificationHelper
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

enum class AppScreen {
    DASHBOARD,
    NEW_JOB,
    JOB_DETAIL,
    KHATA_BOOK,
    KHATA_DETAIL,
    SETTINGS_HOME,
    SHOP_SETTINGS,
    SYNC_MANAGER,
    APP_SIGNATURE_INFO,
    RECEIPT_PREVIEW
}

data class DashboardKpis(
    val activeJobsCount: Int = 0,
    val readyForPickupCount: Int = 0,
    val totalPendingDues: Double = 0.0,
    val completedCount: Int = 0
)

sealed interface UpdateCheckUiState {
    data object Idle : UpdateCheckUiState
    data object Checking : UpdateCheckUiState
    data class UpdateAvailable(
        val currentVersion: String,
        val latestVersion: String,
        val releaseTitle: String,
        val releaseNotes: String,
        val releasePageUrl: String,
        val apkDownloadUrl: String?
    ) : UpdateCheckUiState
    data class UpToDate(
        val currentVersion: String,
        val latestVersion: String,
        val releasePageUrl: String
    ) : UpdateCheckUiState
    data class NoReleases(val repoSlug: String) : UpdateCheckUiState
    data object InvalidRepo : UpdateCheckUiState
    data class Error(val message: String) : UpdateCheckUiState
}

class ShopViewModel(application: Application) : AndroidViewModel(application) {

    private val repository: ShopRepository
    private val appPreferences = AppPreferences(application)

    val themeMode: StateFlow<AppThemeMode> = appPreferences.themeMode
        .catch { emit(AppThemeMode.DARK) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), AppThemeMode.DARK)

    val notificationsEnabled: StateFlow<Boolean> = appPreferences.notificationsEnabled
        .catch { emit(true) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), true)

    val githubRepoSlug: StateFlow<String> = appPreferences.githubRepoSlug
        .catch { emit(AppPreferences.DEFAULT_GITHUB_REPO_SLUG) }
        .stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5000),
            AppPreferences.DEFAULT_GITHUB_REPO_SLUG
        )

    private val _updateCheckState = MutableStateFlow<UpdateCheckUiState>(UpdateCheckUiState.Idle)
    val updateCheckState: StateFlow<UpdateCheckUiState> = _updateCheckState.asStateFlow()

    private val _isUpdateBannerDismissed = MutableStateFlow(false)
    val showUpdateBanner: StateFlow<Boolean> = combine(
        _updateCheckState,
        _isUpdateBannerDismissed
    ) { state, dismissed ->
        state is UpdateCheckUiState.UpdateAvailable && !dismissed
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    private val _showStartupUpdateDialog = MutableStateFlow(false)
    val showStartupUpdateDialog: StateFlow<Boolean> = _showStartupUpdateDialog.asStateFlow()
    private var hasHandledStartupUpdatePrompt = false
    
    // UI Transient Error State
    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    // Google Sheets Sync & Backup State
    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    private val _isBackingUp = MutableStateFlow(false)
    val isBackingUp: StateFlow<Boolean> = _isBackingUp.asStateFlow()

    private var pendingBackupAfterConsent = false
    private var foregroundSyncJob: Job? = null

    init {
        NotificationHelper.ensureChannels(application)
        val db = AppDatabase.getInstance(application)
        val syncManager = GoogleSheetsSyncManager(application, db.jobCardDao(), db.shopProfileDao())
        repository = ShopRepository(db, syncManager)
        viewModelScope.launch {
            try {
                repository.seedInitialDataIfEmpty()
                repository.tryBackgroundAutoSync()
                val cfg = repository.googleSyncConfig.first()
                if (cfg.isConnected && cfg.nightlyBackupEnabled) {
                    BackupScheduler.scheduleNightlyBackup(getApplication())
                }
                val savedRepo = appPreferences.githubRepoSlug.first()
                if (savedRepo.isNotBlank()) {
                    checkForAppUpdateInternal(savedRepo, manual = false)
                }
            } catch (e: Exception) {
                _errorMessage.value = "Initialization notice: ${e.message}"
            }
        }
    }

    fun setThemeMode(mode: AppThemeMode) {
        viewModelScope.launch {
            try {
                appPreferences.setThemeMode(mode)
            } catch (e: Exception) {
                _errorMessage.value = "Failed updating theme: ${e.message}"
            }
        }
    }

    fun setNotificationsEnabled(enabled: Boolean) {
        viewModelScope.launch {
            try {
                appPreferences.setNotificationsEnabled(enabled)
            } catch (e: Exception) {
                _errorMessage.value = "Failed updating notification preference: ${e.message}"
            }
        }
    }

    fun sendTestNotification(): Boolean {
        return NotificationHelper.sendTestNotification(getApplication())
    }

    fun checkForAppUpdate(repoOverride: String? = null, manual: Boolean = true) {
        viewModelScope.launch {
            val candidate = repoOverride ?: githubRepoSlug.value.ifBlank { appPreferences.githubRepoSlug.first() }
            if (candidate.isBlank()) {
                _updateCheckState.value = UpdateCheckUiState.InvalidRepo
                return@launch
            }
            val parsed = AppUpdateChecker.parseRepoSlug(candidate)
            if (parsed == null) {
                _updateCheckState.value = UpdateCheckUiState.InvalidRepo
                return@launch
            }
            val normalized = "${parsed.first}/${parsed.second}"
            if (normalized != githubRepoSlug.value) {
                appPreferences.setGithubRepoSlug(normalized)
            }
            checkForAppUpdateInternal(normalized, manual = manual)
        }
    }

    private suspend fun checkForAppUpdateInternal(repoSlug: String, manual: Boolean) {
        if (manual) {
            _updateCheckState.value = UpdateCheckUiState.Checking
        }
        val result = repository.checkAppUpdate(
            repoSlug = repoSlug,
            currentVersionCode = BuildConfig.VERSION_CODE,
            currentVersionName = BuildConfig.VERSION_NAME
        )
        when (result) {
            is AppUpdateResult.UpdateAvailable -> {
                _isUpdateBannerDismissed.value = false
                _updateCheckState.value = UpdateCheckUiState.UpdateAvailable(
                    currentVersion = result.currentVersion,
                    latestVersion = result.latestVersion,
                    releaseTitle = result.releaseTitle,
                    releaseNotes = result.releaseNotes,
                    releasePageUrl = result.releasePageUrl,
                    apkDownloadUrl = result.apkDownloadUrl
                )
                if (!manual && !hasHandledStartupUpdatePrompt) {
                    hasHandledStartupUpdatePrompt = true
                    _showStartupUpdateDialog.value = true
                }
                if (!manual && notificationsEnabled.value) {
                    NotificationHelper.notifyAppUpdateAvailable(
                        context = getApplication(),
                        latestVersion = result.latestVersion,
                        releaseUrl = result.releasePageUrl
                    )
                }
            }
            is AppUpdateResult.UpToDate -> {
                _updateCheckState.value = UpdateCheckUiState.UpToDate(
                    currentVersion = result.currentVersion,
                    latestVersion = result.latestVersion,
                    releasePageUrl = result.releasePageUrl
                )
            }
            is AppUpdateResult.NoReleasesFound -> {
                if (manual) {
                    _updateCheckState.value = UpdateCheckUiState.NoReleases(result.repoSlug)
                }
            }
            AppUpdateResult.InvalidRepo -> {
                if (manual) {
                    _updateCheckState.value = UpdateCheckUiState.InvalidRepo
                }
            }
            is AppUpdateResult.Error -> {
                if (manual) {
                    _updateCheckState.value = UpdateCheckUiState.Error(result.message)
                }
            }
        }
    }

    fun dismissStartupUpdateDialog() {
        _showStartupUpdateDialog.value = false
    }

    fun dismissUpdateBanner() {
        _isUpdateBannerDismissed.value = true
    }

    fun openUpdateReleasePage(context: Context, url: String) {
        if (!AppUpdateChecker.isTrustedUpdateUrl(url)) {
            Toast.makeText(context, "Blocked untrusted update link", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url.trim())).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(context, "Browser error: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    fun openJobFromNotification(jobId: Long) {
        if (jobId > 0L) {
            selectedJobId = jobId
            currentScreen = AppScreen.JOB_DETAIL
        }
    }

    fun setAppForeground(isForeground: Boolean) {
        if (isForeground) {
            if (foregroundSyncJob?.isActive == true) return
            foregroundSyncJob = viewModelScope.launch {
                while (isActive) {
                    if (!_isSyncing.value && !_isBackingUp.value && googleSyncConfig.value.isConnected) {
                        repository.tryBackgroundAutoSync()
                    }
                    delay(10_000L)
                }
            }
        } else {
            foregroundSyncJob?.cancel()
            foregroundSyncJob = null
        }
    }

    override fun onCleared() {
        foregroundSyncJob?.cancel()
        super.onCleared()
    }

    // Navigation State
    var currentScreen by mutableStateOf(AppScreen.DASHBOARD)
        private set
    var selectedJobId by mutableStateOf<Long?>(null)
        private set

    // Search and Filter State
    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _selectedStageFilter = MutableStateFlow<RepairStage?>(null)
    val selectedStageFilter: StateFlow<RepairStage?> = _selectedStageFilter.asStateFlow()

    // Resilient Core Data Flows with .catch operator
    val allJobs: StateFlow<List<JobCardEntity>> = repository.allJobs
        .catch { e -> _errorMessage.value = "Failed loading jobs: ${e.message}" }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val shopProfile: StateFlow<ShopProfileEntity> = repository.shopProfile
        .catch { emit(ShopProfileEntity()) }
        .combine(MutableStateFlow(ShopProfileEntity())) { profile, default -> profile ?: default }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), ShopProfileEntity())

    val googleSyncConfig: StateFlow<GoogleSyncConfig> = repository.googleSyncConfig
        .catch { emit(GoogleSyncConfig()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), GoogleSyncConfig())

    // Filtered Jobs State with Enhanced Phone Number & Multi-attribute Search
    val filteredJobs: StateFlow<List<JobCardEntity>> = combine(
        allJobs,
        _searchQuery,
        _selectedStageFilter
    ) { jobs, query, stage ->
        var list = jobs
        if (stage != null) {
            list = list.filter { it.stage == stage }
        }
        if (query.isNotBlank()) {
            val q = query.trim().lowercase()
            val digitsOnlyQuery = q.filter { it.isDigit() }
            list = list.filter {
                val digitsOnlyPhone = it.customerPhone.filter { ch -> ch.isDigit() }
                val matchesPhone = (digitsOnlyQuery.isNotEmpty() && digitsOnlyPhone.contains(digitsOnlyQuery)) ||
                        it.customerPhone.lowercase().contains(q)

                matchesPhone ||
                it.customerName.lowercase().contains(q) ||
                it.jobNumber.lowercase().contains(q) ||
                it.deviceModel.lowercase().contains(q) ||
                it.deviceBrand.lowercase().contains(q) ||
                it.imeiOrSerial.lowercase().contains(q)
            }
        }
        list
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    // KPI Metrics calculation
    val kpiMetrics: StateFlow<DashboardKpis> = allJobs.combine(MutableStateFlow(Unit)) { jobs, _ ->
        val active = jobs.filter { it.stage != RepairStage.DELIVERED && it.stage != RepairStage.CANCELLED }
        val ready = jobs.filter { it.stage == RepairStage.READY_FOR_PICKUP }
        val dues = jobs.filter { !it.isPaid && it.stage != RepairStage.CANCELLED }.sumOf { it.balanceDue }
        val completed = jobs.filter { it.stage == RepairStage.DELIVERED }
        DashboardKpis(
            activeJobsCount = active.size,
            readyForPickupCount = ready.size,
            totalPendingDues = dues,
            completedCount = completed.size
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), DashboardKpis())

    // Khata Book State
    private val _khataSearchQuery = MutableStateFlow("")
    val khataSearchQuery: StateFlow<String> = _khataSearchQuery.asStateFlow()

    private val _khataOnlyDuesFilter = MutableStateFlow(false)
    val khataOnlyDuesFilter: StateFlow<Boolean> = _khataOnlyDuesFilter.asStateFlow()

    private val _selectedKhataKey = MutableStateFlow<String?>(null)
    val selectedKhataKey: StateFlow<String?> = _selectedKhataKey.asStateFlow()

    val khataCustomers: StateFlow<List<CustomerKhataSummary>> = allJobs
        .combine(MutableStateFlow(Unit)) { jobs, _ -> buildCustomerKhataList(jobs) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val filteredKhataCustomers: StateFlow<List<CustomerKhataSummary>> = combine(
        khataCustomers,
        _khataSearchQuery,
        _khataOnlyDuesFilter
    ) { customers, query, onlyDues ->
        var list = customers
        if (onlyDues) {
            list = list.filter { it.totalPendingDue > 0.01 }
        }
        if (query.isNotBlank()) {
            val q = query.trim().lowercase()
            val digits = q.filter { it.isDigit() }
            list = list.filter { item ->
                val phoneDigits = item.customerPhone.filter { it.isDigit() }
                item.customerName.lowercase().contains(q) ||
                    item.customerPhone.lowercase().contains(q) ||
                    (digits.isNotEmpty() && phoneDigits.contains(digits))
            }
        }
        list
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val selectedKhataCustomer: StateFlow<CustomerKhataSummary?> = combine(
        khataCustomers,
        _selectedKhataKey
    ) { customers, key ->
        customers.find { it.customerKey == key }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    // New Job Intake Form State
    var newCustomerName by mutableStateOf("")
    var newCustomerPhone by mutableStateOf("")
    var newDeviceBrand by mutableStateOf("Apple")
    var newDeviceModel by mutableStateOf("")
    var newDeviceColor by mutableStateOf("")
    var newImeiOrSerial by mutableStateOf("")
    var newSecurityLockCode by mutableStateOf("")
    var newIssueDescription by mutableStateOf("")
    var newSelectedIssueTags by mutableStateOf(setOf<String>())
    var newChecklist by mutableStateOf(IntakeChecklist())
    var newEstimatedCost by mutableStateOf("")
    var newAdvancePaid by mutableStateOf("")
    var newTechnicianNotes by mutableStateOf("")

    // Dialog & Action States
    var showPaymentDialog by mutableStateOf(false)
    var showStatusDialog by mutableStateOf(false)
    var showDeliveryHandoverDialog by mutableStateOf(false)
    var showReceiptShareDialog by mutableStateOf(false)
    var receiptTargetJob by mutableStateOf<JobCardEntity?>(null)
    var statusUpdateNote by mutableStateOf("")
    var pendingDeliveryNote by mutableStateOf("")
    var showWhatsAppPreviewDialog by mutableStateOf(false)
    var customWhatsAppText by mutableStateOf("")
    var whatsAppTargetJob by mutableStateOf<JobCardEntity?>(null)

    val selectedJob: JobCardEntity?
        get() = allJobs.value.find { it.id == selectedJobId }

    fun clearError() {
        _errorMessage.value = null
    }

    // Navigation Methods
    fun navigateTo(screen: AppScreen, jobId: Long? = null) {
        if (jobId != null) {
            selectedJobId = jobId
        }
        currentScreen = screen
    }

    fun navigateBack(): Boolean {
        return when (currentScreen) {
            AppScreen.NEW_JOB,
            AppScreen.JOB_DETAIL,
            AppScreen.KHATA_BOOK,
            AppScreen.SETTINGS_HOME -> {
                currentScreen = AppScreen.DASHBOARD
                true
            }
            AppScreen.KHATA_DETAIL -> {
                currentScreen = AppScreen.KHATA_BOOK
                true
            }
            AppScreen.SHOP_SETTINGS,
            AppScreen.SYNC_MANAGER -> {
                currentScreen = AppScreen.SETTINGS_HOME
                true
            }
            AppScreen.APP_SIGNATURE_INFO -> {
                currentScreen = AppScreen.SYNC_MANAGER
                true
            }
            AppScreen.RECEIPT_PREVIEW -> {
                currentScreen = if (selectedJobId != null) AppScreen.JOB_DETAIL else AppScreen.DASHBOARD
                true
            }
            AppScreen.DASHBOARD -> false
        }
    }

    fun onKhataSearchQueryChanged(query: String) {
        _khataSearchQuery.value = query
    }

    fun onKhataOnlyDuesChanged(onlyDues: Boolean) {
        _khataOnlyDuesFilter.value = onlyDues
    }

    fun openKhataDetail(customerKey: String) {
        _selectedKhataKey.value = customerKey
        currentScreen = AppScreen.KHATA_DETAIL
    }

    fun startNewJobForCustomer(name: String, phone: String) {
        resetNewJobForm()
        newCustomerName = name
        newCustomerPhone = phone
        currentScreen = AppScreen.NEW_JOB
    }

    fun recordKhataPayment(
        customerKey: String,
        amount: Double,
        paymentMode: String,
        note: String = "",
        onSuccess: (Int) -> Unit = {},
        onError: (String) -> Unit = {}
    ) {
        viewModelScope.launch {
            try {
                val updatedJobs = repository.recordCustomerKhataPayment(customerKey, amount, paymentMode, note)
                onSuccess(updatedJobs)
            } catch (e: Exception) {
                val msg = e.message ?: "Failed saving Khata payment"
                _errorMessage.value = msg
                onError(msg)
            }
        }
    }

    fun prepareKhataWhatsAppReminder(summary: CustomerKhataSummary) {
        whatsAppTargetJob = summary.jobs.firstOrNull()
        customWhatsAppText = repository.generateKhataReminderText(summary, shopProfile.value)
        showWhatsAppPreviewDialog = true
    }

    fun onSearchQueryChanged(query: String) {
        _searchQuery.value = query
    }

    fun onStageFilterChanged(stage: RepairStage?) {
        _selectedStageFilter.value = stage
    }

    fun resetNewJobForm() {
        newCustomerName = ""
        newCustomerPhone = ""
        newDeviceBrand = "Apple"
        newDeviceModel = ""
        newDeviceColor = ""
        newImeiOrSerial = ""
        newSecurityLockCode = ""
        newIssueDescription = ""
        newSelectedIssueTags = emptySet()
        newChecklist = IntakeChecklist()
        newEstimatedCost = ""
        newAdvancePaid = ""
        newTechnicianNotes = ""
    }

    fun toggleIssueTag(tag: String) {
        newSelectedIssueTags = if (newSelectedIssueTags.contains(tag)) {
            newSelectedIssueTags - tag
        } else {
            newSelectedIssueTags + tag
        }
    }

    fun updateChecklistPoint(key: String, status: ConditionStatus) {
        newChecklist = when (key) {
            "Screen Touch" -> newChecklist.copy(screenTouch = status)
            "Display / LCD" -> newChecklist.copy(displayGlass = status)
            "Front Camera" -> newChecklist.copy(frontCamera = status)
            "Rear Camera" -> newChecklist.copy(rearCamera = status)
            "Microphone" -> newChecklist.copy(microphone = status)
            "Speaker / Audio" -> newChecklist.copy(speaker = status)
            "Charging Port" -> newChecklist.copy(chargingPort = status)
            "Power / Vol Buttons" -> newChecklist.copy(physicalButtons = status)
            "Wi-Fi / BT" -> newChecklist.copy(wifiBluetooth = status)
            "Fingerprint / FaceID" -> newChecklist.copy(biometrics = status)
            "Body Housing / Dent" -> newChecklist.copy(housingCondition = status)
            "SIM / Cellular" -> newChecklist.copy(simNetwork = status)
            else -> newChecklist
        }
    }

    fun submitNewJob(onSuccess: (Long) -> Unit, onError: (String) -> Unit) {
        if (newCustomerName.isBlank()) {
            onError("Customer Name is required")
            return
        }
        if (newCustomerPhone.isBlank()) {
            onError("Customer Phone number is required")
            return
        }
        if (newDeviceModel.isBlank()) {
            onError("Device Model is required")
            return
        }
        if (newIssueDescription.isBlank()) {
            onError("Fault complaint description is required")
            return
        }

        val estCost = if (newEstimatedCost.isBlank()) {
            0.0
        } else {
            newEstimatedCost.trim().toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0.0 } ?: run {
                onError(getApplication<Application>().getString(R.string.error_invalid_amount))
                return
            }
        }
        val advPaid = if (newAdvancePaid.isBlank()) {
            0.0
        } else {
            newAdvancePaid.trim().toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0.0 } ?: run {
                onError(getApplication<Application>().getString(R.string.error_invalid_amount))
                return
            }
        }

        val capturedCustomerName = newCustomerName.trim()
        val capturedDeviceName = "${newDeviceBrand.trim()} ${newDeviceModel.trim()}".trim()

        viewModelScope.launch {
            try {
                val jobId = repository.createJob(
                    customerName = newCustomerName,
                    customerPhone = newCustomerPhone,
                    deviceBrand = newDeviceBrand,
                    deviceModel = newDeviceModel,
                    deviceColor = newDeviceColor,
                    imeiOrSerial = newImeiOrSerial,
                    securityLockCode = newSecurityLockCode,
                    issueDescription = newIssueDescription,
                    issueTags = newSelectedIssueTags.toList(),
                    checklist = newChecklist,
                    estimatedCost = estCost,
                    advancePaid = advPaid,
                    technicianNotes = newTechnicianNotes
                )
                val createdJob = repository.getJobById(jobId).first()
                if (notificationsEnabled.value) {
                    NotificationHelper.notifyJobCreated(
                        context = getApplication(),
                        jobId = jobId,
                        jobNumber = createdJob?.jobNumber ?: "#$jobId",
                        customerName = capturedCustomerName,
                        deviceName = capturedDeviceName
                    )
                }
                resetNewJobForm()
                selectedJobId = jobId
                onSuccess(jobId)
            } catch (e: Exception) {
                onError("Database error: ${e.message}")
            }
        }
    }

    fun updateJobStage(stage: RepairStage, note: String = "") {
        val id = selectedJobId ?: return
        viewModelScope.launch {
            try {
                val existingJob = selectedJob ?: repository.getJobById(id).first()
                repository.updateJobStage(id, stage, note)
                statusUpdateNote = ""
                if (notificationsEnabled.value && existingJob != null) {
                    NotificationHelper.notifyStageUpdated(
                        context = getApplication(),
                        jobId = id,
                        jobNumber = existingJob.jobNumber,
                        customerName = existingJob.customerName,
                        deviceName = "${existingJob.deviceBrand} ${existingJob.deviceModel}".trim(),
                        stage = stage
                    )
                }
            } catch (e: Exception) {
                _errorMessage.value = "Failed updating status: ${e.message}"
            }
        }
    }

    fun completeJobAndDeliver(
        finalCost: Double,
        discount: Double,
        isPaid: Boolean,
        paymentMode: String,
        pickedUpByOriginalCustomer: Boolean,
        recipientName: String,
        recipientPhone: String,
        deliveryNote: String = "",
        onSuccess: () -> Unit = {}
    ) {
        val id = selectedJobId ?: return
        viewModelScope.launch {
            try {
                repository.completeJobAndDeliver(
                    jobId = id,
                    finalCost = finalCost,
                    discount = discount,
                    isPaid = isPaid,
                    paymentMode = paymentMode,
                    pickedUpByOriginalCustomer = pickedUpByOriginalCustomer,
                    recipientName = recipientName,
                    recipientPhone = recipientPhone,
                    deliveryNote = deliveryNote
                )
                showDeliveryHandoverDialog = false
                onSuccess()
            } catch (e: Exception) {
                _errorMessage.value = "Failed completing delivery: ${e.message}"
            }
        }
    }

    fun recordPayment(finalCost: Double, discount: Double, isPaid: Boolean, paymentMode: String) {
        val id = selectedJobId ?: return
        viewModelScope.launch {
            try {
                repository.updateJobPayment(id, finalCost, discount, isPaid, paymentMode)
                showPaymentDialog = false
            } catch (e: Exception) {
                _errorMessage.value = "Failed saving payment: ${e.message}"
            }
        }
    }

    fun updateTechnicianNotes(notes: String) {
        val id = selectedJobId ?: return
        viewModelScope.launch {
            try {
                repository.updateJobNotes(id, notes)
            } catch (e: Exception) {
                _errorMessage.value = "Failed saving notes: ${e.message}"
            }
        }
    }

    fun updateJobCard(
        updatedJob: JobCardEntity,
        onSuccess: () -> Unit = {},
        onError: (String) -> Unit = {}
    ) {
        viewModelScope.launch {
            try {
                repository.updateJobCard(updatedJob)
                onSuccess()
            } catch (e: Exception) {
                val err = "Failed updating job: ${e.message}"
                _errorMessage.value = err
                onError(err)
            }
        }
    }

    fun deleteCurrentJob(onDeleted: () -> Unit) {
        val id = selectedJobId ?: return
        viewModelScope.launch {
            try {
                repository.deleteJob(id)
                selectedJobId = null
                currentScreen = AppScreen.DASHBOARD
                onDeleted()
            } catch (e: Exception) {
                _errorMessage.value = "Failed deleting ticket: ${e.message}"
            }
        }
    }

    // Shop Profile Settings
    fun updateShopProfile(profile: ShopProfileEntity, onSaved: () -> Unit) {
        viewModelScope.launch {
            try {
                repository.updateShopProfile(profile)
                onSaved()
            } catch (e: Exception) {
                _errorMessage.value = "Failed saving profile: ${e.message}"
            }
        }
    }

    // Google Sheets Cloud Sync (User's Own Google Account / Drive)
    fun connectAndSyncGoogleSheets(
        activityContext: Context,
        onNeedsConsent: (IntentSender) -> Unit,
        onMessage: (String) -> Unit
    ) {
        syncNowWithGoogleSheets(activityContext, onNeedsConsent, onMessage)
    }

    fun syncNowWithGoogleSheets(
        activityContext: Context,
        onNeedsConsent: (IntentSender) -> Unit,
        onMessage: (String) -> Unit
    ) {
        if (_isSyncing.value || _isBackingUp.value) return
        viewModelScope.launch {
            pendingBackupAfterConsent = false
            _isSyncing.value = true
            try {
                when (val outcome = repository.requestGoogleAuth(activityContext)) {
                    is AuthTokenOutcome.Ready -> {
                        val summary = repository.syncWithGoogleToken(outcome.accessToken)
                        if (summary != null) {
                            if (googleSyncConfig.value.nightlyBackupEnabled) {
                                BackupScheduler.scheduleNightlyBackup(getApplication())
                            }
                            onMessage(
                                getApplication<Application>().getString(
                                    R.string.sheets_sync_success,
                                    summary.pulledCount,
                                    summary.pushedCount
                                )
                            )
                        }
                    }
                    is AuthTokenOutcome.NeedsConsent -> {
                        onNeedsConsent(outcome.intentSender)
                    }
                    null -> {
                        onMessage(getApplication<Application>().getString(R.string.sheets_sync_failed, "Sync unavailable"))
                    }
                }
            } catch (e: Exception) {
                val msg = e.message ?: "Unknown error"
                _errorMessage.value = msg
                onMessage(getApplication<Application>().getString(R.string.sheets_sync_failed, msg))
            } finally {
                _isSyncing.value = false
            }
        }
    }

    fun handleGoogleConsentResult(
        activityContext: Context,
        resultCode: Int,
        data: Intent?,
        onMessage: (String) -> Unit
    ) {
        val runBackup = pendingBackupAfterConsent
        pendingBackupAfterConsent = false
        viewModelScope.launch {
            if (runBackup) {
                _isBackingUp.value = true
            } else {
                _isSyncing.value = true
            }
            try {
                if (data == null && resultCode != android.app.Activity.RESULT_OK) {
                    val resId = if (runBackup) R.string.backup_failed_toast else R.string.sheets_sync_failed
                    onMessage(
                        getApplication<Application>().getString(
                            resId,
                            "OAuth cancelled (resultCode=$resultCode). Check Android OAuth Client & Test Users in Google Cloud."
                        )
                    )
                    return@launch
                }
                val token = repository.extractGoogleToken(data, activityContext)
                if (token.isNullOrBlank()) {
                    val resId = if (runBackup) R.string.backup_failed_toast else R.string.sheets_sync_failed
                    onMessage(
                        getApplication<Application>().getString(
                            resId,
                            "Authorization cancelled (resultCode=$resultCode)"
                        )
                    )
                    return@launch
                }
                if (runBackup) {
                    val backupName = repository.runFullDriveBackupNow(token, forceNewSnapshot = true)
                    if (!backupName.isNullOrBlank()) {
                        if (googleSyncConfig.value.nightlyBackupEnabled) {
                            BackupScheduler.scheduleNightlyBackup(getApplication())
                        }
                        onMessage(
                            getApplication<Application>().getString(
                                R.string.backup_success_toast,
                                backupName
                            )
                        )
                    }
                } else {
                    val summary = repository.syncWithGoogleToken(token)
                    if (summary != null) {
                        if (googleSyncConfig.value.nightlyBackupEnabled) {
                            BackupScheduler.scheduleNightlyBackup(getApplication())
                        }
                        onMessage(
                            getApplication<Application>().getString(
                                R.string.sheets_sync_success,
                                summary.pulledCount,
                                summary.pushedCount
                            )
                        )
                    }
                }
            } catch (e: Exception) {
                val msg = e.message ?: "Authorization failed"
                _errorMessage.value = msg
                val resId = if (runBackup) R.string.backup_failed_toast else R.string.sheets_sync_failed
                onMessage(getApplication<Application>().getString(resId, msg))
            } finally {
                _isSyncing.value = false
                _isBackingUp.value = false
            }
        }
    }

    fun toggleNightlyBackup(enabled: Boolean) {
        viewModelScope.launch {
            try {
                repository.setNightlyBackupEnabled(enabled)
                val cfg = repository.googleSyncConfig.first()
                if (enabled && cfg.isConnected) {
                    BackupScheduler.scheduleNightlyBackup(getApplication())
                } else if (!enabled) {
                    BackupScheduler.cancelNightlyBackup(getApplication())
                }
            } catch (e: Exception) {
                _errorMessage.value = "Backup schedule error: ${e.message}"
            }
        }
    }

    fun backupNowToGoogleDrive(
        activityContext: Context,
        onNeedsConsent: (IntentSender) -> Unit,
        onMessage: (String) -> Unit
    ) {
        if (_isSyncing.value || _isBackingUp.value) return
        viewModelScope.launch {
            _isBackingUp.value = true
            try {
                when (val outcome = repository.requestGoogleAuth(activityContext)) {
                    is AuthTokenOutcome.Ready -> {
                        val backupName = repository.runFullDriveBackupNow(outcome.accessToken, forceNewSnapshot = true)
                        if (!backupName.isNullOrBlank()) {
                            if (googleSyncConfig.value.nightlyBackupEnabled) {
                                BackupScheduler.scheduleNightlyBackup(getApplication())
                            }
                            onMessage(
                                getApplication<Application>().getString(
                                    R.string.backup_success_toast,
                                    backupName
                                )
                            )
                        }
                    }
                    is AuthTokenOutcome.NeedsConsent -> {
                        pendingBackupAfterConsent = true
                        onNeedsConsent(outcome.intentSender)
                    }
                    null -> {
                        onMessage(getApplication<Application>().getString(R.string.backup_failed_toast, "Backup unavailable"))
                    }
                }
            } catch (e: Exception) {
                val msg = e.message ?: "Unknown error"
                _errorMessage.value = msg
                onMessage(getApplication<Application>().getString(R.string.backup_failed_toast, msg))
            } finally {
                _isBackingUp.value = false
            }
        }
    }

    fun linkExistingSpreadsheet(
        activityContext: Context,
        rawUrlOrId: String,
        onNeedsConsent: (IntentSender) -> Unit,
        onMessage: (String) -> Unit
    ) {
        if (rawUrlOrId.isBlank()) {
            onMessage(getApplication<Application>().getString(R.string.sheets_sync_failed, "Empty Sheet URL or ID"))
            return
        }
        viewModelScope.launch {
            try {
                repository.saveCustomSpreadsheetId(rawUrlOrId)
                syncNowWithGoogleSheets(activityContext, onNeedsConsent, onMessage)
            } catch (e: Exception) {
                val msg = e.message ?: "Invalid Spreadsheet ID"
                onMessage(getApplication<Application>().getString(R.string.sheets_sync_failed, msg))
            }
        }
    }

    fun disconnectGoogleSheets(onMessage: (String) -> Unit) {
        viewModelScope.launch {
            try {
                repository.disconnectGoogleSheets()
                BackupScheduler.cancelNightlyBackup(getApplication())
                onMessage(getApplication<Application>().getString(R.string.sheets_disconnected_toast))
            } catch (e: Exception) {
                _errorMessage.value = "Failed disconnecting: ${e.message}"
            }
        }
    }

    fun openGoogleSheetInBrowser(context: Context) {
        val sheetId = googleSyncConfig.value.spreadsheetId
        if (sheetId.isBlank()) return
        try {
            val intent = Intent(
                Intent.ACTION_VIEW,
                Uri.parse("https://docs.google.com/spreadsheets/d/$sheetId")
            ).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(context, "Browser error: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    // WhatsApp Dispatcher
    fun prepareWhatsAppMessage(job: JobCardEntity) {
        whatsAppTargetJob = job
        customWhatsAppText = repository.generateWhatsAppTemplate(job, shopProfile.value)
        showWhatsAppPreviewDialog = true
    }

    fun updateCustomWhatsAppText(text: String) {
        customWhatsAppText = text
    }

    fun dismissWhatsAppPreview() {
        showWhatsAppPreviewDialog = false
        whatsAppTargetJob = null
    }

    fun sendWhatsAppMessage(context: Context, job: JobCardEntity? = null, targetPackage: String? = null) {
        val targetJob = job ?: whatsAppTargetJob ?: selectedJob
        if (targetJob != null) {
            val messageToSend = if (customWhatsAppText.isNotBlank()) customWhatsAppText else repository.generateWhatsAppTemplate(targetJob, shopProfile.value)
            val chosenPackage = targetPackage ?: shopProfile.value.preferredWhatsAppPackage
            repository.launchWhatsAppSafely(context, targetJob, messageToSend, chosenPackage)
            showWhatsAppPreviewDialog = false
        } else {
            Toast.makeText(context, "No ticket selected", Toast.LENGTH_SHORT).show()
        }
    }

    fun isAppInstalled(context: Context, packageName: String): Boolean {
        return repository.isAppInstalled(context, packageName)
    }

    fun copyWhatsAppMessage(context: Context) {
        try {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
            val clip = android.content.ClipData.newPlainText("WhatsApp Repair Update", customWhatsAppText)
            clipboard?.setPrimaryClip(clip)
            Toast.makeText(context, context.getString(R.string.whatsapp_copied_toast), Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(context, "Copy failed: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    fun callCustomer(context: Context, phone: String) {
        try {
            val intent = repository.createDialIntent(phone)
            context.startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(context, "Dialer error: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    fun openReceiptShareDialog(job: JobCardEntity) {
        receiptTargetJob = job
        showReceiptShareDialog = true
    }

    fun dismissReceiptShareDialog() {
        showReceiptShareDialog = false
        receiptTargetJob = null
    }

    fun sendReceiptViaWhatsApp(context: Context, job: JobCardEntity? = null, targetPackage: String? = null) {
        sendReceiptPdfViaWhatsApp(context, job, targetPackage)
    }

    fun sendReceiptPdfViaWhatsApp(
        context: Context,
        job: JobCardEntity? = null,
        targetPackage: String? = null
    ) {
        val targetJob = job ?: receiptTargetJob ?: selectedJob
        if (targetJob == null) {
            Toast.makeText(context, "No ticket selected", Toast.LENGTH_SHORT).show()
            return
        }
        val chosenPackage = targetPackage ?: shopProfile.value.preferredWhatsAppPackage
        viewModelScope.launch {
            try {
                val profile = shopProfile.value
                val pdfFile = repository.generateReceiptPdfFile(context, targetJob, profile)
                val pdfUri = repository.getReceiptPdfUri(context, pdfFile)
                val launched = repository.shareReceiptPdfToWhatsApp(context, pdfUri, targetJob, profile, chosenPackage)
                if (launched) {
                    Toast.makeText(context, context.getString(R.string.receipt_sent_toast), Toast.LENGTH_SHORT).show()
                    showReceiptShareDialog = false
                }
            } catch (e: Exception) {
                Toast.makeText(context, context.getString(R.string.pdf_generate_error), Toast.LENGTH_SHORT).show()
            }
        }
    }

    fun shareJobReceiptPdf(context: Context, job: JobCardEntity) {
        viewModelScope.launch {
            try {
                val profile = shopProfile.value
                val pdfFile = repository.generateReceiptPdfFile(context, job, profile)
                val pdfUri = repository.getReceiptPdfUri(context, pdfFile)
                repository.shareReceiptPdfGeneral(context, pdfUri, job)
            } catch (e: Exception) {
                Toast.makeText(context, context.getString(R.string.pdf_generate_error), Toast.LENGTH_SHORT).show()
            }
        }
    }

    fun printJobReceiptPdf(context: Context, job: JobCardEntity) {
        viewModelScope.launch {
            try {
                val profile = shopProfile.value
                val pdfFile = repository.generateReceiptPdfFile(context, job, profile)
                repository.printReceiptPdf(context, pdfFile, job)
            } catch (e: Exception) {
                Toast.makeText(context, context.getString(R.string.pdf_generate_error), Toast.LENGTH_SHORT).show()
            }
        }
    }

    fun shareJobReceipt(context: Context, job: JobCardEntity) {
        shareJobReceiptPdf(context, job)
    }
}
