import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { AppText } from '@/src/components/AppText';
import { AppIcon } from '@/src/components/AppIcon';
import { IosScrollView } from '@/src/components/IosScrollView';
import { HapticTap, Haptics } from '@/src/utils/haptics';
import { SoundFeedback } from '@/src/utils/sounds';
import { useAuth } from '@/src/hooks/useAuth';
import { db } from '@/src/services/firebaseClient';
import { firebaseCollections } from '@/src/constants/collections';
import { buildCardProfileUrl, buildSlugProfileUrl, PUBLIC_PROFILE_HOST } from '@/src/constants/publicProfile';
import { isNfcAvailable, readNfcTag, startNfcManager } from '@/src/services/nfcManagerService';

type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'simulated';

interface TestStepInfo {
  id: 'nfc_detect' | 'profile_open' | 'link_working' | 'card_ready';
  label: string;
  status: StepStatus;
  detail?: string;
  latencyMs?: number;
}

const INITIAL_STEPS: TestStepInfo[] = [
  { id: 'nfc_detect', label: 'NFC detected', status: 'pending' },
  { id: 'profile_open', label: 'Profile opened', status: 'pending' },
  { id: 'link_working', label: 'Link working', status: 'pending' },
  { id: 'card_ready', label: 'Card ready', status: 'pending' },
];

