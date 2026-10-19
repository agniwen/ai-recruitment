export function documentFontLinks(enableRemoteFonts = true) {
  if (!enableRemoteFonts) {
    return [];
  }

  return [
    {
      crossOrigin: "anonymous" as const,
      href: "https://cdn.jsdelivr.net",
      rel: "preconnect",
    },
    ...["Regular", "Medium", "Semibold", "Bold"].map((weight) => ({
      crossOrigin: "anonymous" as const,
      href: `https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-${weight}.min.css`,
      rel: "stylesheet",
    })),
  ];
}
