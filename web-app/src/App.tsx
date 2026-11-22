import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Cloud,
  ExternalLink,
  History,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import { ConfirmActionModal } from './components/ConfirmActionModal';
import { DriveConnectModal } from './components/DriveConnectModal';
import {
  JobDashboardList,
  JobViewMode,
  StageFilterValue,
} from './components/JobDashboardList';
import { JobDetailView } from './components/JobDetailView';
import { KhataBookView } from './components/KhataBookView';
import { KhataCustomerDetailView } from './components/KhataCustomerDetailView';
import { KhataReceivePaymentModal } from './components/KhataReceivePaymentModal';
import { KpiSummaryRow } from './components/KpiSummaryRow';
import { NewJobModal } from './components/NewJobModal';
import { ReceiptPrintModal } from './components/ReceiptPrintModal';
import { SettingsHub, SettingsTab } from './components/SettingsHub';
import { TopHeader } from './components/TopHeader';
import { WhatsAppModal } from './components/WhatsAppModal';
import {
  clearInMemoryAccessToken,
  getEffectiveClientId,
  getInMemoryAccessToken,
  requestGoogleAccessToken,
  trySilentRefreshAccessToken,
} from './services/googleAuth';
import {
  appendJobToSheet,
  batchUpdateJobsInSheet,
  connectAndSyncWorkspace,
  createNewJobAtomic,
  GoogleApiError,
  quickSyncWorkspace,
  saveShopProfileToSheet,
  softDeleteJobInSheet,
  updateJobInSheet,
} from './services/googleSheetsSync';
import {
  buildKhataCustomers,
  buildKhataPaymentPlan,
  KhataCustomerSummary,
} from './services/khataEngine';
import { AppLanguage, getSavedLanguage, saveLanguage } from './services/i18n';
import {
  loadCachedWorkspace,
  saveCachedAuditLogs,
  saveCachedConnectionMeta,
  saveCachedJobs,
  saveCachedShopProfile,
} from './services/localCache';
import {
  BrowserNotificationPermissionState,
  getNotificationPermissionState,
  getNotificationsEnabled,
  notifyJobCreated,
  notifyJobStageChanged,
  notifySyncResult,
  requestBrowserNotificationPermission,
  sendTestBrowserNotification,
  setNotificationsEnabled,
} from './services/notifications';
import {
  applyThemeMode,
  getSavedThemeMode,
  saveThemeMode,
  subscribeSystemThemeChanges,
  ThemeMode,
} from './services/theme';
import {
  AuditLogEntry,
  createDefaultShopProfile,
  digitsOnly,
  DriveConnectionMeta,
  GeneratedJobNumberInfo,
  JobStage,
  RepairJob,
  ShopProfile,
  SyncStatus,
} from './types/repairShop';

