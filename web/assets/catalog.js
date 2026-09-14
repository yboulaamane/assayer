// Preserve the source's licence label; group known software licences only for
// browsing. A public repository or free download does not establish a licence.
const OPEN_LICENSES = new Set([
  "open-source", "mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause",
  "isc", "unlicense", "artistic-2.0", "mpl-2.0", "afl-3.0",
]);

export function matchesAccess(license, access) {
  if (!access) return true;
  const value = String(license || "").trim().toLowerCase();
  if (access === "open-source") {
    return OPEN_LICENSES.has(value)
      || /^(?:gpl-(?:2\.0|3\.0)|lgpl-(?:2\.0|2\.1|3\.0)|agpl-3\.0)(?:-only|-or-later|\+)?$/.test(value);
  }
  if (access === "commercial") return value === "commercial" || value === "proprietary";
  return value === access;
}
