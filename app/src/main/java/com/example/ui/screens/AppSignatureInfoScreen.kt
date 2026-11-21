package com.example.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.R
import com.example.ui.ShopViewModel
import com.example.ui.components.AppButton
import com.example.ui.components.AppCard
import com.example.ui.theme.ShopTheme
import com.example.util.AppSignatureInspector
import com.example.util.AppSigningSnapshot
import com.example.util.CertificateSignatureInfo
import com.example.util.CertificateValidityState
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppSignatureInfoScreen(
    viewModel: ShopViewModel,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val snapshot = remember(context) { AppSignatureInspector.inspect(context) }
    val shopColors = ShopTheme.colors

    val copySingleValue: (String, String) -> Unit = { label, value ->
        copyTextToClipboard(
            context = context,
            label = label,
            text = value,
            toastMessage = context.getString(R.string.app_info_copied_toast, label)
        )
    }

    val copyAllReport: () -> Unit = {
        val report = AppSignatureInspector.buildPlainTextReport(snapshot)
        copyTextToClipboard(
            context = context,
            label = "App Signature Info",
            text = report,
            toastMessage = context.getString(R.string.app_info_all_copied_toast)
        )
    }

    BackHandler {
        viewModel.navigateBack()
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.app_info_screen_title),
                        style = MaterialTheme.typography.titleMedium,
                        color = shopColors.topBarContent,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = { viewModel.navigateBack() },
                        modifier = Modifier
                            .defaultMinSize(minHeight = 48.dp, minWidth = 48.dp)
                            .testTag("app_info_back_btn")
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
                        onClick = copyAllReport,
                        modifier = Modifier
                            .defaultMinSize(minHeight = 48.dp, minWidth = 48.dp)
                            .testTag("btn_top_copy_all_info")
                    ) {
                        Icon(
                            imageVector = Icons.Default.ContentCopy,
                            contentDescription = stringResource(R.string.cd_copy_all_info),
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
                    AppIdentityHeroCard(
                        snapshot = snapshot,
                        onCopyPackage = {
                            copySingleValue(
                                context.getString(R.string.app_info_label_package_name),
                                snapshot.packageName
                            )
                        }
                    )
                }

                if (snapshot.inspectionError != null) {
                    item {
                        AppCard(testTag = "card_signature_error") {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Warning,
                                    contentDescription = null,
                                    tint = shopColors.alert
                                )
                                Text(
                                    text = snapshot.inspectionError,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = shopColors.alert
                                )
                            }
                        }
                    }
                }

                if (snapshot.certificates.isEmpty()) {
                    item {
                        AppCard(testTag = "card_no_certificates") {
                            Text(
                                text = stringResource(R.string.app_info_no_certs_found),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                } else {
                    item {
                        FingerprintsSectionCard(
                            primaryCert = snapshot.certificates.first(),
                            onCopyValue = copySingleValue
                        )
                    }

                    items(snapshot.certificates, key = { it.index }) { cert ->
                        CertificateDetailCard(
                            cert = cert,
                            onCopyValue = copySingleValue
                        )
                    }
                }

                item {
                    AppBuildDetailsCard(
                        snapshot = snapshot,
                        onCopyValue = copySingleValue
                    )
                }

                item {
                    AppButton(
                        text = stringResource(R.string.app_info_btn_copy_all),
                        onClick = copyAllReport,
                        modifier = Modifier.fillMaxWidth(),
                        testTag = "btn_copy_full_info_report",
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.ContentCopy,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                }
            }
        }
    }
}

