package com.example.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Backup
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.R
import com.example.ui.AppScreen
import com.example.ui.ShopViewModel
import com.example.ui.components.AppButton
import com.example.ui.components.AppCard
import com.example.ui.components.AppTextField
import com.example.ui.theme.ShopTheme
import com.example.ui.theme.StatusRepairedEmerald
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncManagerScreen(
    viewModel: ShopViewModel,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val syncConfig by viewModel.googleSyncConfig.collectAsStateWithLifecycle()
    val isSyncing by viewModel.isSyncing.collectAsStateWithLifecycle()
    val isBackingUp by viewModel.isBackingUp.collectAsStateWithLifecycle()

    var customSheetInput by rememberSaveable { mutableStateOf("") }

    val googleConsentLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartIntentSenderForResult()
    ) { result ->
        viewModel.handleGoogleConsentResult(context, result.resultCode, result.data) { msg ->
            Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
        }
    }

    val launchConsent: (android.content.IntentSender) -> Unit = { sender ->
        googleConsentLauncher.launch(IntentSenderRequest.Builder(sender).build())
    }

    BackHandler {
        viewModel.navigateBack()
    }

    val shopColors = ShopTheme.colors
    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.sync_manager_title),
                        style = MaterialTheme.typography.titleMedium,
                        color = shopColors.topBarContent
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = { viewModel.navigateBack() },
                        modifier = Modifier
                            .defaultMinSize(minHeight = 48.dp, minWidth = 48.dp)
                            .testTag("sync_manager_back_btn")
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = shopColors.topBarContent
                        )
                    }
                },
                actions = {
                    IconButton(
                        onClick = { viewModel.navigateTo(AppScreen.APP_SIGNATURE_INFO) },
                        modifier = Modifier
                            .defaultMinSize(minHeight = 48.dp, minWidth = 48.dp)
                            .testTag("btn_sync_top_show_info")
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = stringResource(R.string.cd_open_app_info),
                            tint = shopColors.topBarContent
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = shopColors.topBarContainer
                )
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(MaterialTheme.colorScheme.background),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = 720.dp),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                item {
                    AppCard(testTag = "card_sync_manager_connection") {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(
                                    imageVector = if (syncConfig.isConnected) Icons.Default.CloudDone else Icons.Default.CloudSync,
                                    contentDescription = null,
                                    tint = if (syncConfig.isConnected) shopColors.repaired else MaterialTheme.colorScheme.primary
                                )
                                Text(
                                    text = stringResource(R.string.section_sheets_sync),
                                    style = MaterialTheme.typography.titleSmall,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                            }

                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = if (syncConfig.isConnected) shopColors.repairedContainer else MaterialTheme.colorScheme.surface
                            ) {
                                Text(
                                    text = if (syncConfig.isConnected) {
                                        stringResource(R.string.sheets_status_connected)
                                    } else {
                                        stringResource(R.string.sheets_status_disconnected)
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.Bold,
                                    color = if (syncConfig.isConnected) shopColors.repaired else MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = stringResource(R.string.sheets_sync_desc),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )

                        if (syncConfig.isConnected) {
                            Spacer(modifier = Modifier.height(10.dp))
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = MaterialTheme.colorScheme.surface,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(
                                    modifier = Modifier.padding(10.dp),
                                    verticalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    if (syncConfig.accountEmail.isNotBlank()) {
                                        Text(
                                            text = syncConfig.accountEmail,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.SemiBold,
                                            color = MaterialTheme.colorScheme.primary,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                    val formattedTime = remember(syncConfig.lastSyncedAt) {
                                        if (syncConfig.lastSyncedAt > 0L) {
                                            SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.getDefault())
                                                .format(Date(syncConfig.lastSyncedAt))
                                        } else {
                                            ""
                                        }
                                    }
                                    Text(
                                        text = if (formattedTime.isNotEmpty()) {
                                            stringResource(R.string.sheets_last_synced, formattedTime)
                                        } else {
                                            stringResource(R.string.sheets_never_synced)
                                        },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    if (syncConfig.spreadsheetId.isNotBlank()) {
                                        Text(
                                            text = stringResource(R.string.sheets_sheet_id_label, syncConfig.spreadsheetId),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.Folder,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.size(16.dp)
                                        )
                                        Text(
                                            text = stringResource(
                                                R.string.sync_folder_label,
                                                com.example.data.remote.GoogleSheetsSyncManager.APP_FOLDER_NAME
                                            ),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(12.dp))
                        AppButton(
                            text = when {
                                isSyncing -> stringResource(R.string.btn_syncing)
                                syncConfig.isConnected -> stringResource(R.string.btn_sync_now)
                                else -> stringResource(R.string.btn_connect_google_sheets)
                            },
                            onClick = {
                                viewModel.connectAndSyncGoogleSheets(
                                    activityContext = context,
                                    onNeedsConsent = launchConsent,
                                    onMessage = { msg ->
                                        Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
                                    }
                                )
                            },
                            enabled = !isSyncing,
                            modifier = Modifier.fillMaxWidth(),
                            containerColor = if (syncConfig.isConnected) StatusRepairedEmerald else MaterialTheme.colorScheme.primary,
                            testTag = "btn_google_sheets_sync_now",
                            leadingIcon = {
                                if (isSyncing) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(18.dp),
                                        strokeWidth = 2.dp,
                                        color = MaterialTheme.colorScheme.onPrimary
                                    )
                                } else {
                                    Icon(imageVector = Icons.Default.Sync, contentDescription = null)
                                }
                            }
                        )

                        if (syncConfig.isConnected) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                if (syncConfig.spreadsheetId.isNotBlank()) {
                                    OutlinedButton(
                                        onClick = { viewModel.openGoogleSheetInBrowser(context) },
                                        modifier = Modifier
                                            .weight(1f)
                                            .defaultMinSize(minHeight = 48.dp)
                                            .testTag("btn_open_google_sheet"),
                                        shape = RoundedCornerShape(10.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.AutoMirrored.Filled.OpenInNew,
                                            contentDescription = null,
                                            modifier = Modifier.size(16.dp)
                                        )
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text(
                                            text = stringResource(R.string.btn_open_google_sheet),
                                            style = MaterialTheme.typography.bodySmall,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }

                                OutlinedButton(
                                    onClick = {
                                        viewModel.disconnectGoogleSheets { msg ->
                                            Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
                                        }
                                    },
                                    enabled = !isSyncing,
                                    modifier = Modifier
                                        .defaultMinSize(minHeight = 48.dp)
                                        .testTag("btn_disconnect_google_sheets"),
                                    shape = RoundedCornerShape(10.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.LinkOff,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.error,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = stringResource(R.string.btn_disconnect_sheets),
                                        color = MaterialTheme.colorScheme.error,
                                        style = MaterialTheme.typography.bodySmall,
                                        maxLines = 1
                                    )
                                }
                            }
                        }
                    }
                }

                item {
                    AppCard(testTag = "card_sync_nightly_backup") {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Backup,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary
                                )
                                Text(
                                    text = stringResource(R.string.section_nightly_backup),
                                    style = MaterialTheme.typography.titleSmall,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                            }

                            Switch(
                                checked = syncConfig.nightlyBackupEnabled,
                                onCheckedChange = { viewModel.toggleNightlyBackup(it) },
                                modifier = Modifier
                                    .defaultMinSize(minHeight = 48.dp, minWidth = 48.dp)
                                    .testTag("switch_nightly_backup")
                            )
                        }

                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = stringResource(R.string.nightly_backup_desc),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )

                        Spacer(modifier = Modifier.height(10.dp))
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = MaterialTheme.colorScheme.surface,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(
                                modifier = Modifier.padding(10.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Text(
                                    text = stringResource(R.string.label_nightly_backup_toggle),
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                val formattedBackupTime = remember(syncConfig.lastBackupAt) {
                                    if (syncConfig.lastBackupAt > 0L) {
                                        SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.getDefault())
                                            .format(Date(syncConfig.lastBackupAt))
                                    } else {
                                        ""
                                    }
                                }
                                Text(
                                    text = if (formattedBackupTime.isNotEmpty() && syncConfig.lastBackupName.isNotBlank()) {
                                        stringResource(R.string.backup_last_run, syncConfig.lastBackupName, formattedBackupTime)
                                    } else {
                                        stringResource(R.string.backup_never_run)
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(12.dp))
                        AppButton(
                            text = if (isBackingUp) {
                                stringResource(R.string.btn_backing_up)
                            } else {
                                stringResource(R.string.btn_backup_now)
                            },
                            onClick = {
                                viewModel.backupNowToGoogleDrive(
                                    activityContext = context,
                                    onNeedsConsent = launchConsent,
                                    onMessage = { msg ->
                                        Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
                                    }
                                )
                            },
                            enabled = !isSyncing && !isBackingUp,
                            modifier = Modifier.fillMaxWidth(),
                            testTag = "btn_backup_now",
                            leadingIcon = {
                                if (isBackingUp) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(18.dp),
                                        strokeWidth = 2.dp,
                                        color = MaterialTheme.colorScheme.onPrimary
                                    )
                                } else {
                                    Icon(imageVector = Icons.Default.Backup, contentDescription = null)
                                }
                            }
                        )
                    }
                }

                item {
                    AppCard(testTag = "card_sync_link_existing") {
                        AppTextField(
                            value = customSheetInput,
                            onValueChange = { customSheetInput = it },
                            label = stringResource(R.string.label_custom_sheet_id),
                            placeholder = "https://docs.google.com/spreadsheets/d/...",
                            modifier = Modifier.fillMaxWidth(),
                            testTag = "input_custom_google_sheet_id"
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = {
                                viewModel.linkExistingSpreadsheet(
                                    activityContext = context,
                                    rawUrlOrId = customSheetInput,
                                    onNeedsConsent = launchConsent,
                                    onMessage = { msg ->
                                        Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
                                    }
                                )
                            },
                            enabled = !isSyncing && customSheetInput.isNotBlank(),
                            modifier = Modifier
                                .fillMaxWidth()
                                .defaultMinSize(minHeight = 48.dp)
                                .testTag("btn_link_custom_sheet"),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Link,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = stringResource(R.string.btn_link_sheet_id),
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }
                }

                item {
                    AppCard(testTag = "card_sync_setup_checklist") {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Info,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary
                            )
                            Text(
                                text = stringResource(R.string.sync_setup_guide_title),
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = stringResource(R.string.sync_package_name_label, context.packageName),
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.primary
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = stringResource(R.string.sync_setup_checklist),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        AppButton(
                            text = stringResource(R.string.btn_show_info),
                            onClick = { viewModel.navigateTo(AppScreen.APP_SIGNATURE_INFO) },
                            modifier = Modifier.fillMaxWidth(),
                            testTag = "btn_sync_show_info",
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.Default.Info,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = {
                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                clipboard?.setPrimaryClip(ClipData.newPlainText("Package Name", context.packageName))
                                Toast.makeText(
                                    context,
                                    context.getString(R.string.toast_package_copied),
                                    Toast.LENGTH_SHORT
                                ).show()
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .defaultMinSize(minHeight = 48.dp)
                                .testTag("btn_copy_package_name"),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.ContentCopy,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = stringResource(R.string.btn_copy_package),
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }
        }
    }
}
