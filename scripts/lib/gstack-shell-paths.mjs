// Protect only replacement roots in shell fences; already-normalized commands are untouched.
export function quoteGstackShellPaths(source, replacements) {
  return source.replace(/(```(?:bash|sh|shell)\r?\n)([\s\S]*?)(^```)/gm, (_match, opening, body, closing) => {
    const lines = body.split("\n").map((line) => {
      let quote = null;
      let result = "";
      for (let index = 0; index < line.length;) {
        const entry = replacements.find(([original]) => line.startsWith(original, index));
        if (entry) {
          const [original, root] = entry;
          result += quote === '"' ? root.replace(/["$`\\]/g, "\\$&")
            : quote === "'" ? root.replaceAll("'", "'\"'\"'")
            : `'${root.replaceAll("'", "'\"'\"'")}'`;
          index += original.length;
          continue;
        }
        const character = line[index++];
        result += character;
        if (character === "\\" && quote !== "'" && index < line.length) result += line[index++];
        else if (character === quote) quote = null;
        else if (!quote && (character === "'" || character === '"')) quote = character;
      }
      return result;
    });
    return opening + lines.join("\n") + closing;
  });
}