@Composable
private fun AppIdentityHeroCard(
    snapshot: AppSigningSnapshot,
    onCopyPackage: () -> Unit
) {
    val shopColors = ShopTheme.colors
    val isDebugSigning = snapshot.isDebuggable || snapshot.certificates.any { it.isKnownDebugCert }
    val badgeBg = if (isDebugSigning) shopColors.pendingContainer else shopColors.repairedContainer
    val badgeFg = if (isDebugSigning) shopColors.pending else shopColors.repaired

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("card_app_identity_hero"),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.7f)),
        tonalElevation = 2.dp
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    Brush.linearGradient(
                        colors = listOf(
                            MaterialTheme.colorScheme.primary.copy(alpha = if (shopColors.isDark) 0.22f else 0.08f),
                            Color.Transparent
                        )
                    )
                )
                .padding(16.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        Surface(
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.primaryContainer,
                            modifier = Modifier.size(44.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = Icons.Default.VerifiedUser,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                                    modifier = Modifier.size(24.dp)
                                )
                            }
                        }
                        Column {
                            Text(
                                text = snapshot.appName,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = "v${snapshot.versionName} • Code ${snapshot.versionCode} • ${snapshot.buildType.uppercase(Locale.US)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    Spacer(modifier = Modifier.width(8.dp))

                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = badgeBg
                    ) {
                        Text(
                            text = if (isDebugSigning) {
                                stringResource(R.string.app_info_badge_debug_signing)
                            } else {
                                stringResource(R.string.app_info_badge_release_signing)
                            },
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = badgeFg,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                }

                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 12.dp, top = 6.dp, bottom = 6.dp, end = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = stringResource(R.string.app_info_label_package_name),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = snapshot.packageName,
                                style = MaterialTheme.typography.bodySmall.copy(
                                    fontFamily = FontFamily.Monospace,
                                    fontWeight = FontWeight.SemiBold
                                ),
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        IconButton(
                            onClick = onCopyPackage,
                            modifier = Modifier
                                .defaultMinSize(minHeight = 48.dp, minWidth = 48.dp)
                                .testTag("btn_copy_info_package")
                        ) {
                            Icon(
                                imageVector = Icons.Default.ContentCopy,
                                contentDescription = stringResource(
                                    R.string.cd_copy_value,
                                    stringResource(R.string.app_info_label_package_name)
                                ),
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FingerprintsSectionCard(
    primaryCert: CertificateSignatureInfo,
    onCopyValue: (String, String) -> Unit
) {
    val sha1Label = stringResource(R.string.app_info_label_sha1)
    val sha256Label = stringResource(R.string.app_info_label_sha256)
    val md5Label = stringResource(R.string.app_info_label_md5)

    AppCard(testTag = "card_signature_fingerprints") {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Fingerprint,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
            Text(
                text = stringResource(R.string.app_info_section_fingerprints),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = stringResource(R.string.app_info_section_fingerprints_desc),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(12.dp))

        FingerprintCodeBlock(
            label = sha1Label,
            hashValue = primaryCert.sha1,
            testTag = "btn_copy_sha1",
            onCopy = { onCopyValue(sha1Label, primaryCert.sha1) }
        )
        Spacer(modifier = Modifier.height(10.dp))
        FingerprintCodeBlock(
            label = sha256Label,
            hashValue = primaryCert.sha256,
            testTag = "btn_copy_sha256",
            onCopy = { onCopyValue(sha256Label, primaryCert.sha256) }
        )
        Spacer(modifier = Modifier.height(10.dp))
        FingerprintCodeBlock(
            label = md5Label,
            hashValue = primaryCert.md5,
            testTag = "btn_copy_md5",
            onCopy = { onCopyValue(md5Label, primaryCert.md5) }
        )
    }
}

@Composable
private fun FingerprintCodeBlock(
    label: String,
    hashValue: String,
    testTag: String,
    onCopy: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.55f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary
                )
                IconButton(
                    onClick = onCopy,
                    modifier = Modifier
                        .defaultMinSize(minHeight = 48.dp, minWidth = 48.dp)
                        .testTag(testTag)
                ) {
                    Icon(
                        imageVector = Icons.Default.ContentCopy,
                        contentDescription = stringResource(R.string.cd_copy_value, label),
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
            Text(
                text = hashValue,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace,
                    lineHeight = 18.sp
                ),
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(end = 8.dp)
            )
        }
    }
}

@Composable
private fun CertificateDetailCard(
    cert: CertificateSignatureInfo,
    onCopyValue: (String, String) -> Unit
) {
    val shopColors = ShopTheme.colors
    val serialLabel = stringResource(R.string.app_info_label_serial)
    val validityBadge = when (cert.validityState) {
        CertificateValidityState.VALID -> Triple(
            stringResource(R.string.app_info_badge_valid),
            shopColors.repaired,
            shopColors.repairedContainer
        )
        CertificateValidityState.EXPIRED -> Triple(
            stringResource(R.string.app_info_badge_expired),
            shopColors.alert,
            shopColors.alertContainer
        )
        CertificateValidityState.NOT_YET_VALID -> Triple(
            stringResource(R.string.app_info_badge_not_yet_valid),
            shopColors.pending,
            shopColors.pendingContainer
        )
        CertificateValidityState.UNKNOWN -> Triple(
            stringResource(R.string.app_info_badge_unknown),
            shopColors.delivered,
            shopColors.deliveredContainer
        )
    }

    val publicKeySummary = remember(cert.publicKeyAlgorithm, cert.publicKeyBits) {
        if (cert.publicKeyBits != null) {
            "${cert.publicKeyAlgorithm} (${cert.publicKeyBits}-bit)"
        } else {
            cert.publicKeyAlgorithm
        }
    }

    AppCard(testTag = "card_certificate_${cert.index}") {
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
                    imageVector = Icons.Default.Key,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = stringResource(R.string.app_info_section_certificate, cert.index),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = validityBadge.third
            ) {
                Text(
                    text = validityBadge.first,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = validityBadge.second,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                )
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

        InfoDetailRow(
            label = stringResource(R.string.app_info_label_subject),
            value = cert.subjectDn,
            isMonospace = true
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_issuer),
            value = cert.issuerDn,
            isMonospace = true
        )
        InfoRowDivider()
        InfoDetailRow(
            label = serialLabel,
            value = cert.serialNumberHex,
            isMonospace = true,
            onCopy = { onCopyValue(serialLabel, cert.serialNumberHex) },
            copyTestTag = "btn_copy_serial_${cert.index}"
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_sig_alg),
            value = cert.signatureAlgorithm
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_public_key),
            value = publicKeySummary
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_x509_version),
            value = if (cert.x509Version > 0) "X.509 v${cert.x509Version}" else "Unknown"
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_valid_from),
            value = AppSignatureInspector.formatDateTime(cert.validFromMillis)
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_valid_until),
            value = AppSignatureInspector.formatDateTime(cert.validUntilMillis)
        )
    }
}

