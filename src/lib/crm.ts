import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { listPins } from "@/lib/accounts";
import { getDb } from "@/lib/db";

export const CRM_PROVIDERS = ["webhook", "jobnimbus", "acculynx"] as const;
export type CrmProvider = (typeof CRM_PROVIDERS)[number];

export interface LeadAddress {
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface OutboundLead {
  id: string;
  status: "lead";
  note: string | null;
  lat: number;
  lon: number;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface CrmPublic {
  provider: CrmProvider | null;
  configured: boolean;
  recordType: string;
  statusName: string;
}

interface StoredCrm {
  provider: CrmProvider;
  secret: string;
  recordType: string;
  statusName: string;
}

const DEFAULT_RECORD = "Customer";
const DEFAULT_STATUS = "Lead";
const JOBNIMBUS_CONTACTS = "https://app.jobnimbus.com/api1/contacts";
const ACCULYNX_CONTACTS = "https://api.acculynx.com/api/v2/contacts";
const ACCULYNX_JOBS = "https://api.acculynx.com/api/v2/jobs";

export const crmNetwork = {
  fetch: globalThis.fetch.bind(globalThis) as typeof fetch,
  resolve: async (host: string): Promise<string[]> => {
    const records = await lookup(host, { all: true, verbatim: true });
    return records.map((record) => record.address);
  },
};

export function asCrmProvider(value: unknown): CrmProvider | null {
  return CRM_PROVIDERS.find((provider) => provider === value) ?? null;
}

/** True for loopback, private, link-local, multicast, and metadata addresses. */
export function isBlockedAddress(address: string): boolean {
  const raw = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ip = mapped ? mapped[1] : raw;
  if (ip === "::1" || ip === "::" || ip === "0.0.0.0") return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) {
    return true;
  }
  if (!ip.includes(".")) return ip.includes(":");
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a === 255 || a >= 224) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export async function webhookTarget(raw: string): Promise<{ url: string } | { error: string }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: "Paste a full https link." };
  }
  if (url.protocol !== "https:") return { error: "The link has to start with https." };
  if (url.username || url.password) return { error: "Paste the link without a username or password in it." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal") {
    return { error: "That link is not a public address." };
  }
  const addresses = isIP(host) ? [host] : await crmNetwork.resolve(host).catch(() => null);
  if (!addresses?.length || addresses.some((address) => isBlockedAddress(address))) {
    return { error: "That link is not a public address." };
  }
  return { url: url.toString() };
}

function scrub(text: string, secret: string): string {
  const hidden = secret ? text.split(secret).join("") : text;
  const cleaned = hidden.replace(/\s+/g, " ").trim().slice(0, 180);
  return cleaned || "The service refused the request.";
}

export function publicCrm(): CrmPublic {
  const stored = readCrm();
  return {
    provider: stored?.provider ?? null,
    configured: Boolean(stored),
    recordType: stored?.recordType || DEFAULT_RECORD,
    statusName: stored?.statusName || DEFAULT_STATUS,
  };
}

function readCrm(): StoredCrm | null {
  const row = getDb()
    .prepare(
      `SELECT provider, secret, record_type AS recordType, status_name AS statusName
       FROM crm_settings WHERE id = 1`,
    )
    .get() as StoredCrm | undefined;
  if (!row || !asCrmProvider(row.provider) || !row.secret) return null;
  return { ...row, provider: row.provider };
}

export async function saveCrm(input: {
  provider: CrmProvider;
  secret?: string | null;
  recordType?: string | null;
  statusName?: string | null;
}): Promise<{ ok: true; settings: CrmPublic } | { ok: false; error: string }> {
  const current = readCrm();
  const secret = input.secret?.trim() || (current?.provider === input.provider ? current.secret : "");
  if (!secret) return { ok: false, error: "Paste the link or API key first." };
  const recordType = clipLabel(input.recordType, current?.recordType || DEFAULT_RECORD);
  const statusName = clipLabel(input.statusName, current?.statusName || DEFAULT_STATUS);
  if (input.provider === "webhook") {
    const target = await webhookTarget(secret);
    if ("error" in target) return { ok: false, error: target.error };
    writeCrm({ provider: "webhook", secret: target.url, recordType, statusName });
    return { ok: true, settings: publicCrm() };
  }
  if (secret.length < 8 || /\s/.test(secret) || secret.includes("://")) {
    return { ok: false, error: "That does not look like an API key." };
  }
  writeCrm({ provider: input.provider, secret, recordType, statusName });
  return { ok: true, settings: publicCrm() };
}

function clipLabel(value: string | null | undefined, fallback: string): string {
  const text = value?.trim();
  if (!text) return fallback;
  return text.slice(0, 80);
}

