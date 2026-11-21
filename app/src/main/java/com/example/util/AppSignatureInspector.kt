package com.example.util

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat
import com.example.BuildConfig
import java.io.ByteArrayInputStream
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.interfaces.DSAPublicKey
import java.security.interfaces.ECPublicKey
import java.security.interfaces.RSAPublicKey
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class CertificateValidityState {
    VALID,
    EXPIRED,
    NOT_YET_VALID,
    UNKNOWN
}

data class CertificateSignatureInfo(
    val index: Int,
    val sha1: String,
    val sha256: String,
    val md5: String,
    val subjectDn: String,
    val issuerDn: String,
    val serialNumberHex: String,
    val signatureAlgorithm: String,
    val publicKeyAlgorithm: String,
    val publicKeyBits: Int?,
    val x509Version: Int,
    val validFromMillis: Long,
    val validUntilMillis: Long,
    val validityState: CertificateValidityState,
    val isKnownDebugCert: Boolean
)

data class AppSigningSnapshot(
    val appName: String,
    val packageName: String,
    val versionName: String,
    val versionCode: Long,
    val buildType: String,
    val isDebuggable: Boolean,
    val minSdk: Int,
    val targetSdk: Int,
    val deviceAndroidVersion: String,
    val installerSource: String,
    val firstInstallTimeMillis: Long,
    val lastUpdateTimeMillis: Long,
    val hasMultipleSigners: Boolean,
    val hasPastSigningCertificates: Boolean,
    val certificates: List<CertificateSignatureInfo>,
    val pastCertificatesCount: Int,
    val inspectionError: String? = null
)

object AppSignatureInspector {

