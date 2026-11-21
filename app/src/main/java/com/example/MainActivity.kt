package com.example

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.data.preferences.AppThemeMode
import com.example.ui.AppScreen
import com.example.ui.ShopViewModel
import com.example.ui.UpdateCheckUiState
import com.example.ui.components.WhatsAppPreviewDialog
import com.example.ui.screens.AppSignatureInfoScreen
import com.example.ui.screens.DashboardScreen
import com.example.ui.screens.JobDetailScreen
import com.example.ui.screens.KhataBookScreen
import com.example.ui.screens.KhataDetailScreen
import com.example.ui.screens.NewJobScreen
import com.example.ui.screens.ReceiptPreviewScreen
import com.example.ui.screens.SettingsHomeScreen
import com.example.ui.screens.ShopSettingsScreen
import com.example.ui.screens.SyncManagerScreen
import com.example.ui.theme.MyApplicationTheme
import com.example.util.NotificationHelper

class MainActivity : ComponentActivity() {

    private var pendingNotificationJobId: Long = -1L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        NotificationHelper.ensureChannels(this)
        pendingNotificationJobId = intent?.getLongExtra(NotificationHelper.EXTRA_OPEN_JOB_ID, -1L) ?: -1L

        setContent {
            val viewModel: ShopViewModel = viewModel()
            val themeMode by viewModel.themeMode.collectAsStateWithLifecycle()
            val showStartupUpdateDialog by viewModel.showStartupUpdateDialog.collectAsStateWithLifecycle()
            val updateCheckState by viewModel.updateCheckState.collectAsStateWithLifecycle()
            val isDarkTheme = when (themeMode) {
                AppThemeMode.SYSTEM -> isSystemInDarkTheme()
                AppThemeMode.LIGHT -> false
                AppThemeMode.DARK -> true
            }

            val context = LocalContext.current
            val notificationPermissionLauncher = rememberLauncherForActivityResult(
                contract = ActivityResultContracts.RequestPermission()
            ) { granted ->
                viewModel.setNotificationsEnabled(granted)
            }

            LaunchedEffect(Unit) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    val permissionStatus = ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.POST_NOTIFICATIONS
                    )
                    if (permissionStatus != PackageManager.PERMISSION_GRANTED) {
                        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
                if (pendingNotificationJobId > 0L) {
                    viewModel.openJobFromNotification(pendingNotificationJobId)
                    pendingNotificationJobId = -1L
                }
            }

            MyApplicationTheme(darkTheme = isDarkTheme) {
                val lifecycleOwner = LocalLifecycleOwner.current
                DisposableEffect(lifecycleOwner, viewModel) {
                    val observer = LifecycleEventObserver { _, event ->
                        when (event) {
                            Lifecycle.Event.ON_RESUME -> viewModel.setAppForeground(true)
                            Lifecycle.Event.ON_PAUSE -> viewModel.setAppForeground(false)
                            else -> Unit
                        }
                    }
                    lifecycleOwner.lifecycle.addObserver(observer)
                    onDispose {
                        lifecycleOwner.lifecycle.removeObserver(observer)
                        viewModel.setAppForeground(false)
                    }
                }
                Surface(modifier = Modifier.fillMaxSize()) {
                    when (viewModel.currentScreen) {
                        AppScreen.DASHBOARD -> DashboardScreen(viewModel = viewModel)
                        AppScreen.NEW_JOB -> NewJobScreen(viewModel = viewModel)
                        AppScreen.JOB_DETAIL -> JobDetailScreen(viewModel = viewModel)
                        AppScreen.KHATA_BOOK -> KhataBookScreen(viewModel = viewModel)
                        AppScreen.KHATA_DETAIL -> KhataDetailScreen(viewModel = viewModel)
                        AppScreen.RECEIPT_PREVIEW -> ReceiptPreviewScreen(viewModel = viewModel)
                        AppScreen.SETTINGS_HOME -> SettingsHomeScreen(viewModel = viewModel)
                        AppScreen.SHOP_SETTINGS -> ShopSettingsScreen(viewModel = viewModel)
                        AppScreen.SYNC_MANAGER -> SyncManagerScreen(viewModel = viewModel)
                        AppScreen.APP_SIGNATURE_INFO -> AppSignatureInfoScreen(viewModel = viewModel)
                    }
                }

                if (viewModel.showWhatsAppPreviewDialog) {
                    WhatsAppPreviewDialog(viewModel = viewModel)
                }

                val availableUpdate = updateCheckState as? UpdateCheckUiState.UpdateAvailable
                if (showStartupUpdateDialog && availableUpdate != null) {
                    AppUpdatePromptDialog(
                        update = availableUpdate,
                        onUpdateNow = {
                            val targetUrl = availableUpdate.apkDownloadUrl ?: availableUpdate.releasePageUrl
                            viewModel.dismissStartupUpdateDialog()
                            viewModel.openUpdateReleasePage(context, targetUrl)
                        },
                        onLater = {
                            viewModel.dismissStartupUpdateDialog()
                        }
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val jobId = intent.getLongExtra(NotificationHelper.EXTRA_OPEN_JOB_ID, -1L)
        if (jobId > 0L) {
            pendingNotificationJobId = jobId
        }
    }
}

@Composable
private fun AppUpdatePromptDialog(
    update: UpdateCheckUiState.UpdateAvailable,
    onUpdateNow: () -> Unit,
    onLater: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onLater,
        modifier = Modifier.testTag("dialog_startup_update"),
        icon = {
            Icon(
                imageVector = Icons.Default.SystemUpdate,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
        },
        title = {
            Text(
                text = stringResource(R.string.dialog_update_available_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = stringResource(
                        R.string.dialog_update_available_body,
                        update.latestVersion,
                        update.currentVersion
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (update.releaseNotes.isNotBlank()) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = update.releaseNotes,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 4,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onUpdateNow,
                modifier = Modifier
                    .defaultMinSize(minHeight = 48.dp)
                    .testTag("btn_update_now")
            ) {
                Text(text = stringResource(R.string.btn_update_now))
            }
        },
        dismissButton = {
            TextButton(
                onClick = onLater,
                modifier = Modifier
                    .defaultMinSize(minHeight = 48.dp)
                    .testTag("btn_update_later")
            ) {
                Text(text = stringResource(R.string.btn_update_later))
            }
        }
    )
}