function writeCrm(row: StoredCrm) {
  getDb()
    .prepare(
      `INSERT INTO crm_settings (id, provider, secret, record_type, status_name, updated_at)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         provider = excluded.provider,
         secret = excluded.secret,
         record_type = excluded.record_type,
         status_name = excluded.status_name,
         updated_at = excluded.updated_at`,
    )
    .run(row.provider, row.secret, row.recordType, row.statusName, new Date().toISOString());
}

function text(value: unknown, max = 80): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Street, city, state, and ZIP from a Nominatim reverse payload. Missing pieces stay empty. */
export function addressFromNominatim(payload: unknown): LeadAddress {
  const empty: LeadAddress = { street: null, city: null, state: null, postalCode: null, country: null };
  if (!payload || typeof payload !== "object") return empty;
  const address = (payload as { address?: Record<string, unknown> }).address;
  if (!address) return empty;
  const house = text(address.house_number, 20);
  const road = text(address.road, 80) ?? text(address.pedestrian, 80);
  const street = house && road ? `${house} ${road}` : road;
  const city = text(address.city, 50) ?? text(address.town, 50) ?? text(address.village, 50);
  const state = text(address.state, 50);
  const postalCode = text(address.postcode, 20);
  const countryCode = text(address.country_code, 8)?.toLowerCase();
  const country = countryCode === "us" || text(address.country, 40) === "United States" ? "USA" : null;
  return { street, city, state, postalCode, country };
}

export function acculynxReady(address: Pick<LeadAddress, "street" | "city" | "state" | "postalCode" | "country">): boolean {
  return Boolean(address.street && address.city && address.state && address.postalCode && address.country);
}

export function zapierBody(leads: OutboundLead[], sentAt: string, event: "leads.sent" | "leads.test") {
  return {
    source: "swathline",
    event,
    sentAt,
    leads: leads.map((lead) => ({
      id: lead.id,
      status: lead.status,
      note: lead.note,
      lat: lead.lat,
      lon: lead.lon,
      street: lead.street,
      city: lead.city,
      state: lead.state,
      postalCode: lead.postalCode,
      country: lead.country,
    })),
  };
}

export function jobNimbusContact(lead: OutboundLead, recordType: string, statusName: string) {
  const body: Record<string, unknown> = {
    display_name: lead.note?.trim() || "Swathline lead",
    record_type_name: recordType,
    status_name: statusName,
    description: describeLead(lead),
    geo: { lat: lead.lat, lon: lead.lon },
  };
  if (lead.street) body.address_line1 = lead.street;
  if (lead.city) body.city = lead.city;
  if (lead.state) body.state_text = lead.state;
  if (lead.postalCode) body.zip = lead.postalCode;
  return body;
}

export function acculynxContact(lead: OutboundLead) {
  return {
    companyName: lead.note?.trim() || "Swathline lead",
    note: describeLead(lead),
  };
}

export function acculynxJob(lead: OutboundLead, contactId: string) {
  return {
    contact: { id: contactId },
    locationAddress: {
      street1: lead.street,
      city: lead.city,
      state: lead.state,
      country: "USA",
      zipCode: lead.postalCode,
    },
    notes: (lead.note?.trim() || "Swathline lead").slice(0, 1000),
  };
}

function describeLead(lead: OutboundLead): string {
  const where = [lead.street, lead.city, lead.state, lead.postalCode].filter(Boolean).join(", ");
  return `Swathline lead ${lead.id} at ${lead.lat.toFixed(5)}, ${lead.lon.toFixed(5)}${where ? `. ${where}` : ""}`.slice(0, 1000);
}

async function reverseAddress(lat: number, lon: number): Promise<LeadAddress> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", lat.toFixed(5));
  url.searchParams.set("lon", lon.toFixed(5));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  const response = await crmNetwork.fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": process.env.HAILMAP_USER_AGENT?.trim() || "Swathline/1.0 (https://github.com/diamondstatepdr/hailmap)",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return addressFromNominatim(null);
  return addressFromNominatim(await response.json());
}

function toOutbound(pin: { id: string; lat: number; lon: number; note: string | null }, address: LeadAddress): OutboundLead {
  return {
    id: pin.id,
    status: "lead",
    note: pin.note,
    lat: pin.lat,
    lon: pin.lon,
    street: address.street,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
  };
}

async function postJson(url: string, secret: string, body: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await crmNetwork.fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (response.status >= 300 && response.status < 400) return { ok: false, error: "The service redirected the request." };
  if (!response.ok) {
    const detail = scrub(await response.text().catch(() => ""), secret);
    return { ok: false, error: detail === "The service refused the request." ? `The service returned ${response.status}.` : detail };
  }
  return { ok: true };
}

