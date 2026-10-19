import { describe, expect, it } from "vitest";
import { documentFontLinks } from "../document-fonts";

describe("document font resources", () => {
  it("omits all external font requests when disabled", () => {
    expect(documentFontLinks(false)).toEqual([]);
  });

  it("keeps all existing font weights and CDN preconnection by default", () => {
    const links = documentFontLinks();
    const stylesheets = links.filter((link) => link.rel === "stylesheet");

    expect(stylesheets.map((link) => link.href)).toEqual([
      "https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Regular.min.css",
      "https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Medium.min.css",
      "https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Semibold.min.css",
      "https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Bold.min.css",
    ]);
    expect(links).toContainEqual({
      crossOrigin: "anonymous",
      href: "https://cdn.jsdelivr.net",
      rel: "preconnect",
    });
  });
});