    fun inspect(context: Context): AppSigningSnapshot {
        val pm = context.packageManager
        val pkgName = context.packageName
        val appInfo = context.applicationInfo
        val appLabel = runCatching { appInfo.loadLabel(pm).toString() }
            .getOrDefault("Mobile Repair Shop")
        val isDebuggable = (appInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        val minSdk = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) appInfo.minSdkVersion else 24
        val targetSdk = appInfo.targetSdkVersion
        val deviceOs = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"

        return try {
            val packageInfo = getPackageInfoWithSignatures(pm, pkgName)
            val versionName = packageInfo.versionName?.takeIf { it.isNotBlank() } ?: BuildConfig.VERSION_NAME
            val versionCode = PackageInfoCompat.getLongVersionCode(packageInfo)
            val installerSource = resolveInstallerSource(pm, pkgName)

            val rawSignatures: List<Signature>
            val hasMultipleSigners: Boolean
            val hasPastSigningCertificates: Boolean
            val pastCertCount: Int

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val signingInfo = packageInfo.signingInfo
                hasMultipleSigners = signingInfo?.hasMultipleSigners() == true
                hasPastSigningCertificates = signingInfo?.hasPastSigningCertificates() == true
                val apkContentsSigners = signingInfo?.apkContentsSigners?.toList().orEmpty()
                val historySigners = signingInfo?.signingCertificateHistory?.toList().orEmpty()
                rawSignatures = if (apkContentsSigners.isNotEmpty()) apkContentsSigners else historySigners
                pastCertCount = if (hasPastSigningCertificates) {
                    (historySigners.size - apkContentsSigners.size).coerceAtLeast(0)
                } else {
                    0
                }
            } else {
                @Suppress("DEPRECATION")
                val legacySigs = packageInfo.signatures?.toList().orEmpty()
                rawSignatures = legacySigs
                hasMultipleSigners = legacySigs.size > 1
                hasPastSigningCertificates = false
                pastCertCount = 0
            }

            val parsedCerts = rawSignatures.mapIndexed { idx, signature ->
                parseSignature(idx + 1, signature.toByteArray())
            }

            AppSigningSnapshot(
                appName = appLabel,
                packageName = pkgName,
                versionName = versionName,
                versionCode = versionCode,
                buildType = BuildConfig.BUILD_TYPE,
                isDebuggable = isDebuggable,
                minSdk = minSdk,
                targetSdk = targetSdk,
                deviceAndroidVersion = deviceOs,
                installerSource = installerSource,
                firstInstallTimeMillis = packageInfo.firstInstallTime,
                lastUpdateTimeMillis = packageInfo.lastUpdateTime,
                hasMultipleSigners = hasMultipleSigners,
                hasPastSigningCertificates = hasPastSigningCertificates,
                certificates = parsedCerts,
                pastCertificatesCount = pastCertCount
            )
        } catch (e: Exception) {
            AppSigningSnapshot(
                appName = appLabel,
                packageName = pkgName,
                versionName = BuildConfig.VERSION_NAME,
                versionCode = BuildConfig.VERSION_CODE.toLong(),
                buildType = BuildConfig.BUILD_TYPE,
                isDebuggable = isDebuggable,
                minSdk = minSdk,
                targetSdk = targetSdk,
                deviceAndroidVersion = deviceOs,
                installerSource = "Unknown",
                firstInstallTimeMillis = 0L,
                lastUpdateTimeMillis = 0L,
                hasMultipleSigners = false,
                hasPastSigningCertificates = false,
                certificates = emptyList(),
                pastCertificatesCount = 0,
                inspectionError = e.message ?: "Unable to read package signature"
            )
        }
    }

    @Suppress("DEPRECATION")
    private fun getPackageInfoWithSignatures(pm: PackageManager, pkgName: String): PackageInfo {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getPackageInfo(
                pkgName,
                PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pm.getPackageInfo(pkgName, PackageManager.GET_SIGNING_CERTIFICATES)
        } else {
            pm.getPackageInfo(pkgName, PackageManager.GET_SIGNATURES)
        }
    }

    @Suppress("DEPRECATION")
    private fun resolveInstallerSource(pm: PackageManager, pkgName: String): String {
        val installerPkg = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                pm.getInstallSourceInfo(pkgName).installingPackageName
            } else {
                pm.getInstallerPackageName(pkgName)
            }
        }.getOrNull()

        return when {
            installerPkg.isNullOrBlank() -> "Direct / ADB / Sideload"
            installerPkg == "com.android.vending" -> "Google Play Store ($installerPkg)"
            installerPkg.contains("packageinstaller", ignoreCase = true) -> "Android Package Installer ($installerPkg)"
            else -> installerPkg
        }
    }

    private fun parseSignature(index: Int, certBytes: ByteArray): CertificateSignatureInfo {
        val sha1 = computeDigest(certBytes, "SHA-1")
        val sha256 = computeDigest(certBytes, "SHA-256")
        val md5 = computeDigest(certBytes, "MD5")

        val x509 = runCatching {
            val cf = CertificateFactory.getInstance("X.509")
            cf.generateCertificate(ByteArrayInputStream(certBytes)) as? X509Certificate
        }.getOrNull()

        if (x509 == null) {
            return CertificateSignatureInfo(
                index = index,
                sha1 = sha1,
                sha256 = sha256,
                md5 = md5,
                subjectDn = "Unavailable",
                issuerDn = "Unavailable",
                serialNumberHex = "Unavailable",
                signatureAlgorithm = "Unavailable",
                publicKeyAlgorithm = "Unavailable",
                publicKeyBits = null,
                x509Version = 0,
                validFromMillis = 0L,
                validUntilMillis = 0L,
                validityState = CertificateValidityState.UNKNOWN,
                isKnownDebugCert = false
            )
        }

        val subjectDn = x509.subjectX500Principal?.name ?: x509.subjectDN?.name ?: "Unknown"
        val issuerDn = x509.issuerX500Principal?.name ?: x509.issuerDN?.name ?: "Unknown"
        val serialHex = x509.serialNumber.toString(16).uppercase(Locale.US)
        val sigAlg = x509.sigAlgName ?: "Unknown"
        val pubKey = x509.publicKey
        val pubKeyAlg = pubKey?.algorithm ?: "Unknown"
        val keyBits: Int? = when (pubKey) {
            is RSAPublicKey -> pubKey.modulus.bitLength()
            is ECPublicKey -> pubKey.params?.order?.bitLength()
            is DSAPublicKey -> pubKey.params?.p?.bitLength()
            else -> null
        }

        val notBefore = x509.notBefore?.time ?: 0L
        val notAfter = x509.notAfter?.time ?: 0L
        val now = System.currentTimeMillis()
        val validityState = when {
            notBefore == 0L || notAfter == 0L -> CertificateValidityState.UNKNOWN
            now < notBefore -> CertificateValidityState.NOT_YET_VALID
            now > notAfter -> CertificateValidityState.EXPIRED
            else -> CertificateValidityState.VALID
        }

        val isKnownDebugCert = subjectDn.contains("Android Debug", ignoreCase = true)

        return CertificateSignatureInfo(
            index = index,
            sha1 = sha1,
            sha256 = sha256,
            md5 = md5,
            subjectDn = subjectDn,
            issuerDn = issuerDn,
            serialNumberHex = serialHex,
            signatureAlgorithm = sigAlg,
            publicKeyAlgorithm = pubKeyAlg,
            publicKeyBits = keyBits,
            x509Version = x509.version,
            validFromMillis = notBefore,
            validUntilMillis = notAfter,
            validityState = validityState,
            isKnownDebugCert = isKnownDebugCert
        )
    }

    private fun computeDigest(bytes: ByteArray, algorithm: String): String {
        return runCatching {
            val digest = MessageDigest.getInstance(algorithm).digest(bytes)
            digest.joinToString(":") { byte ->
                "%02X".format(Locale.US, byte)
            }
        }.getOrDefault("Unavailable")
    }

    fun formatDateTime(millis: Long): String {
        if (millis <= 0L) return "Unavailable"
        return SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.getDefault()).format(Date(millis))
    }

    fun buildPlainTextReport(snapshot: AppSigningSnapshot): String = buildString {
        appendLine("=== ${snapshot.appName} — App & Signature Info ===")
        appendLine("Package Name: ${snapshot.packageName}")
        appendLine("Version: ${snapshot.versionName} (Code ${snapshot.versionCode})")
        appendLine("Build Type: ${snapshot.buildType.uppercase(Locale.US)} (Debuggable: ${if (snapshot.isDebuggable) "Yes" else "No"})")
        appendLine("SDK: minSdk ${snapshot.minSdk} / targetSdk ${snapshot.targetSdk}")
        appendLine("Device OS: ${snapshot.deviceAndroidVersion}")
        appendLine("Install Source: ${snapshot.installerSource}")
        appendLine("First Installed: ${formatDateTime(snapshot.firstInstallTimeMillis)}")
        appendLine("Last Updated: ${formatDateTime(snapshot.lastUpdateTimeMillis)}")
        appendLine("Certificates Found: ${snapshot.certificates.size} (Multiple Signers: ${if (snapshot.hasMultipleSigners) "Yes" else "No"})")

        snapshot.certificates.forEach { cert ->
            appendLine()
            appendLine("--- Certificate #${cert.index} (${if (cert.isKnownDebugCert) "Debug Certificate" else "Release / Custom Certificate"}) ---")
            appendLine("SHA-1: ${cert.sha1}")
            appendLine("SHA-256: ${cert.sha256}")
            appendLine("MD5: ${cert.md5}")
            appendLine("Subject (Owner): ${cert.subjectDn}")
            appendLine("Issuer: ${cert.issuerDn}")
            appendLine("Serial Number: ${cert.serialNumberHex}")
            appendLine("Signature Algorithm: ${cert.signatureAlgorithm}")
            val keyDesc = if (cert.publicKeyBits != null) "${cert.publicKeyAlgorithm} (${cert.publicKeyBits}-bit)" else cert.publicKeyAlgorithm
            appendLine("Public Key: $keyDesc")
            appendLine("X.509 Version: v${cert.x509Version}")
            appendLine("Valid From: ${formatDateTime(cert.validFromMillis)}")
            appendLine("Valid Until: ${formatDateTime(cert.validUntilMillis)}")
            appendLine("Status: ${cert.validityState.name}")
        }
    }.trimEnd()
}
