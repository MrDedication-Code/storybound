// A fresh install starts with one empty library: sync needs a local library to bind to, and
// sample books would otherwise end up beside (or synced into) the user's real library.
export interface SeedLibrary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

const timestamp = '2026-08-06T08:00:00.000Z'

export const seedLibrary: SeedLibrary = {
  id: 'default-library',
  name: 'My Library',
  createdAt: timestamp,
  updatedAt: timestamp
}
