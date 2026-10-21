export interface LeadRow {
  address: string;
  status: "interested" | "signed";
  rep: string;
  note: string;
  date: string;
  hailIn: number | null;
}

export const LEAD_HEADER = ["Address", "Status", "Rep", "Note", "Date", "Hail size"] as const;

const LABELS: Record<LeadRow["status"], string> = {
  interested: "Interested",
  signed: "Signed",
};

export function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function leadCsv(leads: LeadRow[], sheets: boolean): string {
  const rows = [
    [...LEAD_HEADER],
    ...leads.map((lead) => [
      lead.address,
      LABELS[lead.status],
      lead.rep,
      lead.note,
      lead.date,
      lead.hailIn == null ? "" : lead.hailIn.toFixed(2),
    ]),
  ];
  const body = rows.map((row) => row.map(csvCell).join(",")).join(sheets ? "\r\n" : "\n");
  return sheets ? `\uFEFF${body}\r\n` : `${body}\n`;
}

export function sheetsCreateUrl(): string {
  return "https://docs.google.com/spreadsheets/create";
}
