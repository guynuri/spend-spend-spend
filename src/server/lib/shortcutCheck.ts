/**
 * A shared shortcut must not carry anyone's capture key (D-R30): iCloud links are public, so a key inside
 * would let anyone with the link add purchases. Reads the shortcut through iCloud's public record API and
 * looks for an `mz_` key in the file. Best effort: if iCloud can't be reached, the link is accepted (the
 * Settings card still tells people to use an Import Question).
 */
const KEY = /mz_[A-Za-z0-9_-]{20,}/;

export async function shortcutHasKey(link: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  return (await checkShortcut(link, fetchImpl)) === 'key';
}

/**
 * The same check, telling "couldn't read it" apart (D-R34): the app-wide link reaches every household,
 * so it must be verified, not accepted on a timeout.
 */
export async function checkShortcut(link: string, fetchImpl: typeof fetch = fetch): Promise<'key' | 'ok' | 'unverified'> {
  const id = /\/shortcuts\/([0-9a-f]{32})/.exec(link)?.[1];
  if (!id) return 'unverified';
  try {
    const rec = await fetchImpl(`https://www.icloud.com/shortcuts/api/records/${id}`, { signal: AbortSignal.timeout(5000) });
    if (!rec.ok) return 'unverified';
    const j = (await rec.json()) as { fields?: { shortcut?: { value?: { downloadURL?: string } } } };
    const url = j.fields?.shortcut?.value?.downloadURL?.replace('${f}', 'shortcut.plist');
    if (!url || !/^https:\/\/[a-z0-9.-]+\.icloud-content\.com\//.test(url)) return 'unverified';
    const file = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!file.ok) return 'unverified';
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 2_000_000) return 'unverified';
    // keys are ASCII; a binary plist stores ASCII strings as-is (UTF-16 strings would hide one, so check both)
    const latin = new TextDecoder('latin1').decode(bytes);
    const utf16 = new TextDecoder('utf-16be').decode(bytes.length % 2 ? bytes.subarray(1) : bytes);
    return KEY.test(latin) || KEY.test(utf16) || KEY.test(new TextDecoder('utf-16be').decode(bytes.length % 2 ? bytes : bytes.subarray(1))) ? 'key' : 'ok';
  } catch {
    return 'unverified';
  }
}
