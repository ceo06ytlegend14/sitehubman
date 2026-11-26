import { SeoHead } from '@/src/components/SeoHead';
import { lazy, Suspense } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '@/src/hooks/useAuth';

const GuestConnectionsScreen = lazy(() =>
  import('@/src/features/guest/GuestConnectionsScreen').then((m) => ({
    default: m.GuestConnectionsScreen,
  }))
);
const RealConnectionsScreen = lazy(() =>
  import('@/src/features/customer/ConnectionsMomentsScreen').then((m) => ({
    default: m.ConnectionsMomentsScreen,
  }))
);

function TabFallback() {
  return (
    <View style={styles.fallback}>
      <ActivityIndicator color="#FFFFFF" />
    </View>
  );
}

export default function ConnectionsTabRoute() {
  const { user } = useAuth();
  const isGuestUser = !user || Boolean((user as { isGuest?: boolean }).isGuest) || user.id === 'guest';

  return (
    <>
      <SeoHead title="Connections" description="View and manage your NFC card connections, interaction moments, and contact timeline." noIndex />
      <Suspense fallback={<TabFallback />}>
        {isGuestUser ? <GuestConnectionsScreen /> : <RealConnectionsScreen />}
      </Suspense>
    </>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
});