export async function testCrm(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const stored = readCrm();
  if (!stored) return { ok: false, error: "Save a webhook link or API key first." };
  if (stored.provider === "webhook") {
    const sent = await postWebhook(stored.secret, zapierBody([], new Date().toISOString(), "leads.test"));
    if (!sent.ok) return { ok: false, error: sent.error };
    return { ok: true, message: "The webhook accepted the test. No leads were included." };
  }
  if (stored.provider === "jobnimbus") {
    const response = await crmNetwork.fetch(`${JOBNIMBUS_CONTACTS}?size=1`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${stored.secret}` },
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 401 || response.status === 403) return { ok: false, error: "JobNimbus refused that key." };
    if (!response.ok) return { ok: false, error: `JobNimbus returned ${response.status}.` };
    return { ok: true, message: "Connected to JobNimbus." };
  }
  const response = await crmNetwork.fetch(`${ACCULYNX_JOBS}?pageSize=1&pageStartIndex=0`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${stored.secret}` },
    redirect: "manual",
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 401 || response.status === 403) return { ok: false, error: "AccuLynx refused that key." };
  if (!response.ok) return { ok: false, error: `AccuLynx returned ${response.status}.` };
  return { ok: true, message: "Connected to AccuLynx." };
}

async function postWebhook(url: string, body: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await crmNetwork.fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (response.status >= 300 && response.status < 400) {
    return { ok: false, error: "The webhook redirected. Paste the final https link." };
  }
  if (!response.ok) return { ok: false, error: `The webhook returned ${response.status}.` };
  return { ok: true };
}

export async function sendLeads(userId: string): Promise<
  { ok: true; sent: number; skipped: number; message: string } | { ok: false; error: string; sent?: number }
> {
  const stored = readCrm();
  if (!stored) return { ok: false, error: "Save a webhook link or API key first." };
  const pins = listPins(userId).filter((pin) => pin.status === "lead");
  if (!pins.length) {
    return { ok: true, sent: 0, skipped: 0, message: "No leads yet. Mark a house as Lead, then try again." };
  }
  const leads: OutboundLead[] = [];
  for (const pin of pins) {
    const address = await reverseAddress(pin.lat, pin.lon).catch(() => addressFromNominatim(null));
    leads.push(toOutbound(pin, address));
  }
  if (stored.provider === "webhook") {
    const sent = await postWebhook(stored.secret, zapierBody(leads, new Date().toISOString(), "leads.sent"));
    if (!sent.ok) return sent;
    return { ok: true, sent: leads.length, skipped: 0, message: sentCount(leads.length) };
  }
  if (stored.provider === "jobnimbus") {
    let sent = 0;
    for (const lead of leads) {
      const result = await postJson(JOBNIMBUS_CONTACTS, stored.secret, jobNimbusContact(lead, stored.recordType, stored.statusName));
      if (!result.ok) {
        return { ok: false, error: sent ? `Sent ${sent}. JobNimbus then refused a lead. ${result.error}` : result.error, sent };
      }
      sent += 1;
    }
    return { ok: true, sent, skipped: 0, message: sentCount(sent) };
  }
  let sent = 0;
  let skipped = 0;
  for (const lead of leads) {
    if (!acculynxReady(lead)) {
      skipped += 1;
      continue;
    }
    const contact = await crmNetwork.fetch(ACCULYNX_CONTACTS, {
      method: "POST",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${stored.secret}`,
      },
      body: JSON.stringify(acculynxContact(lead)),
      signal: AbortSignal.timeout(12000),
    });
    if (!contact.ok) {
      const detail = scrub(await contact.text().catch(() => ""), stored.secret);
      return { ok: false, error: sent ? `Sent ${sent}. AccuLynx then refused a lead. ${detail}` : detail, sent };
    }
    const created = (await contact.json().catch(() => null)) as { id?: unknown; contactId?: unknown } | null;
    const contactId = typeof created?.id === "string" ? created.id : typeof created?.contactId === "string" ? created.contactId : null;
    if (!contactId) return { ok: false, error: "AccuLynx did not return a contact id.", sent };
    const job = await postJson(ACCULYNX_JOBS, stored.secret, acculynxJob(lead, contactId));
    if (!job.ok) return { ok: false, error: sent ? `Sent ${sent}. ${job.error}` : job.error, sent };
    sent += 1;
  }
  if (!sent) {
    return { ok: false, error: "AccuLynx needs a street, city, state, and ZIP. None of these leads have a full address." };
  }
  const message = skipped
    ? `${sentCount(sent)} ${skipped} ${skipped === 1 ? "lead has" : "leads have"} no street address, so AccuLynx did not take ${skipped === 1 ? "it" : "them"}.`
    : sentCount(sent);
  return { ok: true, sent, skipped, message };
}

function sentCount(sent: number): string {
  return sent === 1 ? "Sent 1 lead." : `Sent ${sent} leads.`;
}