export default function NfcTestScreen() {
  const { user } = useAuth();
  const [steps, setSteps] = useState<TestStepInfo[]>(INITIAL_STEPS);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'partial' | 'error'>('idle');
  const [diagnostics, setDiagnostics] = useState<{
    chipUid?: string;
    profileId?: string;
    profileUrl?: string;
    httpStatus?: number;
    latencyMs?: number;
    telemetryLogged?: boolean;
    nativeNfc?: boolean;
  }>({});

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updateStep = (id: TestStepInfo['id'], updates: Partial<TestStepInfo>) => {
    if (!isMountedRef.current) return;
    setSteps((prev) =>
      prev.map((step) => (step.id === id ? { ...step, ...updates } : step))
    );
  };

  const runRealNfcTest = useCallback(async () => {
    setIsRunning(true);
    setTestResult('idle');
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: 'pending', detail: undefined })));
    setDiagnostics({});

    let detectedChipUid = '';
    let targetProfileUrl = '';
    let targetProfileId = user?.id || 'guest';
    let isNativeNfc = false;

    // ==========================================
    // STAGE 1: NFC Hardware / Tag Read (real)
    // ==========================================
    updateStep('nfc_detect', { status: 'running', detail: 'Checking NFC support...' });
    try {
      const available = await isNfcAvailable().catch(() => false);
      if (!available || Platform.OS === 'web') {
        updateStep('nfc_detect', {
          status: 'simulated',
          detail: 'No NFC hardware here (browser/emulator) — profile link still checked',
        });
      } else {
        isNativeNfc = true;
        await startNfcManager().catch(() => {});
        updateStep('nfc_detect', { detail: 'Hardware ready · Tap an NFC card now...' });

        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
        const tag = (await Promise.race([readNfcTag().catch(() => null), timeoutPromise])) as any;
        const uid: string | undefined = tag?.id ?? tag?.uid ?? tag?.tagId;
        if (uid) {
          detectedChipUid = uid;
          await SoundFeedback.playNfcTap().catch(() => {});
          Haptics.success();
          updateStep('nfc_detect', { status: 'passed', detail: `Tag UID: ${detectedChipUid}` });
        } else {
          updateStep('nfc_detect', {
            status: 'failed',
            detail: 'No tag detected within 5s — hold a card against the phone',
          });
        }
      }
    } catch (err) {
      console.warn('[NfcTest] NFC stage failed', err);
      updateStep('nfc_detect', { status: 'failed', detail: 'NFC check failed on this device' });
    }

    setDiagnostics((d) => ({ ...d, chipUid: detectedChipUid || undefined, nativeNfc: isNativeNfc }));

    // ==========================================
    // STAGE 2: Profile Verification (Firestore, real)
    // ==========================================
    updateStep('profile_open', { status: 'running', detail: 'Looking up your profile...' });

    let profileOk = false;
    try {
      const resolvedName = user?.displayName?.trim() || 'You';
      let resolvedSlug: string | null = null;

      if (user?.id) {
        try {
          const profileDoc = await getDoc(doc(db, firebaseCollections.bioPages, user.id));
          if (profileDoc.exists()) {
            const data = profileDoc.data();
            resolvedSlug = data?.slug || data?.publicSlug || null;
            targetProfileId = profileDoc.id;
          } else {
            const cardDoc = await getDoc(doc(db, firebaseCollections.cards, user.id));
            if (cardDoc.exists()) {
              const cdata = cardDoc.data();
              resolvedSlug = cdata?.publicSlug || null;
              targetProfileId = cardDoc.id;
            }
          }
        } catch (err) {
          console.warn('[NfcTest] Profile lookup failed', err);
        }
      }

      if (resolvedSlug) {
        profileOk = true;
        targetProfileUrl = buildSlugProfileUrl(resolvedSlug);
        updateStep('profile_open', {
          status: 'passed',
          detail: `${resolvedName} (@${resolvedSlug})`,
        });
        setDiagnostics((d) => ({ ...d, profileId: targetProfileId, profileUrl: targetProfileUrl }));
      } else {
        updateStep('profile_open', {
          status: 'failed',
          detail: 'No published profile found — create your profile first',
        });
      }
    } catch (err) {
      console.warn('[NfcTest] Profile stage failed', err);
      updateStep('profile_open', { status: 'failed', detail: 'Profile lookup failed' });
    }

    // ==========================================
    // STAGE 3: Public Profile Host Reachability (real)
    // ==========================================
    updateStep('link_working', { status: 'running', detail: `Pinging ${PUBLIC_PROFILE_HOST}...` });
    const startTime = Date.now();
    let latency = 0;
    let linkOk = false;
    let httpStatus: number | undefined;

    try {
      const res = await fetch(PUBLIC_PROFILE_HOST, { method: 'HEAD', cache: 'no-cache' }).catch(() => null);
      latency = Date.now() - startTime;
      if (res) {
        httpStatus = res.status;
        linkOk = res.status < 500;
        updateStep('link_working', {
          status: linkOk ? 'passed' : 'failed',
          detail: `HTTP ${res.status} · ${latency}ms`,
          latencyMs: latency,
        });
      } else {
        updateStep('link_working', {
          status: 'failed',
          detail: `Could not reach ${PUBLIC_PROFILE_HOST} — check your connection`,
          latencyMs: latency,
        });
      }
      setDiagnostics((d) => ({ ...d, httpStatus, latencyMs: latency }));
    } catch (err) {
      latency = Date.now() - startTime;
      console.warn('[NfcTest] Link check failed', err);
      updateStep('link_working', { status: 'failed', detail: 'Link check failed', latencyMs: latency });
      setDiagnostics((d) => ({ ...d, latencyMs: latency }));
    }

    // ==========================================
    // STAGE 4: Test Telemetry + Verdict
    // ==========================================
    updateStep('card_ready', { status: 'running', detail: 'Logging this test run...' });

    try {
      if (user?.id) {
        try {
          await addDoc(collection(db, firebaseCollections.tapEvents), {
            userId: user.id,
            cardId: targetProfileId,
            ...(detectedChipUid ? { chipUID: detectedChipUid } : {}),
            source: 'nfc_test_runner',
            platform: Platform.OS,
            timestamp: serverTimestamp(),
            clientTimestamp: new Date().toISOString(),
            status: 'test',
            latencyMs: latency,
          });
          setDiagnostics((d) => ({ ...d, telemetryLogged: true }));
        } catch {
          setDiagnostics((d) => ({ ...d, telemetryLogged: false }));
        }
      }

      const nfcDetail = detectedChipUid ? 'Tag read OK' : 'No tag read this run';
      updateStep('card_ready', {
        status: profileOk && linkOk ? 'passed' : 'failed',
        detail: profileOk && linkOk ? `Ready to tap · ${nfcDetail}` : 'Not ready — fix the failing steps above',
      });
      setTestResult(profileOk && linkOk ? 'success' : 'partial');
    } catch (err) {
      console.warn('[NfcTest] Telemetry stage failed', err);
      setTestResult(profileOk && linkOk ? 'success' : 'partial');
    } finally {
      setIsRunning(false);
    }
  }, [user]);

  // Run automatically on first mount
  useEffect(() => {
    void runRealNfcTest();
  }, [runRealNfcTest]);

  const handleDone = useCallback(() => {
    HapticTap.light();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)' as never);
    }
  }, []);

  const allPassed = testResult === 'success';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top Header */}
      <View style={styles.header}>
        <Pressable onPress={handleDone} hitSlop={14} style={styles.backBtn}>
          <AppIcon name="ChevronLeft" size={24} color="#F5F5F7" />
        </Pressable>
        <AppText style={styles.headerTitle} weight="bold">NFC Hardware & Profile Test</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <IosScrollView contentContainerStyle={styles.scroll}>
        {/* Real Test Status Card */}
        <View style={styles.stepsCard}>
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            const isPassed = step.status === 'passed' || step.status === 'simulated';
            const isStepRunning = step.status === 'running';

            return (
              <View
                key={step.id}
                style={[
                  styles.stepRow,
                  !isLast && styles.stepBorder,
                  { opacity: step.status === 'pending' ? 0.35 : 1 },
                ]}
              >
                {/* Status Indicator Icon */}
                <View
                  style={[
                    styles.checkCircle,
                    isPassed && styles.checkCirclePassed,
                    isStepRunning && styles.checkCircleRunning,
                  ]}
                >
                  {isStepRunning ? (
                    <ActivityIndicator size="small" color="#799A85" />
                  ) : (
                    <AppIcon
                      name={isPassed ? 'Check' : 'Clock'}
                      size={16}
                      color={isPassed ? '#30D158' : '#71717A'}
                    />
                  )}
                </View>

                {/* Step Details Column */}
                <View style={styles.stepInfoCol}>
                  <AppText
                    style={[styles.stepLabel, isPassed && styles.stepLabelPassed]}
                    weight="semibold"
                  >
                    {step.label}
                  </AppText>
                  {step.detail ? (
                    <AppText style={styles.stepDetail} numberOfLines={1}>
                      {step.detail}
                    </AppText>
                  ) : null}
                </View>

                {/* Live Latency Badge */}
                {step.latencyMs ? (
                  <View style={styles.latencyBadge}>
                    <AppText style={styles.latencyText}>{step.latencyMs}ms</AppText>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        {/* Diagnostics Inspection Panel */}
        {diagnostics.chipUid && (
          <View style={styles.diagnosticsCard}>
            <View style={styles.diagHeader}>
              <AppIcon name="Cpu" size={14} color="#799A85" />
              <AppText style={styles.diagTitle} weight="bold">DIAGNOSTICS</AppText>
            </View>
            <View style={styles.diagRow}>
              <AppText style={styles.diagKey}>NFC Silicon UID</AppText>
              <AppText style={styles.diagVal} weight="medium">{diagnostics.chipUid}</AppText>
            </View>
            <View style={styles.diagRow}>
              <AppText style={styles.diagKey}>Target Gateway</AppText>
              <AppText style={styles.diagVal} numberOfLines={1}>{PUBLIC_PROFILE_HOST}</AppText>
            </View>
            <View style={styles.diagRow}>
              <AppText style={styles.diagKey}>Telemetry Sync</AppText>
              <AppText style={styles.diagValSage} weight="semibold">
                {diagnostics.telemetryLogged === true ? 'Test run logged' : diagnostics.telemetryLogged === false ? 'Not logged (offline or denied)' : '—'}
              </AppText>
            </View>
          </View>
        )}

        {/* All Done Badge */}
        {allPassed && (
          <View style={styles.badge}>
            <AppIcon name="BadgeCheck" size={20} color="#30D158" />
            <View style={{ gap: 2 }}>
              <AppText style={styles.badgeText} weight="bold">Profile link verified</AppText>
              <AppText style={styles.badgeSub}>Your public card link is reachable and ready to share.</AppText>
            </View>
          </View>
        )}

        {/* Action Controls */}
        <View style={styles.actionsContainer}>
          <Pressable
            style={({ pressed }) => [
              styles.doneBtn,
              isRunning && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}
            onPress={handleDone}
            disabled={isRunning}
          >
            <AppText style={styles.doneBtnText} weight="bold">Done</AppText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.retestBtn,
              isRunning && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}
            onPress={runRealNfcTest}
            disabled={isRunning}
          >
            {isRunning ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <AppText style={styles.retestBtnText} weight="medium">Test Again</AppText>
            )}
          </Pressable>
        </View>
      </IosScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#000000',
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSpacer: {
    width: 44,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 24,
    gap: 16,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  stepsCard: {
    backgroundColor: '#111114',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 18,
    overflow: 'hidden',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
  },
  stepBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  checkCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#18181C',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  checkCirclePassed: {
    backgroundColor: 'rgba(48, 209, 88, 0.12)',
    borderColor: 'rgba(48, 209, 88, 0.35)',
  },
  checkCircleRunning: {
    backgroundColor: 'rgba(121, 154, 133, 0.15)',
    borderColor: 'rgba(121, 154, 133, 0.4)',
  },
  stepInfoCol: {
    flex: 1,
    gap: 3,
  },
  stepLabel: {
    fontSize: 16,
    color: '#A1A1AA',
    letterSpacing: -0.2,
  },
  stepLabelPassed: {
    color: '#FFFFFF',
  },
  stepDetail: {
    fontSize: 13,
    color: '#71717A',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  latencyBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  latencyText: {
    fontSize: 11,
    color: '#799A85',
    fontWeight: '600',
  },
  diagnosticsCard: {
    backgroundColor: '#111114',
    borderWidth: 1,
    borderColor: 'rgba(121, 154, 133, 0.25)',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  diagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  diagTitle: {
    fontSize: 11,
    letterSpacing: 0.8,
    color: '#799A85',
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  diagKey: {
    fontSize: 13,
    color: '#71717A',
  },
  diagVal: {
    fontSize: 13,
    color: '#F4F4F5',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  diagValSage: {
    fontSize: 13,
    color: '#799A85',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(48, 209, 88, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.25)',
    borderRadius: 14,
  },
  badgeText: {
    fontSize: 14,
    color: '#30D158',
  },
  badgeSub: {
    fontSize: 12,
    color: '#A1A1AA',
    marginTop: 2,
  },
  actionsContainer: {
    gap: 12,
    marginTop: 10,
  },
  doneBtn: {
    height: 52,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    fontSize: 16,
    color: '#000000',
  },
  retestBtn: {
    height: 50,
    backgroundColor: '#18181C',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retestBtnText: {
    fontSize: 15,
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  btnPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
});
