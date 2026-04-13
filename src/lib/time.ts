export const formatAge = (createdAt: string, nowMs: number): string => {
  const diffSeconds = Math.max(0, Math.floor((nowMs - Date.parse(createdAt)) / 1000))
  const hours = Math.floor(diffSeconds / 3600)
  const minutes = Math.floor((diffSeconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return `${Math.max(1, minutes)}m`
}
