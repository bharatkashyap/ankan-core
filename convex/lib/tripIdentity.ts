const placeholder = /^(me|trip owner)$/i;

export function tripOwnerName(profileName?: string, accountName?: string, telegramFirstName?: string) {
  for (const value of [profileName, accountName, telegramFirstName]) {
    const name = value?.trim().replace(/\s+/g, " ").split(" ")[0]?.slice(0, 60);
    if (name && !placeholder.test(name)) return name;
  }
  return null;
}
