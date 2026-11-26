/**
 * Unit Tests - NFC Encryption Service
 * Covers: signed URL generation, verification, tamper detection, UID hashing.
 * Note: requires jest + a test environment with expo-crypto available.
 */

// firebaseClient initialises the real Firebase app — replace with a stub.
jest.mock('@/src/services/firebaseClient', () => ({ db: {} }));
// expo-crypto has no JS implementation for digestStringAsync; use node crypto.
jest.mock('expo-crypto', () => {
  const nodeCrypto = require('crypto');
  return {
    digestStringAsync: jest.fn(async (_algo: string, input: string) =>
      nodeCrypto.createHash('sha256').update(input).digest('hex')
    ),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  };
});

import {
  encryptNfcUrl,
  verifyNfcUrl,
  generateNfcUidHash,
  detectSuspiciousTapPattern,
} from '../nfcEncryptionService';
import { PUBLIC_PROFILE_HOST } from '@/src/constants/publicProfile';

function decodePayload(url: string) {
  const s = new URL(url).searchParams.get('s');
  expect(s).toBeTruthy();
  return JSON.parse(atob(s as string));
}

describe('NFC Encryption Service', () => {
  const mockCardId = 'card_test_123';

  describe('encryptNfcUrl', () => {
    it('generates a signed URL on the public profile host', async () => {
      const url = await encryptNfcUrl(mockCardId);
      const base = (process.env.EXPO_PUBLIC_APP_URL || PUBLIC_PROFILE_HOST).replace(/\/+$/, '');
      expect(url.startsWith(`${base}/c/${mockCardId}?s=`)).toBe(true);
    });

    it('embeds a payload with cardId, signature, timestamp, expiresAt', async () => {
      const payload = decodePayload(await encryptNfcUrl(mockCardId));
      expect(payload.cardId).toBe(mockCardId);
      expect(typeof payload.signature).toBe('string');
      expect(payload.signature.length).toBeGreaterThan(0);
      expect(payload.expiresAt).toBeGreaterThan(Date.now());
      expect(payload.version).toBe('v1');
    });

    it('generates different signatures for different cards', async () => {
      const p1 = decodePayload(await encryptNfcUrl('card_1'));
      const p2 = decodePayload(await encryptNfcUrl('card_2'));
      expect(p1.signature).not.toBe(p2.signature);
    });

    it('sets expiry about 365 days in the future', async () => {
      const payload = decodePayload(await encryptNfcUrl(mockCardId));
      const oneYearMs = 365 * 24 * 60 * 60 * 1000;
      expect(payload.expiresAt).toBeLessThanOrEqual(Date.now() + oneYearMs + 5000);
      expect(payload.expiresAt).toBeGreaterThan(Date.now() + oneYearMs - 60000);
    });
  });

  describe('verifyNfcUrl', () => {
    it('accepts a URL produced by encryptNfcUrl', async () => {
      const url = await encryptNfcUrl(mockCardId);
      await expect(verifyNfcUrl(url)).resolves.toBe(mockCardId);
    });

    it('rejects a tampered card id', async () => {
      const url = await encryptNfcUrl(mockCardId);
      const tampered = url.replace(mockCardId, 'card_tampered');
      await expect(verifyNfcUrl(tampered)).resolves.toBeNull();
    });

    it('rejects an expired payload', async () => {
      const expired = {
        cardId: mockCardId,
        signature: 'whatever',
        timestamp: Date.now() - 400 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1000, // already expired
        version: 'v1',
      };
      const url = `${PUBLIC_PROFILE_HOST}/c/${mockCardId}?s=${btoa(JSON.stringify(expired))}`;
      await expect(verifyNfcUrl(url)).resolves.toBeNull();
    });

    it('accepts an unsigned legacy URL (Phase 1 backward compatibility)', async () => {
      await expect(verifyNfcUrl(`${PUBLIC_PROFILE_HOST}/c/${mockCardId}`)).resolves.toBe(mockCardId);
    });

    it('rejects a forged payload', async () => {
      const payload = decodePayload(await encryptNfcUrl(mockCardId));
      payload.signature = 'deadbeef'.repeat(8);
      const forgedUrl = `${PUBLIC_PROFILE_HOST}/c/${mockCardId}?s=${btoa(JSON.stringify(payload))}`;
      await expect(verifyNfcUrl(forgedUrl)).resolves.toBeNull();
    });
  });

  describe('generateNfcUidHash', () => {
    it('is deterministic for the same uid', async () => {
      const a = await generateNfcUidHash('NFC_UID_SAME');
      const b = await generateNfcUidHash('NFC_UID_SAME');
      expect(a).toBe(b);
    });

    it('differs for different uids', async () => {
      const a = await generateNfcUidHash('NFC_UID_ONE');
      const b = await generateNfcUidHash('NFC_UID_TWO');
      expect(a).not.toBe(b);
    });
  });

  describe('detectSuspiciousTapPattern', () => {
    it('flags more taps than the hourly threshold', () => {
      const now = Date.now();
      const taps = Array.from({ length: 101 }, (_, i) => ({ timestamp: now - i * 1000 }));
      const result = detectSuspiciousTapPattern(taps);
      expect(result.isSuspicious).toBe(true);
    });

    it('allows normal activity', () => {
      const now = Date.now();
      const taps = Array.from({ length: 5 }, (_, i) => ({ timestamp: now - i * 60000 }));
      const result = detectSuspiciousTapPattern(taps);
      expect(result.isSuspicious).toBe(false);
    });
  });
});
