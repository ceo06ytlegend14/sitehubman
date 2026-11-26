import React, { useCallback } from 'react';
import {
  Clipboard,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AppText } from '@/src/components/AppText';
import { AppIcon } from '@/src/components/AppIcon';
import { IosScrollView } from '@/src/components/IosScrollView';
import { HapticTap } from '@/src/utils/haptics';
import { useAuth } from '@/src/hooks/useAuth';
import { useBioPage } from '@/src/hooks/useBioPage';
import { buildSlugProfileUrl } from '@/src/constants/publicProfile';

export default function CardSettingsScreen() {
  const { user } = useAuth();
  const { bioPage } = useBioPage(user?.id ?? '');
  const profileUrl = bioPage?.slug ? buildSlugProfileUrl(bioPage.slug) : '';

  const handleBack = useCallback(() => {
    HapticTap.light();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)' as any);
    }
  }, []);

  const handleCopy = useCallback(() => {
    HapticTap.medium();
    if (profileUrl) {
      Clipboard.setString(profileUrl);
    } else {
      router.push('/edit-bio' as never);
    }
  }, [profileUrl]);

  const handleDeleteAccount = useCallback(() => {
    HapticTap.medium();
    router.push('/account/delete-account' as never);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={12} style={styles.backBtn}>
          <AppIcon name="ChevronLeft" size={24} color="#F5F5F7" />
        </Pressable>
        <AppText style={styles.headerTitle}>Card Settings</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <IosScrollView contentContainerStyle={styles.scroll}>
        {/* Profile URL */}
        <View style={styles.section}>
          <AppText style={styles.sectionTitle}>Profile URL</AppText>
          <View style={styles.urlCard}>
            <AppText style={styles.urlText}>
              {profileUrl || 'Create your profile to get your link'}
            </AppText>
            <Pressable
              onPress={handleCopy}
              style={({ pressed }) => [styles.copyBtn, pressed && styles.copyBtnPressed]}
              hitSlop={8}
            >
              <AppIcon name={profileUrl ? 'Copy' : 'Edit2'} size={16} color="#2596BE" />
              <AppText style={styles.copyBtnText}>{profileUrl ? 'Copy' : 'Set up'}</AppText>
            </Pressable>
          </View>
        </View>

        {/* Danger Zone */}
        <View style={styles.section}>
          <AppText style={styles.sectionTitle}>Danger</AppText>
          <Pressable
            onPress={handleDeleteAccount}
            style={({ pressed }) => [styles.dangerRow, pressed && styles.dangerRowPressed]}
          >
            <AppIcon name="Trash2" size={20} color="#FF453A" />
            <AppText style={styles.dangerLabel}>Delete Account…</AppText>
            <AppIcon name="ChevronRight" size={18} color="#FF453A" />
          </Pressable>
        </View>
      </IosScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0D0D0E',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  headerSpacer: {
    width: 36,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 130,
    paddingTop: 8,
  },
  section: {
    marginTop: 28,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 13,
    color: '#9A9AA0',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  urlCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#242424',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  urlText: {
    fontSize: 14,
    color: '#9A9AA0',
    flex: 1,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(37,150,190,0.1)',
    borderRadius: 8,
  },
  copyBtnPressed: {
    opacity: 0.7,
  },
  copyBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2596BE',
  },
  groupedList: {
    backgroundColor: '#242424',
    borderRadius: 14,
    overflow: 'hidden',
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#242424',
    borderColor: 'rgba(255,68,58,0.25)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  dangerRowPressed: {
    opacity: 0.7,
  },
  dangerLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#FF453A',
  },
});