interface ToastBanner {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

type ActivePage = 'dashboard' | 'khata' | 'settings';
type PendingConfirmAction = { kind: 'soft_delete_job'; job: RepairJob };

const VIEW_MODE_STORAGE_KEY = 'mrs_pos_dashboard_view';
const AUTO_SYNC_STORAGE_KEY = 'mrs_pos_auto_sync';
const AUTO_SYNC_INTERVAL_MS = 10000;
const AUTO_SYNC_MIN_COOLDOWN_MS = 2500;

function countRemoteJobChanges(prevJobs: RepairJob[], nextJobs: RepairJob[]): number {
  const prevMap = new Map<string, RepairJob>();
  for (const job of prevJobs) {
    prevMap.set(job.recordUuid, job);
  }
  let changed = 0;
  for (const nextJob of nextJobs) {
    const prev = prevMap.get(nextJob.recordUuid);
    if (!prev) {
      changed += 1;
    } else if (
      prev.updatedAt !== nextJob.updatedAt ||
      prev.stage !== nextJob.stage ||
      prev.isDeleted !== nextJob.isDeleted ||
      prev.sheetRow !== nextJob.sheetRow
    ) {
      changed += 1;
    }
  }
  return changed;
}

export default function App() {
  const [jobs, setJobs] = useState<RepairJob[]>([]);
  const [shopProfile, setShopProfile] = useState<ShopProfile | null>(() =>
    createDefaultShopProfile()
  );
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [connectionMeta, setConnectionMeta] = useState<DriveConnectionMeta | null>(null);

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getSavedThemeMode());
  const [language, setLanguage] = useState<AppLanguage>(() => getSavedLanguage());
  const [notificationsEnabled, setNotificationsEnabledState] = useState<boolean>(() =>
    getNotificationsEnabled()
  );
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermissionState>(() => getNotificationPermissionState());

  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AUTO_SYNC_STORAGE_KEY);
      return saved !== 'false';
    } catch {
      return true;
    }
  });

  const [activePage, setActivePage] = useState<ActivePage>('dashboard');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile');

  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<StageFilterValue>('ALL');
  const [viewMode, setViewMode] = useState<JobViewMode>(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      return saved === 'cards' ? 'cards' : 'table';
    } catch {
      return 'table';
    }
  });

  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const [isNewJobModalOpen, setIsNewJobModalOpen] = useState(false);
  const [newJobInitialCustomer, setNewJobInitialCustomer] = useState<{
    name: string;
    phone: string;
  } | null>(null);
  const [selectedJobUuid, setSelectedJobUuid] = useState<string | null>(null);
  const [selectedKhataKey, setSelectedKhataKey] = useState<string | null>(null);
  const [isReceivePaymentOpen, setIsReceivePaymentOpen] = useState(false);
  const [printJob, setPrintJob] = useState<RepairJob | null>(null);
  const [whatsAppJob, setWhatsAppJob] = useState<RepairJob | null>(null);
  const [whatsAppKhataCustomer, setWhatsAppKhataCustomer] =
    useState<KhataCustomerSummary | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingConfirmAction | null>(null);
  const [toast, setToast] = useState<ToastBanner | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const jobsRef = useRef<RepairJob[]>(jobs);
  const shopProfileRef = useRef<ShopProfile | null>(shopProfile);
  const auditLogsRef = useRef<AuditLogEntry[]>(auditLogs);
  const connectionMetaRef = useRef<DriveConnectionMeta | null>(connectionMeta);
  const syncStatusRef = useRef<SyncStatus>(syncStatus);
  const isMutatingRef = useRef<boolean>(isMutating);
  const syncMutexRef = useRef<Promise<void>>(Promise.resolve());
  const isSyncActiveRef = useRef<boolean>(false);
  const isSyncQueuedRef = useRef<boolean>(false);
  const mutationVersionRef = useRef<number>(0);
  const lastSyncCompletedAtRef = useRef<number>(0);

  jobsRef.current = jobs;
  shopProfileRef.current = shopProfile;
  auditLogsRef.current = auditLogs;
  connectionMetaRef.current = connectionMeta;
  syncStatusRef.current = syncStatus;
  isMutatingRef.current = isMutating;

  const showToast = useCallback((type: ToastBanner['type'], message: string) => {
    const id = Date.now();
    setToast({ id, type, message });
    window.setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 5000);
  }, []);

  // Apply root theme mode & subscribe to OS theme changes when set to 'system'
  useEffect(() => {
    applyThemeMode(themeMode);
    if (themeMode !== 'system') return;
    return subscribeSystemThemeChanges(() => {
      applyThemeMode('system');
    });
  }, [themeMode]);

  // Request Browser Notification permission automatically on startup when 'default'
  useEffect(() => {
    let active = true;
    if (getNotificationPermissionState() === 'default') {
      void requestBrowserNotificationPermission()
        .then((perm) => {
          if (active) setNotificationPermission(perm);
        })
        .catch(() => undefined);
    }
    const syncPermissionState = () => {
      if (active) {
        setNotificationPermission(getNotificationPermissionState());
      }
    };
    window.addEventListener('focus', syncPermissionState);
    return () => {
      active = false;
      window.removeEventListener('focus', syncPermissionState);
    };
  }, []);

  // Load IndexedDB / localStorage cache immediately on mount (clean defaults when empty)
  useEffect(() => {
    let active = true;
    loadCachedWorkspace().then((cached) => {
      if (!active) return;
      setJobs(cached.jobs);
      setShopProfile(cached.shopProfile ?? createDefaultShopProfile());
      setAuditLogs(cached.auditLogs);
      setConnectionMeta(cached.connectionMeta);
    });
    return () => {
      active = false;
    };
  }, []);

  // Keyboard shortcuts: Ctrl+K / Cmd+K or "/" focuses the live header Search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActivePage('dashboard');
        setSelectedJobUuid(null);
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === '/' && !isTyping) {
        e.preventDefault();
        setActivePage('dashboard');
        setSelectedJobUuid(null);
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        if (document.activeElement === searchInputRef.current) {
          searchInputRef.current?.blur();
        }
        if (printJob) {
          setPrintJob(null);
        } else if (whatsAppJob || whatsAppKhataCustomer) {
          setWhatsAppJob(null);
          setWhatsAppKhataCustomer(null);
        } else if (isReceivePaymentOpen) {
          if (!isMutating) setIsReceivePaymentOpen(false);
        } else if (!isNewJobModalOpen && !isDriveModalOpen && !pendingAction) {
          if (selectedJobUuid) {
            setSelectedJobUuid(null);
          } else if (activePage === 'khata' && selectedKhataKey) {
            setSelectedKhataKey(null);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activePage,
    isDriveModalOpen,
    isMutating,
    isNewJobModalOpen,
    isReceivePaymentOpen,
    pendingAction,
    printJob,
    selectedJobUuid,
    selectedKhataKey,
    whatsAppJob,
    whatsAppKhataCustomer,
  ]);

  const handleViewModeChange = useCallback((mode: JobViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleToggleAutoSync = useCallback(
    (enabled: boolean) => {
      setAutoSyncEnabled(enabled);
      try {
        localStorage.setItem(AUTO_SYNC_STORAGE_KEY, enabled ? 'true' : 'false');
      } catch {
        // Ignore storage errors
      }
      showToast(
        'info',
        enabled
          ? 'Live Auto-Sync On (10s): pulls Mobile updates automatically & on tab focus.'
          : 'Live Auto-Sync paused. Use Sync Now for manual pulls.'
      );
    },
    [showToast]
  );

  const handleChangeThemeMode = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    saveThemeMode(mode);
    applyThemeMode(mode);
  }, []);

  const handleChangeLanguage = useCallback((lang: AppLanguage) => {
    setLanguage(lang);
    saveLanguage(lang);
  }, []);

  const handleToggleNotifications = useCallback(
    (enabled: boolean) => {
      setNotificationsEnabled(enabled);
      setNotificationsEnabledState(enabled);
      if (enabled && getNotificationPermissionState() === 'default') {
        void requestBrowserNotificationPermission().then((perm) => {
          setNotificationPermission(perm);
        });
      }
      showToast(
        'info',
        enabled ? 'Browser notifications enabled.' : 'Browser notifications disabled.'
      );
    },
    [showToast]
  );

  const handleRequestNotificationPermission = useCallback(async () => {
    const perm = await requestBrowserNotificationPermission();
    setNotificationPermission(perm);
    if (perm === 'granted') {
      showToast('success', 'Browser notification permission granted.');
    } else if (perm === 'denied') {
      showToast(
        'error',
        'Notification permission is blocked. Enable notifications in your browser site settings.'
      );
    } else if (perm === 'unsupported') {
      showToast('error', 'This browser does not support desktop notifications.');
    }
  }, [showToast]);

  const handleSendTestNotification = useCallback(async () => {
    const result = await sendTestBrowserNotification();
    setNotificationPermission(getNotificationPermissionState());
    if (result.ok) {
      showToast('success', 'Test notification sent.');
    } else {
      showToast('error', result.reason || 'Could not send test notification.');
    }
  }, [showToast]);

  /**
   * Executes a Google API operation with automatic silent refresh (`prompt: ''`)
   * on missing or expired (401) OAuth access tokens. Falls back to interactive
   * consent only when explicitly requested (e.g., manual Sync Now button).
   */
  const executeWithTokenRefresh = useCallback(
    async <T,>(
      operation: (accessToken: string) => Promise<T>,
      options?: { allowInteractivePrompt?: boolean }
    ): Promise<T> => {
      const targetClientId = getEffectiveClientId().clientId;
      let token = getInMemoryAccessToken();

      if (!token) {
        token = await trySilentRefreshAccessToken(targetClientId);
      }
      if (!token && options?.allowInteractivePrompt) {
        token = await requestGoogleAccessToken({
          clientId: targetClientId,
          prompt: 'consent',
        });
      }
      if (!token) {
        throw new GoogleApiError(
          'Google OAuth session expired. Reconnect Google Sync to resume live sync.',
          401
        );
      }

      try {
        const res = await operation(token);
        setTokenExpired(false);
        return res;
      } catch (err) {
        if (err instanceof GoogleApiError && err.status === 401) {
          clearInMemoryAccessToken();
          let refreshed = await trySilentRefreshAccessToken(targetClientId);
          if (!refreshed && options?.allowInteractivePrompt) {
            refreshed = await requestGoogleAccessToken({
              clientId: targetClientId,
              prompt: 'consent',
            });
          }
          if (!refreshed) {
            setTokenExpired(true);
            throw new GoogleApiError(
              'Google OAuth session expired. Reconnect Google Sync to resume live sync.',
              401
            );
          }
          const retryRes = await operation(refreshed);
          setTokenExpired(false);
          return retryRes;
        }
        throw err;
      }
    },
    []
  );

  const runQuickBackgroundSyncRef = useRef<(force?: boolean) => Promise<void>>(
    async () => {}
  );

  /**
   * Async mutex/queue ensuring every push/pull executes sequentially without colliding.
   */
  const enqueueSyncOperation = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = syncMutexRef.current.then(async () => {
      isSyncActiveRef.current = true;
      try {
        return await task();
      } finally {
        isSyncActiveRef.current = false;
        if (isSyncQueuedRef.current) {
          isSyncQueuedRef.current = false;
          window.setTimeout(() => {
            void runQuickBackgroundSyncRef.current(true);
          }, 0);
        }
      }
    });
    syncMutexRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }, []);

  const runFullSync = useCallback(
    async (options?: { explicitSpreadsheetId?: string }) => {
      setSyncStatus('syncing');
      setSyncError(null);
      setJustSynced(false);
      const startVersion = ++mutationVersionRef.current;

      try {
        const result = await enqueueSyncOperation(() =>
          executeWithTokenRefresh(
            (token) =>
              connectAndSyncWorkspace(token, {
                explicitSpreadsheetId: options?.explicitSpreadsheetId,
                localJobs: jobsRef.current,
              }),
            {
              allowInteractivePrompt: true,
            }
          )
        );

        if (mutationVersionRef.current === startVersion) {
          setJobs(result.jobs);
          setShopProfile(result.shopProfile);
          setAuditLogs(result.auditLogs);
        }
        setConnectionMeta(result.connectionMeta);
        setSyncStatus('connected');
        setTokenExpired(false);
        setJustSynced(true);
        lastSyncCompletedAtRef.current = Date.now();
        window.setTimeout(() => setJustSynced(false), 3500);

        await Promise.all([
          saveCachedJobs(result.jobs),
          saveCachedShopProfile(result.shopProfile),
          saveCachedAuditLogs(result.auditLogs),
          saveCachedConnectionMeta(result.connectionMeta),
        ]);

        const activeCount = result.jobs.filter((j) => !j.isDeleted).length;
        const pushedSuffix =
          result.pushedLocalChangesCount > 0
            ? ` (pushed ${result.pushedLocalChangesCount} offline change${result.pushedLocalChangesCount === 1 ? '' : 's'})`
            : '';
        const successSummary = `Synced ${activeCount} active job(s) & ShopProfile from ${result.connectionMeta.spreadsheetTitle}${pushedSuffix}.`;
        showToast('success', successSummary);
        void notifySyncResult({ success: true, summary: successSummary });
      } catch (err) {
        if (err instanceof GoogleApiError && err.status === 401) {
          setTokenExpired(true);
        }
        const message =
          err instanceof Error ? err.message : 'Failed to connect and sync with Google Sheets.';
        setSyncStatus('error');
        setSyncError(message);
        showToast('error', message);
        void notifySyncResult({ success: false, summary: message });
      }
    },
    [enqueueSyncOperation, executeWithTokenRefresh, showToast]
  );

  // Silent, queued background sync for Mobile <-> Laptop real-time parity
  const runQuickBackgroundSync = useCallback(
    async (force = false) => {
      if (syncStatusRef.current !== 'connected') return;
      const meta = connectionMetaRef.current;
      if (!meta?.spreadsheetId) return;

      if (isSyncActiveRef.current || isMutatingRef.current) {
        isSyncQueuedRef.current = true;
        return;
      }

      if (
        !force &&
        Date.now() - lastSyncCompletedAtRef.current < AUTO_SYNC_MIN_COOLDOWN_MS
      ) {
        return;
      }

      const startVersion = mutationVersionRef.current;

      try {
        const result = await enqueueSyncOperation(() =>
          executeWithTokenRefresh(
            (token) => quickSyncWorkspace(token, meta, jobsRef.current),
            { allowInteractivePrompt: false }
          )
        );

        // Skip applying if user edited something locally while this request was in flight
        if (mutationVersionRef.current !== startVersion || isMutatingRef.current) {
          return;
        }

        const jobDiffCount = countRemoteJobChanges(jobsRef.current, result.jobs);
        const profileChanged =
          (shopProfileRef.current?.updatedAt ?? 0) !== result.shopProfile.updatedAt ||
          (shopProfileRef.current?.nextJobNumberSequence ?? 0) !==
            result.shopProfile.nextJobNumberSequence;
        const auditChanged = auditLogsRef.current.length !== result.auditLogs.length;

        lastSyncCompletedAtRef.current = Date.now();
        setConnectionMeta(result.connectionMeta);

        if (jobDiffCount > 0 || profileChanged || auditChanged || result.pushedLocalChangesCount > 0) {
          setJobs(result.jobs);
          setShopProfile(result.shopProfile);
          setAuditLogs(result.auditLogs);
          setJustSynced(true);
          window.setTimeout(() => setJustSynced(false), 3000);

          await Promise.all([
            saveCachedJobs(result.jobs),
            saveCachedShopProfile(result.shopProfile),
            saveCachedAuditLogs(result.auditLogs),
            saveCachedConnectionMeta(result.connectionMeta),
          ]);

          if (jobDiffCount > 0) {
            showToast(
              'info',
              `Live Sync: ${jobDiffCount} repair job update${jobDiffCount === 1 ? '' : 's'} synced from Google Sheets.`
            );
          } else if (profileChanged) {
            showToast('info', 'Live Sync: Shop settings synced from Google Sheets.');
          }
        }
      } catch (err) {
        if (err instanceof GoogleApiError && err.status === 401) {
          clearInMemoryAccessToken();
          setTokenExpired(true);
        }
      }
    },
    [enqueueSyncOperation, executeWithTokenRefresh, showToast]
  );

  runQuickBackgroundSyncRef.current = runQuickBackgroundSync;

  // Automatic 8-second polling + instant sync on tab focus / visibility / online
  useEffect(() => {
    if (syncStatus !== 'connected' || !autoSyncEnabled) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void runQuickBackgroundSync(false);
      }
    }, AUTO_SYNC_INTERVAL_MS);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void runQuickBackgroundSync(false);
      }
    };

    const handleOnline = () => {
      void runQuickBackgroundSync(true);
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [autoSyncEnabled, runQuickBackgroundSync, syncStatus]);

  const handleDisconnect = useCallback(() => {
    clearInMemoryAccessToken();
    setSyncStatus('disconnected');
    setSyncError(null);
    setTokenExpired(false);
    setJustSynced(false);
    showToast('info', 'Disconnected Google OAuth session. Cached data remains available locally.');
  }, [showToast]);

  const handleSaveProfile = useCallback(
    async (updatedProfile: ShopProfile) => {
      mutationVersionRef.current += 1;
      setIsMutating(true);
      try {
        if (syncStatus === 'connected' && connectionMeta?.spreadsheetId) {
          const res = await enqueueSyncOperation(() =>
            executeWithTokenRefresh(
              (token) =>
                saveShopProfileToSheet(
                  token,
                  connectionMeta.spreadsheetId,
                  updatedProfile
                ),
              { allowInteractivePrompt: false }
            )
          );

          const nextLogs = [res.auditEntry, ...auditLogsRef.current];
          setShopProfile(res.profile);
          setAuditLogs(nextLogs);
          lastSyncCompletedAtRef.current = Date.now();
          await Promise.all([
            saveCachedShopProfile(res.profile),
            saveCachedAuditLogs(nextLogs),
          ]);
          showToast('success', 'ShopProfile saved & synced to Google Sheet (ShopProfile!A2:N2).');
        } else {
          const localProfile: ShopProfile = {
            ...updatedProfile,
            updatedAt: Date.now(),
          };
          setShopProfile(localProfile);
          await saveCachedShopProfile(localProfile);
          showToast(
            'info',
            'ShopProfile saved locally. Connect Google Drive to sync ShopProfile!A2:N2.'
          );
        }
      } catch (err) {
        if (err instanceof GoogleApiError && err.status === 401) {
          const localFallback: ShopProfile = {
            ...updatedProfile,
            updatedAt: Date.now(),
          };
          setShopProfile(localFallback);
          await saveCachedShopProfile(localFallback);
          setTokenExpired(true);
          showToast(
            'info',
            'Saved locally. Click "Reconnect Google Sync" to push ShopProfile to Google Sheets.'
          );
          return;
        }
        const msg = err instanceof Error ? err.message : 'Failed to save ShopProfile.';
        setSyncError(msg);
        showToast('error', msg);
      } finally {
        setIsMutating(false);
      }
    },
    [
      connectionMeta?.spreadsheetId,
      enqueueSyncOperation,
      executeWithTokenRefresh,
      showToast,
      syncStatus,
    ]
  );

  const executePendingMutation = useCallback(async () => {
    if (!pendingAction) return;

    mutationVersionRef.current += 1;
    setIsMutating(true);
    const target = pendingAction.job;
    try {
      if (syncStatus === 'connected' && connectionMeta?.spreadsheetId) {
        const res = await enqueueSyncOperation(() =>
          executeWithTokenRefresh(
            async (token) => {
              if (target.sheetRow && target.sheetRow >= 2) {
                return await softDeleteJobInSheet(token, connectionMeta.spreadsheetId, target);
              }
              return await appendJobToSheet(
                token,
                connectionMeta.spreadsheetId,
                { ...target, isDeleted: true, updatedAt: Date.now() },
                'DELETE'
              );
            },
            { allowInteractivePrompt: false }
          )
        );

        const nextJobs = jobsRef.current.map((j) =>
          j.recordUuid === res.job.recordUuid ? res.job : j
        );
        const nextLogs = [res.auditEntry, ...auditLogsRef.current];
        setJobs(nextJobs);
        setAuditLogs(nextLogs);
        lastSyncCompletedAtRef.current = Date.now();
        if (selectedJobUuid === res.job.recordUuid) {
          setSelectedJobUuid(null);
        }
        await Promise.all([
          saveCachedJobs(nextJobs),
          saveCachedAuditLogs(nextLogs),
        ]);
        showToast(
          'success',
          `Soft-deleted ${res.job.jobNumber} (IsDeleted = true at row ${res.job.sheetRow ?? 'new'}) & synced.`
        );
      } else {
        const locallyDeleted: RepairJob = {
          ...target,
          isDeleted: true,
          updatedAt: Date.now(),
        };
        const nextJobs = jobsRef.current.map((j) =>
          j.recordUuid === locallyDeleted.recordUuid ? locallyDeleted : j
        );
        setJobs(nextJobs);
        if (selectedJobUuid === locallyDeleted.recordUuid) {
          setSelectedJobUuid(null);
        }
        await saveCachedJobs(nextJobs);
        showToast(
          'info',
          `Marked ${locallyDeleted.jobNumber} as deleted locally. Sync Drive to push to Google Sheets.`
        );
      }
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 401) {
        const locallyDeleted: RepairJob = {
          ...target,
          isDeleted: true,
          updatedAt: Date.now(),
        };
        const nextJobs = jobsRef.current.map((j) =>
          j.recordUuid === locallyDeleted.recordUuid ? locallyDeleted : j
        );
        setJobs(nextJobs);
        if (selectedJobUuid === locallyDeleted.recordUuid) {
          setSelectedJobUuid(null);
        }
        await saveCachedJobs(nextJobs);
        setTokenExpired(true);
        showToast(
          'info',
          `Marked ${locallyDeleted.jobNumber} deleted locally. Click "Reconnect Google Sync" to sync.`
        );
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to write to Google Sheets.';
      setSyncError(msg);
      showToast('error', msg);
    } finally {
      setIsMutating(false);
      setPendingAction(null);
    }
  }, [
    connectionMeta?.spreadsheetId,
    enqueueSyncOperation,
    executeWithTokenRefresh,
    pendingAction,
    selectedJobUuid,
    showToast,
    syncStatus,
  ]);

  const handleUpdateJob = useCallback(
    async (updatedJob: RepairJob, auditDetails: string): Promise<boolean> => {
      const previousJob = jobsRef.current.find(
        (j) => j.recordUuid === updatedJob.recordUuid
      );
      mutationVersionRef.current += 1;
      setIsMutating(true);
      try {
        if (syncStatus === 'connected' && connectionMeta?.spreadsheetId) {
          const res = await enqueueSyncOperation(() =>
            executeWithTokenRefresh(
              async (token) => {
                if (updatedJob.sheetRow && updatedJob.sheetRow >= 2) {
                  return await updateJobInSheet(
                    token,
                    connectionMeta.spreadsheetId,
                    updatedJob,
                    'UPDATE',
                    auditDetails
                  );
                }
                return await appendJobToSheet(
                  token,
                  connectionMeta.spreadsheetId,
                  { ...updatedJob, updatedAt: Date.now() },
                  'UPDATE'
                );
              },
              { allowInteractivePrompt: false }
            )
          );

          const nextJobs = jobsRef.current.map((j) =>
            j.recordUuid === res.job.recordUuid ? res.job : j
          );
          const nextLogs = [res.auditEntry, ...auditLogsRef.current];
          setJobs(nextJobs);
          setAuditLogs(nextLogs);
          lastSyncCompletedAtRef.current = Date.now();
          await Promise.all([
            saveCachedJobs(nextJobs),
            saveCachedAuditLogs(nextLogs),
          ]);

          showToast(
            'success',
            `Synced ${res.job.jobNumber} (Row ${res.job.sheetRow ?? 'new'}) immediately to Google Sheets.`
          );
          if (previousJob && previousJob.stage !== res.job.stage) {
            void notifyJobStageChanged(res.job, previousJob.stage, res.job.stage);
          }
          return true;
        }

        const offlineUpdated: RepairJob = {
          ...updatedJob,
          updatedAt: Date.now(),
        };
        const nextJobs = jobsRef.current.map((j) =>
          j.recordUuid === offlineUpdated.recordUuid ? offlineUpdated : j
        );
        setJobs(nextJobs);
        await saveCachedJobs(nextJobs);
        showToast(
          'info',
          `Saved ${offlineUpdated.jobNumber} locally. Connect & Sync to push changes to Google Sheets.`
        );
        if (previousJob && previousJob.stage !== offlineUpdated.stage) {
          void notifyJobStageChanged(
            offlineUpdated,
            previousJob.stage,
            offlineUpdated.stage
          );
        }
        return true;
      } catch (err) {
        if (err instanceof GoogleApiError && err.status === 401) {
          const offlineUpdated: RepairJob = {
            ...updatedJob,
            updatedAt: Date.now(),
          };
          const nextJobs = jobsRef.current.map((j) =>
            j.recordUuid === offlineUpdated.recordUuid ? offlineUpdated : j
          );
          setJobs(nextJobs);
          await saveCachedJobs(nextJobs);
          setTokenExpired(true);
          showToast(
            'info',
            `Saved ${offlineUpdated.jobNumber} locally. Click "Reconnect Google Sync" to sync.`
          );
          if (previousJob && previousJob.stage !== offlineUpdated.stage) {
            void notifyJobStageChanged(
              offlineUpdated,
              previousJob.stage,
              offlineUpdated.stage
            );
          }
          return true;
        }
        const msg = err instanceof Error ? err.message : 'Failed to update job.';
        setSyncError(msg);
        showToast('error', msg);
        return false;
      } finally {
        setIsMutating(false);
      }
    },
    [
      connectionMeta?.spreadsheetId,
      enqueueSyncOperation,
      executeWithTokenRefresh,
      showToast,
      syncStatus,
    ]
  );

  const handleCreateNewJob = useCallback(
    async (newJob: RepairJob, jobNumberInfo: GeneratedJobNumberInfo) => {
      const baseProfile = shopProfileRef.current ?? createDefaultShopProfile();
      const nextProfile: ShopProfile = {
        ...baseProfile,
        nextJobNumberSequence: jobNumberInfo.sequence + 1,
        lastJobMonth: jobNumberInfo.currentMonth,
        updatedAt: newJob.createdAt,
      };

      mutationVersionRef.current += 1;
      setIsMutating(true);
      try {
        if (syncStatus === 'connected' && connectionMeta?.spreadsheetId) {
          const createdResult = await enqueueSyncOperation(() =>
            executeWithTokenRefresh(
              (token) =>
                createNewJobAtomic(
                  token,
                  connectionMeta.spreadsheetId,
                  newJob,
                  nextProfile
                ),
              { allowInteractivePrompt: false }
            )
          );

          const nextJobs = [createdResult.job, ...jobsRef.current];
          const nextLogs = [createdResult.auditEntry, ...auditLogsRef.current];
          setJobs(nextJobs);
          setShopProfile(createdResult.profile);
          setAuditLogs(nextLogs);
          lastSyncCompletedAtRef.current = Date.now();

          await Promise.all([
            saveCachedJobs(nextJobs),
            saveCachedShopProfile(createdResult.profile),
            saveCachedAuditLogs(nextLogs),
          ]);

          setIsNewJobModalOpen(false);
          setActivePage('dashboard');
          setSelectedJobUuid(createdResult.job.recordUuid);
          showToast(
            'success',
            `Created ${createdResult.job.jobNumber} (Row ${createdResult.job.sheetRow ?? 'new'}) & synced immediately.`
          );
          void notifyJobCreated(createdResult.job);
        } else {
          const nextJobs = [newJob, ...jobsRef.current];
          setJobs(nextJobs);
          setShopProfile(nextProfile);
          await Promise.all([
            saveCachedJobs(nextJobs),
            saveCachedShopProfile(nextProfile),
          ]);

          setIsNewJobModalOpen(false);
          setActivePage('dashboard');
          setSelectedJobUuid(newJob.recordUuid);
          showToast(
            'info',
            `Created ${newJob.jobNumber} in local cache. Connect Google Drive to sync to Sheets.`
          );
          void notifyJobCreated(newJob);
        }
      } catch (err) {
        if (err instanceof GoogleApiError && err.status === 401) {
          const nextJobs = [newJob, ...jobsRef.current];
          setJobs(nextJobs);
          setShopProfile(nextProfile);
          await Promise.all([
            saveCachedJobs(nextJobs),
            saveCachedShopProfile(nextProfile),
          ]);
          setIsNewJobModalOpen(false);
          setActivePage('dashboard');
          setSelectedJobUuid(newJob.recordUuid);
          setTokenExpired(true);
          showToast(
            'info',
            `Created ${newJob.jobNumber} locally. Click "Reconnect Google Sync" to upload to Sheets.`
          );
          void notifyJobCreated(newJob);
          return;
        }
        const msg = err instanceof Error ? err.message : 'Failed to create repair job.';
        setSyncError(msg);
        showToast('error', msg);
      } finally {
        setIsMutating(false);
      }
    },
    [
      connectionMeta?.spreadsheetId,
      enqueueSyncOperation,
      executeWithTokenRefresh,
      showToast,
      syncStatus,
    ]
  );

  const openNewJobModal = useCallback(
    (prefillCustomer?: { name: string; phone: string } | null) => {
      setNewJobInitialCustomer(prefillCustomer ?? null);
      setIsNewJobModalOpen(true);
      if (syncStatusRef.current === 'connected') {
        void runQuickBackgroundSync(true);
      }
    },
    [runQuickBackgroundSync]
  );

  const navigateToDashboard = useCallback(() => {
    setActivePage('dashboard');
    setSelectedJobUuid(null);
    setSelectedKhataKey(null);
  }, []);

  const navigateToKhataBook = useCallback(() => {
    setActivePage('khata');
    setSelectedJobUuid(null);
    setSelectedKhataKey(null);
  }, []);

  const navigateToSettings = useCallback((tab: SettingsTab) => {
    setSelectedJobUuid(null);
    setSelectedKhataKey(null);
    setSettingsTab(tab);
    setActivePage('settings');
  }, []);

  // Only non-deleted jobs participate in Dashboard KPIs, Khata, search, and listings
  const activeJobs = useMemo(
    () => jobs.filter((j) => !j.isDeleted),
    [jobs]
  );

  const khataCustomers = useMemo(() => buildKhataCustomers(jobs), [jobs]);

  const pendingKhataCount = useMemo(
    () => khataCustomers.filter((c) => c.totalPendingDue > 0.01).length,
    [khataCustomers]
  );

  const selectedKhataCustomer = useMemo(
    () =>
      selectedKhataKey
        ? khataCustomers.find((c) => c.customerKey === selectedKhataKey) ?? null
        : null,
    [khataCustomers, selectedKhataKey]
  );

  // Live multi-field search & stage filter
  const filteredJobs = useMemo(() => {
    const rawQuery = searchQuery.trim().toLowerCase();
    const queryDigits = digitsOnly(searchQuery);

    return activeJobs.filter((job) => {
      if (stageFilter !== 'ALL' && job.stage !== stageFilter) {
        return false;
      }

      if (!rawQuery) return true;

      const textMatch =
        job.jobNumber.toLowerCase().includes(rawQuery) ||
        job.customerName.toLowerCase().includes(rawQuery) ||
        job.customerPhone.toLowerCase().includes(rawQuery) ||
        job.deviceBrand.toLowerCase().includes(rawQuery) ||
        job.deviceModel.toLowerCase().includes(rawQuery) ||
        job.imeiOrSerial.toLowerCase().includes(rawQuery);

      if (textMatch) return true;

      if (queryDigits.length >= 2) {
        const phoneDigits = digitsOnly(job.customerPhone);
        const imeiDigits = digitsOnly(job.imeiOrSerial);
        if (phoneDigits.includes(queryDigits) || imeiDigits.includes(queryDigits)) {
          return true;
        }
      }

      return false;
    });
  }, [activeJobs, searchQuery, stageFilter]);

  const selectedJob = useMemo(
    () => activeJobs.find((j) => j.recordUuid === selectedJobUuid) ?? null,
    [activeJobs, selectedJobUuid]
  );

  const currencySymbol = shopProfile?.currencySymbol || '₹';

  const handleReceiveKhataPayment = useCallback(
    async (payload: { amount: number; paymentMode: string; note: string }) => {
      if (!selectedKhataCustomer) return;

      const plan = buildKhataPaymentPlan(
        selectedKhataCustomer,
        payload.amount,
        payload.paymentMode,
        payload.note,
        currencySymbol
      );

      if (plan.allocations.length === 0) {
        showToast('info', 'No unpaid balance found to allocate this payment.');
        return;
      }

      mutationVersionRef.current += 1;
      setIsMutating(true);
      try {
        if (syncStatus === 'connected' && connectionMeta?.spreadsheetId) {
          const res = await enqueueSyncOperation(() =>
            executeWithTokenRefresh(
              (token) =>
                batchUpdateJobsInSheet(
                  token,
                  connectionMeta.spreadsheetId,
                  plan.allocations.map((a) => ({
                    job: a.updatedJob,
                    auditDetails: a.auditDetails,
                  }))
                ),
              { allowInteractivePrompt: false }
            )
          );

          const updatedMap = new Map(res.jobs.map((j) => [j.recordUuid, j]));
          const nextJobs = jobsRef.current.map(
            (j) => updatedMap.get(j.recordUuid) ?? j
          );
          const nextLogs = [...[...res.auditEntries].reverse(), ...auditLogsRef.current];
          setJobs(nextJobs);
          setAuditLogs(nextLogs);
          lastSyncCompletedAtRef.current = Date.now();
          await Promise.all([
            saveCachedJobs(nextJobs),
            saveCachedAuditLogs(nextLogs),
          ]);
          setIsReceivePaymentOpen(false);
          showToast(
            'success',
            `Received ${currencySymbol}${plan.totalApplied.toLocaleString()} via ${payload.paymentMode} (${res.jobs.length} ${
              res.jobs.length === 1 ? 'job' : 'jobs'
            }) & synced to Google Sheets.`
          );
        } else {
          const updatedMap = new Map(
            plan.allocations.map((a) => [a.updatedJob.recordUuid, a.updatedJob])
          );
          const nextJobs = jobsRef.current.map(
            (j) => updatedMap.get(j.recordUuid) ?? j
          );
          setJobs(nextJobs);
          await saveCachedJobs(nextJobs);
          setIsReceivePaymentOpen(false);
          showToast(
            'info',
            `Recorded ${currencySymbol}${plan.totalApplied.toLocaleString()} locally. Connect Google Drive to sync to Sheets.`
          );
        }
      } catch (err) {
        if (err instanceof GoogleApiError && err.status === 401) {
          const updatedMap = new Map(
            plan.allocations.map((a) => [a.updatedJob.recordUuid, a.updatedJob])
          );
          const nextJobs = jobsRef.current.map(
            (j) => updatedMap.get(j.recordUuid) ?? j
          );
          setJobs(nextJobs);
          await saveCachedJobs(nextJobs);
          setIsReceivePaymentOpen(false);
          setTokenExpired(true);
          showToast(
            'info',
            'Khata payment saved locally. Click "Reconnect Google Sync" to push updates to Sheets.'
          );
          return;
        }
        const msg =
          err instanceof Error ? err.message : 'Failed to record Khata payment.';
        setSyncError(msg);
        showToast('error', msg);
      } finally {
        setIsMutating(false);
      }
    },
    [
      connectionMeta?.spreadsheetId,
      currencySymbol,
      enqueueSyncOperation,
      executeWithTokenRefresh,
      selectedKhataCustomer,
      showToast,
      syncStatus,
    ]
  );

  const confirmDialogConfig = useMemo(() => {
    if (!pendingAction) return null;
    return {
      title: `Soft-Delete ${pendingAction.job.jobNumber}?`,
      description: `This will set IsDeleted = "true" on row ${pendingAction.job.sheetRow ?? '?'} via batchUpdate (zero rows erased) and record a DELETE entry in AuditLog.`,
      confirmLabel: 'Confirm Soft-Delete',
      variant: 'danger' as const,
    };
  }, [pendingAction]);

  return (
    <>
      <div className="no-print min-h-screen bg-slate-100 text-slate-900 dark:bg-[#0F172A] dark:text-slate-100 flex flex-col">
        <TopHeader
          shopName={shopProfile?.shopName || 'Mobile Repair Shop'}
          searchQuery={searchQuery}
          searchInputRef={searchInputRef}
          syncStatus={syncStatus}
          lastSyncedAt={connectionMeta?.lastSyncedAt ?? null}
          justSynced={justSynced}
          autoSyncEnabled={autoSyncEnabled}
          isKhataActive={activePage === 'khata' && !selectedJob}
          pendingKhataCount={pendingKhataCount}
          onSearchChange={(q) => {
            setSearchQuery(q);
            if (activePage !== 'dashboard' || selectedJobUuid) {
              setActivePage('dashboard');
              setSelectedJobUuid(null);
              setSelectedKhataKey(null);
            }
          }}
          onGoDashboard={navigateToDashboard}
          onOpenKhataBook={navigateToKhataBook}
          onOpenDriveModal={() => setIsDriveModalOpen(true)}
          onOpenSettings={() => navigateToSettings('profile')}
          onQuickSync={() => runFullSync()}
          onNewJobClick={() => openNewJobModal(null)}
        />

        {/* Compact Tablet / Mobile Navigation Strip */}
        <nav
          aria-label="Mobile navigation"
          className="border-b border-slate-200 bg-white px-4 py-2 lg:hidden dark:border-slate-800/90 dark:bg-[#0F172A]"
        >
          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={navigateToDashboard}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                activePage === 'dashboard'
                  ? 'bg-[#2563EB] text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-[#1E293B] dark:text-slate-300'
              }`}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              <span>Dashboard</span>
            </button>
            <button
              type="button"
              onClick={navigateToKhataBook}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                activePage === 'khata'
                  ? 'bg-[#2563EB] text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-[#1E293B] dark:text-slate-300'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5 text-amber-500 dark:text-amber-300" />
              <span>Khata Book</span>
              {pendingKhataCount > 0 && (
                <span
                  className={`rounded px-1.5 py-0.5 font-mono-tabular text-[10px] font-bold ${
                    activePage === 'khata'
                      ? 'bg-white/20 text-white'
                      : 'bg-red-100 text-red-800 dark:bg-red-500/25 dark:text-red-200'
                  }`}
                >
                  {pendingKhataCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => openNewJobModal(null)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 whitespace-nowrap dark:border-slate-800 dark:bg-[#1E293B] dark:text-slate-200"
            >
              <Plus className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <span>New Job</span>
            </button>
            <button
              type="button"
              onClick={() => navigateToSettings('profile')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                activePage === 'settings' && settingsTab === 'profile'
                  ? 'bg-[#2563EB] text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-[#1E293B] dark:text-slate-300'
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              <span>Settings</span>
            </button>
            <button
              type="button"
              onClick={() => navigateToSettings('sync')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                activePage === 'settings' && settingsTab === 'sync'
                  ? 'bg-[#2563EB] text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-[#1E293B] dark:text-slate-300'
              }`}
            >
              <Cloud className="h-3.5 w-3.5" />
              <span>Sync Manager</span>
            </button>
            <button
              type="button"
              onClick={() => navigateToSettings('audit')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                activePage === 'settings' && settingsTab === 'audit'
                  ? 'bg-[#2563EB] text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-[#1E293B] dark:text-slate-300'
              }`}
            >
              <History className="h-3.5 w-3.5" />
              <span>Audit Log</span>
            </button>
          </div>
        </nav>

        {/* Desktop Shell: Left Sidebar + Main Content */}
        <div className="mx-auto flex w-full max-w-[1440px] flex-1">
          <aside className="hidden lg:flex w-60 shrink-0 flex-col justify-between border-r border-slate-200 bg-white px-4 py-6 dark:border-slate-800/80 dark:bg-[#0F172A]">
            <div className="space-y-1.5">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                POS Workspace
              </p>

              <button
                type="button"
                onClick={navigateToDashboard}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  activePage === 'dashboard'
                    ? 'bg-[#2563EB] text-white shadow-sm'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#1E293B] dark:hover:text-white'
                }`}
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                <span>Dashboard</span>
              </button>

              <button
                type="button"
                onClick={navigateToKhataBook}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  activePage === 'khata'
                    ? 'bg-[#2563EB] text-white shadow-sm'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#1E293B] dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <BookOpen
                    className={`h-4 w-4 shrink-0 ${
                      activePage === 'khata'
                        ? 'text-amber-200'
                        : 'text-amber-600 dark:text-amber-300'
                    }`}
                  />
                  <span>Khata Book</span>
                </span>
                {pendingKhataCount > 0 && (
                  <span
                    className={`rounded-md px-1.5 py-0.5 font-mono-tabular text-[11px] font-semibold ${
                      activePage === 'khata'
                        ? 'bg-white/20 text-white'
                        : 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300'
                    }`}
                  >
                    {pendingKhataCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => openNewJobModal(null)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#1E293B] dark:hover:text-white"
              >
                <Plus className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <span>New Repair Job</span>
              </button>

              <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Configuration
              </p>

              <button
                type="button"
                onClick={() => navigateToSettings('profile')}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  activePage === 'settings' && settingsTab === 'profile'
                    ? 'bg-[#2563EB] text-white shadow-sm'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#1E293B] dark:hover:text-white'
                }`}
              >
                <Settings className="h-4 w-4 shrink-0" />
                <span>Shop Settings</span>
              </button>

              <button
                type="button"
                onClick={() => navigateToSettings('sync')}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  activePage === 'settings' && settingsTab === 'sync'
                    ? 'bg-[#2563EB] text-white shadow-sm'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#1E293B] dark:hover:text-white'
                }`}
              >
                <Cloud className="h-4 w-4 shrink-0" />
                <span>Sheets Sync</span>
              </button>

              <button
                type="button"
                onClick={() => navigateToSettings('audit')}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  activePage === 'settings' && settingsTab === 'audit'
                    ? 'bg-[#2563EB] text-white shadow-sm'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#1E293B] dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <History className="h-4 w-4 shrink-0" />
                  <span>Audit Log</span>
                </span>
                <span
                  className={`font-mono-tabular text-[11px] ${
                    activePage === 'settings' && settingsTab === 'audit'
                      ? 'text-blue-100'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {auditLogs.length}
                </span>
              </button>
            </div>

            {/* Compact Sidebar Workspace Footer */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-2 dark:border-slate-800 dark:bg-[#1E293B]/70">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700 dark:text-slate-300">Database</span>
                <span
                  className={`font-mono-tabular text-[11px] font-semibold ${
                    syncStatus === 'connected'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : syncStatus === 'error'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-amber-600 dark:text-amber-300'
                  }`}
                >
                  {syncStatus === 'connected'
                    ? autoSyncEnabled
                      ? 'Live · 10s'
                      : 'Connected'
                    : syncStatus === 'syncing'
                      ? 'Syncing'
                      : syncStatus === 'error'
                        ? 'Error'
                        : 'Cached'}
                </span>
              </div>
              <p className="truncate font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                {connectionMeta?.spreadsheetTitle || 'MobileRepairShop_DB'}
              </p>
              <p className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                {activeJobs.length} active job{activeJobs.length === 1 ? '' : 's'}
              </p>
            </div>
          </aside>

          <main className="min-w-0 flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
            {/* Expired OAuth Session Reconnect Banner */}
            {tokenExpired && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>
                    Google OAuth session expired and needs your confirmation. Offline edits are saved locally.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => runFullSync()}
                  disabled={syncStatus === 'syncing'}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                  <span>Reconnect Google Sync</span>
                </button>
              </div>
            )}

            {activePage === 'settings' ? (
              <SettingsHub
                activeTab={settingsTab}
                shopProfile={shopProfile}
                auditLogs={auditLogs}
                syncStatus={syncStatus}
                connectionMeta={connectionMeta}
                errorMessage={syncError}
                isSaving={isMutating}
                autoSyncEnabled={autoSyncEnabled}
                themeMode={themeMode}
                language={language}
                notificationsEnabled={notificationsEnabled}
                notificationPermission={notificationPermission}
                onTabChange={setSettingsTab}
                onSaveProfile={handleSaveProfile}
                onConnectAndSync={() => runFullSync()}
                onLinkExistingSheet={(sheetId) =>
                  runFullSync({ explicitSpreadsheetId: sheetId })
                }
                onDisconnect={handleDisconnect}
                onToggleAutoSync={handleToggleAutoSync}
                onChangeThemeMode={handleChangeThemeMode}
                onChangeLanguage={handleChangeLanguage}
                onToggleNotifications={handleToggleNotifications}
                onRequestNotificationPermission={handleRequestNotificationPermission}
                onSendTestNotification={handleSendTestNotification}
              />
            ) : selectedJob ? (
              <JobDetailView
                job={selectedJob}
                currencySymbol={currencySymbol}
                isSaving={isMutating}
                onBack={() => setSelectedJobUuid(null)}
                onUpdateJob={handleUpdateJob}
                onRequestSoftDelete={(job) =>
                  setPendingAction({ kind: 'soft_delete_job', job })
                }
                onOpenPrintReceipt={(job) => setPrintJob(job)}
                onOpenWhatsApp={(job) => setWhatsAppJob(job)}
              />
            ) : activePage === 'khata' ? (
              selectedKhataCustomer ? (
                <KhataCustomerDetailView
                  customer={selectedKhataCustomer}
                  currencySymbol={currencySymbol}
                  isSaving={isMutating}
                  onBack={() => setSelectedKhataKey(null)}
                  onSelectJob={(job) => setSelectedJobUuid(job.recordUuid)}
                  onOpenWhatsAppReminder={(customer) =>
                    setWhatsAppKhataCustomer(customer)
                  }
                  onOpenNewJobForCustomer={(customer) => openNewJobModal(customer)}
                  onOpenReceivePayment={() => setIsReceivePaymentOpen(true)}
                />
              ) : (
                <KhataBookView
                  customers={khataCustomers}
                  currencySymbol={currencySymbol}
                  onSelectCustomer={(customerKey) => setSelectedKhataKey(customerKey)}
                />
              )
            ) : (
              <>
                {/* Compact Dashboard Header & Sync Strip */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                      Repair Operations Dashboard
                    </h1>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {connectionMeta
                        ? `${connectionMeta.folderName} / ${connectionMeta.spreadsheetTitle}`
                        : 'Connect Google Drive to sync tickets with your Android POS'}
                      {connectionMeta?.lastSyncedAt && (
                        <span className="font-mono-tabular">
                          {' '}
                          · Last synced {new Date(connectionMeta.lastSyncedAt).toLocaleString()}
                        </span>
                      )}
                      {syncStatus === 'connected' && autoSyncEnabled && (
                        <span className="ml-2 font-medium text-emerald-700 dark:text-emerald-400">
                          · Live Auto-Sync On (10s)
                        </span>
                      )}
                      {justSynced && (
                        <span className="ml-2 font-medium text-blue-700 dark:text-blue-300">
                          · Up to date
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    {connectionMeta?.spreadsheetUrl && (
                      <a
                        href={connectionMeta.spreadsheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:text-slate-900 whitespace-nowrap dark:border-slate-700/80 dark:bg-[#1E293B] dark:text-slate-200 dark:shadow-none dark:hover:border-slate-600 dark:hover:text-white"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                        <span>Open in Sheets</span>
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        syncStatus === 'connected' ? runFullSync() : setIsDriveModalOpen(true)
                      }
                      disabled={syncStatus === 'syncing'}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-blue-500/50 hover:text-slate-900 disabled:opacity-50 whitespace-nowrap dark:border-slate-700/80 dark:bg-[#1E293B] dark:text-slate-200 dark:shadow-none dark:hover:border-blue-500/40 dark:hover:text-white"
                    >
                      {syncStatus === 'syncing' ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400" />
                          <span>Syncing...</span>
                        </>
                      ) : syncStatus === 'connected' ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span>Sync Now</span>
                        </>
                      ) : (
                        <>
                          <Cloud className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                          <span>Connect Drive</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* 1. KPI Summary Row */}
                <KpiSummaryRow
                  jobs={jobs}
                  currencySymbol={currencySymbol}
                  onSelectStageFilter={(stage) => {
                    if (
                      stage === 'ALL' ||
                      stage === JobStage.READY_FOR_PICKUP ||
                      stage === JobStage.DELIVERED
                    ) {
                      setStageFilter(stage);
                    }
                  }}
                  onOpenKhataBook={navigateToKhataBook}
                />

                {/* 2 & 3. Stage Filters, View Toggle & Desktop-First Job List */}
                <JobDashboardList
                  allActiveJobs={activeJobs}
                  filteredJobs={filteredJobs}
                  stageFilter={stageFilter}
                  searchQuery={searchQuery}
                  viewMode={viewMode}
                  currencySymbol={currencySymbol}
                  isConnected={syncStatus === 'connected'}
                  onStageFilterChange={setStageFilter}
                  onViewModeChange={handleViewModeChange}
                  onClearFilters={() => {
                    setSearchQuery('');
                    setStageFilter('ALL');
                  }}
                  onSelectJob={(job) => setSelectedJobUuid(job.recordUuid)}
                  onOpenDriveConnect={() => setIsDriveModalOpen(true)}
                  onOpenWhatsApp={(job) => setWhatsAppJob(job)}
                />
              </>
            )}

            <footer className="mt-10 border-t border-slate-200/80 pt-4 pb-6 text-center text-xs text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                <span>Mobile Repair Shop POS</span>
                <span aria-hidden="true">&middot;</span>
                <a
                  href="/privacy.html"
                  className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Privacy Policy
                </a>
                <span aria-hidden="true">&middot;</span>
                <a
                  href="/terms.html"
                  className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Terms of Service
                </a>
              </div>
            </footer>
          </main>
        </div>

        {/* Modals inside no-print shell */}
        <DriveConnectModal
          isOpen={isDriveModalOpen}
          syncStatus={syncStatus}
          connectionMeta={connectionMeta}
          errorMessage={syncError}
          onClose={() => setIsDriveModalOpen(false)}
          onConnectAndSync={() => runFullSync()}
          onLinkExistingSheet={(sheetId) =>
            runFullSync({ explicitSpreadsheetId: sheetId })
          }
          onDisconnect={handleDisconnect}
        />

        <NewJobModal
          isOpen={isNewJobModalOpen}
          shopProfile={shopProfile}
          existingJobs={jobs}
          khataCustomers={khataCustomers}
          initialCustomer={newJobInitialCustomer}
          isConnected={syncStatus === 'connected'}
          isSubmitting={isMutating}
          onClose={() => {
            setIsNewJobModalOpen(false);
            setNewJobInitialCustomer(null);
          }}
          onOpenDriveConnect={() => setIsDriveModalOpen(true)}
          onSubmitNewJob={handleCreateNewJob}
        />

        <WhatsAppModal
          isOpen={Boolean(whatsAppJob || whatsAppKhataCustomer)}
          job={whatsAppJob}
          khataCustomer={whatsAppKhataCustomer}
          shopProfile={shopProfile}
          onClose={() => {
            setWhatsAppJob(null);
            setWhatsAppKhataCustomer(null);
          }}
        />

        <KhataReceivePaymentModal
          isOpen={isReceivePaymentOpen}
          customer={selectedKhataCustomer}
          currencySymbol={currencySymbol}
          isSaving={isMutating}
          onClose={() => {
            if (!isMutating) setIsReceivePaymentOpen(false);
          }}
          onConfirmPayment={handleReceiveKhataPayment}
        />

        <ConfirmActionModal
          isOpen={Boolean(pendingAction && confirmDialogConfig)}
          title={confirmDialogConfig?.title || ''}
          description={confirmDialogConfig?.description || ''}
          confirmLabel={confirmDialogConfig?.confirmLabel || 'Confirm'}
          variant={confirmDialogConfig?.variant || 'primary'}
          isLoading={isMutating}
          onConfirm={executePendingMutation}
          onCancel={() => {
            if (!isMutating) setPendingAction(null);
          }}
        />

        {/* Snackbar / Toast */}
        {toast && (
          <div className="fixed bottom-5 right-5 z-50 max-w-md">
            <div
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-xs font-medium shadow-xl ${
                toast.type === 'success'
                  ? 'border-emerald-300 bg-white text-emerald-800 dark:border-emerald-500/35 dark:bg-[#1E293B] dark:text-emerald-200'
                  : toast.type === 'error'
                    ? 'border-red-300 bg-white text-red-800 dark:border-red-500/35 dark:bg-[#1E293B] dark:text-red-200'
                    : 'border-blue-300 bg-white text-blue-800 dark:border-blue-500/35 dark:bg-[#1E293B] dark:text-blue-200'
              }`}
            >
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  toast.type === 'success'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : toast.type === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-blue-600 dark:text-blue-400'
                }`}
              />
              <span className="leading-relaxed">{toast.message}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="ml-2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Printable Receipt Modal rendered outside .no-print wrapper so @media print isolates it cleanly */}
      <ReceiptPrintModal
        isOpen={Boolean(printJob)}
        job={printJob}
        shopProfile={shopProfile}
        onClose={() => setPrintJob(null)}
      />
    </>
  );
}
