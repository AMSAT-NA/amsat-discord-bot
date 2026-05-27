import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WildApricotContact {
  Id: number;
  Email: string;
  FirstName: string;
  LastName: string;
  DisplayName: string;
  MembershipLevel: {
    Id: number;
    Name: string;
    Url: string;
  } | null;
  /** Active | Lapsed | PendingRenewal | PendingNew | Suspended */
  Status: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  Permissions: Array<{ AccountId: number; SecurityProfileId: number }>;
}

interface ContactsListResponse {
  Contacts: WildApricotContact[];
  Count: number;
}

// ─── Session cache ─────────────────────────────────────────────────────────────
// Stores both the access token and the account ID together — the account ID is
// returned in the token response, so there's no need to configure it separately.

interface Session {
  token: string;
  accountId: number;
  expiresAt: number;
}

let sessionCache: Session | null = null;

async function getSession(): Promise<Session> {
  if (sessionCache && Date.now() < sessionCache.expiresAt) {
    return sessionCache;
  }

  logger.debug('Refreshing WildApricot session');

  // WildApricot uses HTTP Basic auth with the literal string "APIKEY" as the username
  const credentials = Buffer.from(`APIKEY:${config.WILDAPRICOT_API_KEY}`).toString('base64');

  const { data } = await axios.post<TokenResponse>(
    'https://oauth.wildapricot.org/auth/token',
    'grant_type=client_credentials&scope=auto',
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );

  sessionCache = {
    token: data.access_token,
    accountId: data.Permissions[0]!.AccountId,
    // Subtract a 60 s buffer so we refresh before actual expiry
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  logger.debug('WildApricot session refreshed', { accountId: sessionCache.accountId });

  return sessionCache;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/** Look up a contact by email. Returns null if not found. */
export async function lookupContactByEmail(email: string): Promise<WildApricotContact | null> {
  const { token, accountId } = await getSession();

  const { data } = await axios.get<ContactsListResponse>(
    `https://api.wildapricot.org/v2.2/Accounts/${accountId}/Contacts`,
    {
      params: {
        $filter: `Email eq '${email}'`,
        $select: 'Id,Email,FirstName,LastName,DisplayName,MembershipLevel,Status',
        $async: false,
      },
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );

  if (!data.Contacts || data.Contacts.length === 0) {
    return null;
  }

  return data.Contacts[0]!;
}

/** Fetch a contact by their WildApricot contact ID. Returns null if not found. */
export async function lookupContactById(contactId: number): Promise<WildApricotContact | null> {
  const { token, accountId } = await getSession();

  try {
    const { data } = await axios.get<WildApricotContact>(
      `https://api.wildapricot.org/v2.2/Accounts/${accountId}/Contacts/${contactId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    );
    return data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Search contacts by callsign using WildApricot's free-text simpleQuery.
 * This mirrors the behaviour of the original admin !verify command.
 *
 * Returns all matching contacts (callsigns aren't guaranteed unique in WA,
 * so we surface all matches and let the admin decide).
 */
export async function lookupContactsByCallsign(callsign: string): Promise<WildApricotContact[]> {
  const { token, accountId } = await getSession();

  const { data } = await axios.get<ContactsListResponse>(
    `https://api.wildapricot.org/v2.2/Accounts/${accountId}/Contacts`,
    {
      params: {
        $async: false,
        simpleQuery: callsign.toUpperCase(),
        $select: 'Id,Email,FirstName,LastName,DisplayName,MembershipLevel,Status',
      },
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );

  return data.Contacts ?? [];
}

/**
 * Returns true for statuses that should receive a full membership role.
 * PendingRenewal members are still considered active (grace period).
 */
export function isActiveMember(contact: WildApricotContact): boolean {
  return contact.Status === 'Active' || contact.Status === 'PendingRenewal';
}
