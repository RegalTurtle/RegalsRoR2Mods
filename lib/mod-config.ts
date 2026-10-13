export type ConfigSetting = { line: number; section: string; name: string; value: string; description: string; type: string; choices: string[] };

export function parseConfig(content: string): ConfigSetting[] {
  let section = "General";
  let comments: string[] = [];
  const settings: ConfigSetting[] = [];
  content.split(/\r\n|\n|\r/).forEach((line, index) => {
    const trimmed = line.replace(/^\ufeff/, "").trim();
    if (/^[#;]/.test(trimmed)) { comments.push(trimmed.replace(/^[#;]+\s*/, "")); return; }
    const header = /^\[(.*)\]$/.exec(trimmed);
    if (header) { section = header[1]; comments = []; return; }
    const match = /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) {
      const type = comments.find((comment) => comment.startsWith("Setting type:"))?.slice(13).trim() ?? "String";
      const choices = comments.find((comment) => comment.startsWith("Acceptable values:"))?.slice(18).split(",").map((item) => item.trim()) ?? [];
      settings.push({ line: index, section, name: match[1].trim(), value: match[2], type, choices,
        description: comments.filter((comment) => !/^(Setting type|Default value|Acceptable values|Acceptable value range):/.test(comment)).join("\n") });
      comments = [];
    } else if (trimmed) comments = [];
  });
  return settings;
}

export function editConfig(content: string, edits: Record<number, string>) {
  const parts = content.split(/(\r\n|\n|\r)/);
  for (const [index, value] of Object.entries(edits)) {
    if (/[\r\n\x00]/.test(value)) throw new Error("Settings cannot contain line breaks.");
    const position = Number(index) * 2;
    const match = /^(\s*[^=]+?\s*=\s*)(.*?)(\s*)$/.exec(parts[position] ?? "");
    if (!match) throw new Error("Config setting no longer exists; reload it.");
    parts[position] = match[1] + value + match[3];
  }
  return parts.join("");
}
