/** MCP grants never inherit family sharing; only the profile's owner can read it. */
export function requireMcpProfileOwner(userId: string, profile: { userId: string }) {
  if (profile.userId !== userId) throw new Error("Profile not owned by token user");
}

export function requireMcpEndpointOwner(
  userId: string, endpoint: { userId: string; slug: string } | null,
  resource: string | undefined, publicOrigin: string | undefined,
) {
  if (!endpoint || endpoint.userId !== userId ||
      resource !== `${publicOrigin?.replace(/\/$/, "")}/u/${endpoint.slug}`) {
    throw new Error("This MCP URL belongs to another account");
  }
}
