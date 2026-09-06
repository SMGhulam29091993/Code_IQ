// Minimal CSV export — used by the Reviews List screen's "Export CSV" header CTA
// (.ai/knowledge/screens/dashboard-screens.md "Screen: Reviews List"). No backend endpoint for
// this; the mockup's CTA doesn't specify a server-generated export, and the current page of
// reviews already loaded client-side is enough to export without one.
export function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]!);
  const escape = (value: string | number) => {
    const str = String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h]!)).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