@Composable
private fun AppBuildDetailsCard(
    snapshot: AppSigningSnapshot,
    onCopyValue: (String, String) -> Unit
) {
    val yesText = stringResource(R.string.app_info_yes)
    val noText = stringResource(R.string.app_info_no)
    val versionLabel = stringResource(R.string.app_info_label_version)

    AppCard(testTag = "card_app_build_details") {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Build,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
            Text(
                text = stringResource(R.string.app_info_section_build),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface
            )
        }

        Spacer(modifier = Modifier.height(10.dp))

        InfoDetailRow(
            label = versionLabel,
            value = "v${snapshot.versionName} (versionCode ${snapshot.versionCode})",
            onCopy = { onCopyValue(versionLabel, "${snapshot.versionName} (${snapshot.versionCode})") },
            copyTestTag = "btn_copy_version"
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_build_type),
            value = snapshot.buildType.uppercase(Locale.US)
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_debuggable),
            value = if (snapshot.isDebuggable) yesText else noText
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_sdk),
            value = "minSdk ${snapshot.minSdk} / targetSdk ${snapshot.targetSdk}"
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_device_os),
            value = snapshot.deviceAndroidVersion
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_installer),
            value = snapshot.installerSource
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_first_installed),
            value = AppSignatureInspector.formatDateTime(snapshot.firstInstallTimeMillis)
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_last_updated),
            value = AppSignatureInspector.formatDateTime(snapshot.lastUpdateTimeMillis)
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_cert_count),
            value = snapshot.certificates.size.toString()
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_multi_signer),
            value = if (snapshot.hasMultipleSigners) yesText else noText
        )
        InfoRowDivider()
        InfoDetailRow(
            label = stringResource(R.string.app_info_label_past_certs),
            value = if (snapshot.hasPastSigningCertificates) {
                "$yesText (${snapshot.pastCertificatesCount})"
            } else {
                noText
            }
        )
    }
}

@Composable
private fun InfoDetailRow(
    label: String,
    value: String,
    isMonospace: Boolean = false,
    onCopy: (() -> Unit)? = null,
    copyTestTag: String? = null
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = value,
                style = if (isMonospace) {
                    MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)
                } else {
                    MaterialTheme.typography.bodyMedium
                },
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface
            )
        }

        if (onCopy != null) {
            IconButton(
                onClick = onCopy,
                modifier = Modifier
                    .defaultMinSize(minHeight = 48.dp, minWidth = 48.dp)
                    .then(if (copyTestTag != null) Modifier.testTag(copyTestTag) else Modifier)
            ) {
                Icon(
                    imageVector = Icons.Default.ContentCopy,
                    contentDescription = stringResource(R.string.cd_copy_value, label),
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}

@Composable
private fun InfoRowDivider() {
    HorizontalDivider(
        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.35f),
        thickness = 1.dp
    )
}

private fun copyTextToClipboard(
    context: Context,
    label: String,
    text: String,
    toastMessage: String
) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    clipboard?.setPrimaryClip(ClipData.newPlainText(label, text))
    Toast.makeText(context, toastMessage, Toast.LENGTH_SHORT).show()
}
