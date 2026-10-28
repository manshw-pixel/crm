// Sidebar avatar initials: first letters of the first two words of the name, upper-case;
// no name -> first letter of the email; nothing -> "".
export const initialsOf = (name, email) => {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 2).map(w => [...w][0]).join("").toUpperCase();
  const e = String(email || "").trim();
  return e ? [...e][0].toUpperCase() : "";
};
