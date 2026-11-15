import { startAuthentication, startRegistration, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { post, ApiError } from '../api';
import i18n from '../i18n';

const wrap = async <T,>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'passkey_cancelled', String((e as Error)?.message ?? e));
  }
};

export async function signInWithPasskey() {
  const o = await post<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>('/api/auth/login/options');
  const response = await wrap(() => startAuthentication({ optionsJSON: o.options }));
  await post('/api/auth/login/verify', { challengeId: o.challengeId, response });
}

export async function registerWithToken(token: string, displayName: string | undefined, householdName?: string) {
  const locale = i18n.language === 'he' ? 'he' : 'en';
  const o = await post<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>('/api/auth/register/options', { token, displayName, locale });
  const response = await wrap(() => startRegistration({ optionsJSON: o.options }));
  return post<{ kind: string }>('/api/auth/register/verify', { token, challengeId: o.challengeId, response, locale, ...(householdName ? { householdName } : {}) });
}

export async function addPasskey(deviceLabel?: string) {
  const o = await post<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>('/api/auth/passkeys/options');
  const response = await wrap(() => startRegistration({ optionsJSON: o.options }));
  await post('/api/auth/passkeys', { challengeId: o.challengeId, response, ...(deviceLabel ? { deviceLabel } : {}) });
}

/** Token from the URL fragment (never sent to the server in the URL). */
export const fragmentToken = () => decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
